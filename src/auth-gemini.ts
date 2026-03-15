/**
 * Antigravity OAuth Authentication Module
 * 
 * Implements PKCE OAuth flow using Antigravity's CLIENT_ID/SECRET
 * to obtain access tokens with correct scopes for generativelanguage.googleapis.com
 */

import http from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { exec } from "node:child_process";

const ANTIGRAVITY_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const ANTIGRAVITY_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const REDIRECT_PORT = 51121;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth-callback`;

const SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
];

export interface HydraGeminiAuth {
    accessToken: string;
    refreshToken: string;
    expiryDate: number;
    email?: string;
    projectId?: string;
}

function getAuthDir(): string {
    const dir = join(homedir(), ".hydra");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
}

function getAuthPath(): string {
    return join(getAuthDir(), "gemini-auth.json");
}

export function loadSavedAuth(): HydraGeminiAuth | null {
    const path = getAuthPath();
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
        return null;
    }
}

function saveAuth(auth: HydraGeminiAuth): void {
    writeFileSync(getAuthPath(), JSON.stringify(auth, null, 2));
}

function generatePKCE(): { verifier: string; challenge: string } {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return { verifier, challenge };
}

export async function refreshAccessToken(auth: HydraGeminiAuth): Promise<HydraGeminiAuth | null> {
    try {
        const res = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: ANTIGRAVITY_CLIENT_ID,
                client_secret: ANTIGRAVITY_CLIENT_SECRET,
                refresh_token: auth.refreshToken,
                grant_type: "refresh_token",
            }),
        });

        if (!res.ok) {
            console.error("Failed to refresh Antigravity token:", await res.text());
            return null;
        }

        const data = await res.json() as any;
        auth.accessToken = data.access_token;
        auth.expiryDate = Date.now() + (data.expires_in * 1000);
        saveAuth(auth);
        return auth;
    } catch (err) {
        console.error("Token refresh error:", err);
        return null;
    }
}

export async function getValidToken(): Promise<HydraGeminiAuth | null> {
    const auth = loadSavedAuth();
    if (!auth) return null;

    // Check if expired (with 2 min buffer)
    if (Date.now() >= auth.expiryDate - 120000) {
        console.log("Antigravity token expired, refreshing...");
        return refreshAccessToken(auth);
    }

    return auth;
}

async function fetchProjectId(accessToken: string): Promise<string> {
    const endpoints = [
        "https://cloudcode-pa.googleapis.com",
        "https://daily-cloudcode-pa.sandbox.googleapis.com",
    ];

    for (const baseUrl of endpoints) {
        try {
            const res = await fetch(`${baseUrl}/v1internal:loadCodeAssist`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "User-Agent": "google-api-nodejs-client/9.15.1",
                },
                body: JSON.stringify({
                    metadata: { ideType: "ANTIGRAVITY", platform: "MACOS", pluginType: "GEMINI" },
                }),
                signal: AbortSignal.timeout(10000),
            });

            if (!res.ok) continue;
            const data = await res.json() as any;
            const projectId = typeof data.cloudaicompanionProject === "string"
                ? data.cloudaicompanionProject
                : data.cloudaicompanionProject?.id;
            if (projectId) return projectId;
        } catch { }
    }
    return "";
}

export async function loginWithBrowser(): Promise<HydraGeminiAuth> {
    const pkce = generatePKCE();

    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            const url = new URL(req.url || "/", `http://localhost:${REDIRECT_PORT}`);

            if (url.pathname !== "/oauth-callback") {
                res.writeHead(404);
                res.end("Not found");
                return;
            }

            const code = url.searchParams.get("code");
            const error = url.searchParams.get("error");

            if (error || !code) {
                res.writeHead(400, { "Content-Type": "text/html" });
                res.end(`<h1>Authentication failed</h1><p>${error || "No code received"}</p>`);
                server.close();
                reject(new Error(error || "No authorization code"));
                return;
            }

            // Exchange code for tokens
            try {
                const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        client_id: ANTIGRAVITY_CLIENT_ID,
                        client_secret: ANTIGRAVITY_CLIENT_SECRET,
                        code,
                        grant_type: "authorization_code",
                        redirect_uri: REDIRECT_URI,
                        code_verifier: pkce.verifier,
                    }),
                });

                if (!tokenRes.ok) {
                    const errText = await tokenRes.text();
                    res.writeHead(400, { "Content-Type": "text/html" });
                    res.end(`<h1>Token exchange failed</h1><pre>${errText}</pre>`);
                    server.close();
                    reject(new Error(errText));
                    return;
                }

                const tokenData = await tokenRes.json() as any;

                // Get user email
                let email = "";
                try {
                    const userRes = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
                        headers: { "Authorization": `Bearer ${tokenData.access_token}` },
                    });
                    if (userRes.ok) {
                        const user = await userRes.json() as any;
                        email = user.email || "";
                    }
                } catch { }

                // Get project ID
                const projectId = await fetchProjectId(tokenData.access_token);

                const auth: HydraGeminiAuth = {
                    accessToken: tokenData.access_token,
                    refreshToken: tokenData.refresh_token,
                    expiryDate: Date.now() + (tokenData.expires_in * 1000),
                    email,
                    projectId,
                };

                saveAuth(auth);

                res.writeHead(200, { "Content-Type": "text/html" });
                res.end(`
          <html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0">
            <div style="text-align:center">
              <h1 style="color:#00d4aa">✓ HydraTeams Authenticated</h1>
              <p>Logged in as <strong>${email}</strong></p>
              <p>Project: <code>${projectId || "auto-detected"}</code></p>
              <p style="color:#888">You can close this tab.</p>
            </div>
          </body></html>
        `);

                server.close();
                resolve(auth);
            } catch (err) {
                res.writeHead(500, { "Content-Type": "text/html" });
                res.end(`<h1>Error</h1><pre>${err}</pre>`);
                server.close();
                reject(err);
            }
        });

        server.listen(REDIRECT_PORT, () => {
            const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
            authUrl.searchParams.set("client_id", ANTIGRAVITY_CLIENT_ID);
            authUrl.searchParams.set("response_type", "code");
            authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
            authUrl.searchParams.set("scope", SCOPES.join(" "));
            authUrl.searchParams.set("code_challenge", pkce.challenge);
            authUrl.searchParams.set("code_challenge_method", "S256");
            authUrl.searchParams.set("access_type", "offline");
            authUrl.searchParams.set("prompt", "consent");

            console.log(`\n\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);
            console.log(`  \x1b[1mHydraTeams - Google Authentication\x1b[0m`);
            console.log(`  \x1b[2mOpening browser for Google sign-in...\x1b[0m`);
            console.log(`\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n`);
            console.log(`  \x1b[33mIf browser doesn't open, visit:\x1b[0m`);
            console.log(`  ${authUrl.toString()}\n`);

            // Try to open browser
            const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
            exec(`${cmd} "${authUrl.toString()}"`);
        });

        server.on("error", (err) => {
            reject(new Error(`Failed to start auth server on port ${REDIRECT_PORT}: ${err.message}`));
        });

        // Timeout after 5 minutes
        setTimeout(() => {
            server.close();
            reject(new Error("Authentication timed out (5 minutes)"));
        }, 300000);
    });
}
