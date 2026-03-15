import { loadSavedAuth, refreshAccessToken } from "./src/auth-gemini.js";

async function testModel(accessToken: string, projectId: string, model: string): Promise<boolean> {
    const geminiUrl = "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent";

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": "Mozilla/5.0 Antigravity/1.18.3",
        "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
        "Client-Metadata": '{"ideType":"ANTIGRAVITY","platform":"WINDOWS","pluginType":"GEMINI"}',
    };

    const body = {
        project: projectId || "rising-fact-p41fc",
        model: model,
        request: {
            contents: [{ role: "user", parts: [{ text: "Say 'ok'" }] }],
            generationConfig: { maxOutputTokens: 10 },
        },
        userAgent: "antigravity",
    };

    try {
        const res = await fetch(geminiUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });

        return res.ok;
    } catch {
        return false;
    }
}

async function main() {
    let auth = loadSavedAuth();
    if (!auth) {
        console.error("No auth found. Please run 'hydra --login' first.");
        return;
    }

    if (Date.now() >= auth.expiryDate - 120000) {
        console.log("Token expired, refreshing...");
        auth = await refreshAccessToken(auth);
        if (!auth) {
            console.error("Failed to refresh token.");
            return;
        }
    }

    const modelsToTest = [
        "gemini-2.0-flash-exp",
        "gemini-2.0-flash",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-3-pro",
        "gemini-3-flash",
        "gemini-3.1-pro",
        "gemini-3.1-flash",
        "gemini-exp-1206",
        "gemini-exp-1121",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
    ];

    console.log("\n\x1b[1mTesting Gemini Models on Antigravity...\x1b[0m");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    for (const model of modelsToTest) {
        process.stdout.write(`  Testing \x1b[36m${model.padEnd(25)}\x1b[0m ... `);
        const works = await testModel(auth.accessToken, auth.projectId || "", model);
        if (works) {
            console.log("\x1b[32m✓ AVAILABLE\x1b[0m");
        } else {
            console.log("\x1b[31m✗ NOT FOUND\x1b[0m");
        }
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main();