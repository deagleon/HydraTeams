#!/usr/bin/env node

/**
 * HydraTeams CLI - Convenience wrapper for hydra-proxy
 *
 * Usage:
 *   hydra --model qwen-coder-plus
 *   hydra --model gpt-4o --provider openai
 *   hydra --model kimi-k2.5 --url https://api.moonshot.cn/v1/chat/completions
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = 3456;

// Provider configurations
const PROVIDERS: Record<string, { url?: string; needsKey: boolean; keyEnv: string }> = {
  openai: { url: "https://api.openai.com/v1/chat/completions", needsKey: true, keyEnv: "OPENAI_API_KEY" },
  alibaba: { url: "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions", needsKey: true, keyEnv: "DASHSCOPE_API_KEY" },
  qwen: { url: "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions", needsKey: true, keyEnv: "DASHSCOPE_API_KEY" },
  moonshot: { url: "https://api.moonshot.cn/v1/chat/completions", needsKey: true, keyEnv: "MOONSHOT_API_KEY" },
  kimi: { url: "https://api.moonshot.cn/v1/chat/completions", needsKey: true, keyEnv: "MOONSHOT_API_KEY" },
  deepseek: { url: "https://api.deepseek.com/v1/chat/completions", needsKey: true, keyEnv: "DEEPSEEK_API_KEY" },
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", needsKey: true, keyEnv: "GROQ_API_KEY" },
  ollama: { url: "http://localhost:11434/v1/chat/completions", needsKey: false, keyEnv: "" },
  chatgpt: { needsKey: false, keyEnv: "" }, // Uses codex auth
  gemini: { needsKey: false, keyEnv: "" }, // Uses gemini CLI auth
  antigravity: { needsKey: false, keyEnv: "" }, // Uses gemini CLI/Antigravity auth
  custom: { needsKey: false, keyEnv: "" },
};

function printHelp() {
  console.log(`
${"\x1b[1m"}HydraTeams - Claude Code with any model${"\x1b[0m"}

${"\x1b[36m"}Usage:${"\x1b[0m"}
  hydra --model <model> [options]
  hydra --lead-model gemini-1.5-pro --teammate-model gemini-1.5-flash
  hydra --model gpt-4o --provider openai

${"\x1b[36m"}Options:${"\x1b[0m"}
  --model <name>           Target model for both roles
  --lead-model <name>      Target model for lead agent
  --teammate-model <name>  Target model for teammate agents
  --provider <name>        Provider: openai, alibaba, moonshot, deepseek, groq, ollama, chatgpt
  --url <url>              Custom API URL (for OpenAI-compatible APIs)
  --port <port>       Proxy port (default: 3456)
  --passthrough       Enable passthrough for lead agent
  --spoof <model>     Model to report to Claude Code (default: claude-sonnet-4-6)
  --help              Show this help

${"\x1b[36m"}Providers:${"\x1b[0m"}
  openai      OpenAI API (GPT-4o, GPT-4o-mini, etc.)
  alibaba     Alibaba Qwen models
  moonshot    Moonshot Kimi models
  deepseek    DeepSeek models
  groq        Groq fast inference
  ollama      Local Ollama server
  chatgpt     ChatGPT Plus subscription (requires: codex --login)
  gemini      Google Gemini subscription (requires: gemini auth login)
  antigravity Gemini via Antigravity session (authenticated via gemini or antigravity)

${"\x1b[36m"}Examples:${"\x1b[0m"}
  # Use Qwen via Alibaba
  hydra --model qwen-coder-plus --provider alibaba

  # Use Kimi via Moonshot
  hydra --model kimi-k2.5 --provider moonshot

  # Use local Ollama
  hydra --model llama3.1 --provider ollama

  # Use custom API
  hydra --model my-model --url https://my-api.com/v1/chat/completions

${"\x1b[36m"}Environment Variables:${"\x1b[0m"}
  OPENAI_API_KEY     For OpenAI provider
  DASHSCOPE_API_KEY  For Alibaba/Qwen provider
  MOONSHOT_API_KEY   For Moonshot/Kimi provider
  DEEPSEEK_API_KEY   For DeepSeek provider
  GROQ_API_KEY       For Groq provider
`);
}

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key === "help") {
        result.help = true;
      } else if (key === "passthrough") {
        result.passthrough = true;
      } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        result[key] = args[++i];
      }
    }
  }

  return result;
}

function detectProviderFromModel(model: string): string {
  const lowerModel = model.toLowerCase();
  if (lowerModel.includes("qwen") || lowerModel.includes("coder-plus")) return "alibaba";
  if (lowerModel.includes("kimi") || lowerModel.includes("moonshot")) return "moonshot";
  if (lowerModel.includes("deepseek")) return "deepseek";
  if (lowerModel.includes("gemini")) return "gemini";
  if (lowerModel.includes("llama") || lowerModel.includes("mistral")) return "ollama";
  if (lowerModel.includes("gpt") || lowerModel.includes("o1") || lowerModel.includes("o3")) return "openai";
  return "openai"; // Default
}

function checkApiKey(provider: string): boolean {
  const config = PROVIDERS[provider];
  if (!config?.needsKey) return true;

  if (process.env[config.keyEnv]) return true;

  // Try to load from settings.json
  try {
    const settingsPath = join(homedir(), ".claude", "settings.json");
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      if (settings.env?.[config.keyEnv]) {
        process.env[config.keyEnv] = settings.env[config.keyEnv];
        return true;
      }
    }
  } catch { }

  return false;
}

async function promptProvider(): Promise<string> {
  console.log("\n\x1b[36mAvailable providers:\x1b[0m");
  const providerList = Object.keys(PROVIDERS).filter(p => p !== "custom");
  providerList.forEach((p, i) => {
    const config = PROVIDERS[p];
    const hasKey = !config.needsKey || checkApiKey(p);
    const status = hasKey ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`  ${i + 1}. ${p.padEnd(12)} ${status}`);
  });
  console.log(`  ${providerList.length + 1}. custom URL`);

  // Simple prompt without external dependencies
  return new Promise((resolve) => {
    process.stdout.write("\n\x1b[36mSelect provider (1-" + (providerList.length + 1) + "): \x1b[0m");
    process.stdin.once("data", (data) => {
      const choice = parseInt(data.toString().trim());
      if (choice >= 1 && choice <= providerList.length) {
        resolve(providerList[choice - 1]);
      } else {
        resolve("custom");
      }
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);

  if (opts.help || args.length === 0) {
    printHelp();
    process.exit(0);
  }

  if (!opts.model && !opts["lead-model"] && !opts["teammate-model"]) {
    console.error("\x1b[31mError: --model (or --lead-model and --teammate-model) is required\x1b[0m");
    console.error("Example: hydra --model qwen-coder-plus");
    process.exit(1);
  }

  // Determine provider based on lead model
  const effectiveLeadModel = (opts["lead-model"] || opts.model || "") as string;
  let provider = (opts.provider as string) || detectProviderFromModel(effectiveLeadModel);

  // If no provider specified and not in non-interactive mode, prompt
  if (!opts.provider && process.stdin.isTTY) {
    console.log(`\n\x1b[33mAuto-detected provider: ${provider} (from lead model)\x1b[0m`);
    provider = await promptProvider();
  }

  const providerConfig = PROVIDERS[provider];

  // Build proxy arguments
  const proxyArgs: string[] = [
    "dist/index.js",
    "--provider", provider === "chatgpt" ? "chatgpt" : provider === "gemini" || provider === "antigravity" ? provider : "openai",
    "--port", String(opts.port || PORT),
  ];

  if (opts.model) proxyArgs.push("--model", opts.model as string);
  if (opts["lead-model"]) proxyArgs.push("--lead-model", opts["lead-model"] as string);
  if (opts["teammate-model"]) proxyArgs.push("--teammate-model", opts["teammate-model"] as string);

  // Add URL for OpenAI-compatible providers
  if (provider !== "chatgpt" && provider !== "gemini" && provider !== "antigravity") {
    const url = (opts.url as string) || providerConfig?.url;
    if (url) {
      proxyArgs.push("--target-url", url);
    }
  }

  // Add passthrough if specified
  if (opts.passthrough) {
    proxyArgs.push("--passthrough", "lead");
  }

  // Add spoof model if specified
  if (opts.spoof) {
    proxyArgs.push("--spoof", opts.spoof as string);
  }

  // Check API key for providers that need it
  if (providerConfig?.needsKey && !checkApiKey(provider)) {
    console.error(`\n\x1b[31mError: ${providerConfig.keyEnv} not set\x1b[0m`);
    console.error(`Set it with: export ${providerConfig.keyEnv}=your-api-key`);
    console.error(`Or add to ~/.claude/settings.json under "env"`);
    process.exit(1);
  }

  // Print banner
  console.log(`
\x1b[1m\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m
  \x1b[1mHydraTeams Proxy\x1b[0m
  \x1b[2mLead: ${opts["lead-model"] || opts.model || "none"} | Teammate: ${opts["teammate-model"] || opts.model || "none"}\x1b[0m
  \x1b[2mProvider: ${provider}\x1b[0m
\x1b[1m\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m
`);

  // Start the proxy
  const proxy = spawn("node", proxyArgs, {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  proxy.on("error", (err) => {
    console.error("\x1b[31mFailed to start proxy:\x1b[0m", err.message);
    process.exit(1);
  });

  proxy.on("exit", (code) => {
    process.exit(code || 0);
  });

  // Handle shutdown signals
  process.on("SIGINT", () => {
    proxy.kill("SIGINT");
  });

  process.on("SIGTERM", () => {
    proxy.kill("SIGTERM");
  });
}

main().catch((err) => {
  console.error("\x1b[31mError:\x1b[0m", err.message);
  process.exit(1);
});