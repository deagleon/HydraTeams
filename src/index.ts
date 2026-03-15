#!/usr/bin/env node

import { loadConfig } from "./config.js";
import { createProxyServer } from "./proxy.js";
import { loginWithBrowser } from "./auth-gemini.js";

async function main() {
  const args = process.argv.slice(2);

  // Handle --login: run OAuth flow and exit
  if (args.includes("--login")) {
    try {
      const auth = await loginWithBrowser();
      console.log(`\n\x1b[32m✓ Authenticated as ${auth.email || "unknown"}\x1b[0m`);
      console.log(`  Token saved to ~/.hydra/gemini-auth.json`);
      console.log(`  Project: ${auth.projectId || "none"}\n`);
      process.exit(0);
    } catch (err) {
      console.error("Login failed:", err);
      process.exit(1);
    }
  }

  const config = await loadConfig(args);
  const server = createProxyServer(config);

  server.listen(config.port, () => {
    console.log(`
╔══════════════════════════════════════════╗
║           HydraProxy v0.1.0              ║
╠══════════════════════════════════════════╣
║  Port:        ${String(config.port).padEnd(27)}║
║  Target:      ${config.targetModel.padEnd(27)}║
║  Spoofing as: ${config.spoofModel.padEnd(27)}║
║  Passthrough: ${(config.passthroughModels.length ? config.passthroughModels.join(", ") : "none").padEnd(27)}║
╚══════════════════════════════════════════╝

Ready. Set ANTHROPIC_BASE_URL=http://localhost:${config.port} on teammate processes.
`);
  });

  server.on("error", (err: Error) => {
    console.error("Server error:", err.message);
    process.exit(1);
  });

  process.on("SIGINT", () => {
    console.log("\nShutting down HydraProxy...");
    server.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    server.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
