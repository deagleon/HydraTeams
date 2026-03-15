import { loadSavedAuth, refreshAccessToken } from "./src/auth-gemini.js";

async function testModel(accessToken: string, projectId: string, model: string): Promise<{ available: boolean; error?: string }> {
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

        if (res.ok) {
            return { available: true };
        }

        const errorText = await res.text();
        return { available: false, error: `${res.status}: ${errorText.substring(0, 100)}` };
    } catch (err) {
        return { available: false, error: String(err) };
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
        // Gemini 3 Pro with tier suffixes (CORRECT FORMAT for Antigravity)
        "gemini-3-pro-low",
        "gemini-3-pro-high",

        // Gemini 3.1 Pro with tier suffixes (CORRECT FORMAT for Antigravity)
        "gemini-3.1-pro-low",
        "gemini-3.1-pro-high",

        // Gemini 3 Flash (uses bare name + thinkingLevel param)
        "gemini-3-flash",

        // Gemini 2.5 models
        "gemini-2.5-flash",
        "gemini-2.5-pro",

        // Image generation models
        "gemini-3-pro-image",

        // Claude models
        "claude-sonnet-4-6",
        "claude-opus-4-6-thinking",

        // Old models (should NOT work)
        "gemini-1.5-pro",
        "gemini-2.0-flash-exp",
    ];

    console.log("\n\x1b[1mTesting Antigravity Models (Correct Format)...\x1b[0m");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const results: { model: string; available: boolean; error?: string }[] = [];

    for (const model of modelsToTest) {
        process.stdout.write(`  Testing \x1b[36m${model.padEnd(35)}\x1b[0m ... `);
        const result = await testModel(auth.accessToken, auth.projectId || "", model);

        if (result.available) {
            console.log("\x1b[32m✓ AVAILABLE\x1b[0m");
        } else {
            console.log("\x1b[31m✗ NOT FOUND\x1b[0m");
            if (result.error) {
                console.log(`    \x1b[2m${result.error}\x1b[0m`);
            }
        }

        results.push(result);
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const available = results.filter(r => r.available);
    if (available.length > 0) {
        console.log("\n\x1b[1m\x1b[32m✓ Available Models:\x1b[0m");
        available.forEach(r => console.log(`  ✓ ${r.model}`));
    }

    const unavailable = results.filter(r => !r.available);
    if (unavailable.length > 0) {
        console.log("\n\x1b[1m\x1b[31m✗ Unavailable Models:\x1b[0m");
        unavailable.forEach(r => {
            console.log(`  ✗ ${r.model}`);
        });
    }

    console.log("\n\x1b[1m\x1b[36m📝 Note:\x1b[0m");
    console.log("  Gemini 3.x Pro requires tier suffix (-low/-high) in Antigravity API");
    console.log("  Gemini 3.x Flash uses bare name with thinkingLevel parameter");
    console.log("");
}

main();