
import { loadSavedAuth, refreshAccessToken } from "./src/auth-gemini.js";

async function main() {
    let auth = loadSavedAuth();
    if (!auth) {
        console.error("No auth found. Please run 'hydra --login' first.");
        return;
    }

    // Refresh token if needed
    if (Date.now() >= auth.expiryDate - 120000) {
        console.log("Token expired, refreshing...");
        auth = await refreshAccessToken(auth);
        if (!auth) {
            console.error("Failed to refresh token.");
            return;
        }
    }

    console.log("Fetching available Gemini models...");

    try {
        const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
            headers: {
                "Authorization": `Bearer ${auth.accessToken}`,
                "Content-Type": "application/json"
            }
        });

        if (!res.ok) {
            console.error(`Error: ${res.status} ${await res.text()}`);
            return;
        }

        const data = await res.json() as any;
        const models = data.models || [];

        console.log("\n\x1b[1mAvailable Gemini Models:\x1b[0m");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        models
            .filter((m: any) => m.name.includes("gemini"))
            .forEach((m: any) => {
                const shortName = m.name.replace("models/", "");
                console.log(`  \x1b[36m${shortName.padEnd(30)}\x1b[0m \x1b[2m${m.displayName}\x1b[0m`);
            });

        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    } catch (err) {
        console.error("Failed to fetch models:", err);
    }
}

main();
