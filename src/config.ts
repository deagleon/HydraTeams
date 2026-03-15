import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ProxyConfig } from "./translators/types.js";

// Provider configuration: maps provider to env var and default URL
const PROVIDER_CONFIG: Record<string, { envVar: string; url?: string; needsKey: boolean }> = {
  openai: { envVar: "OPENAI_API_KEY", url: "https://api.openai.com/v1/chat/completions", needsKey: true },
  alibaba: { envVar: "DASHSCOPE_API_KEY", url: "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions", needsKey: true },
  qwen: { envVar: "DASHSCOPE_API_KEY", url: "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions", needsKey: true },
  moonshot: { envVar: "MOONSHOT_API_KEY", url: "https://api.moonshot.cn/v1/chat/completions", needsKey: true },
  kimi: { envVar: "MOONSHOT_API_KEY", url: "https://api.moonshot.cn/v1/chat/completions", needsKey: true },
  deepseek: { envVar: "DEEPSEEK_API_KEY", url: "https://api.deepseek.com/v1/chat/completions", needsKey: true },
  groq: { envVar: "GROQ_API_KEY", url: "https://api.groq.com/openai/v1/chat/completions", needsKey: true },
  ollama: { envVar: "", url: "http://localhost:11434/v1/chat/completions", needsKey: false },
  chatgpt: { envVar: "", needsKey: false },
  gemini: { envVar: "GEMINI_API_KEY", url: "https://generativelanguage.googleapis.com/v1beta/models", needsKey: false },
  antigravity: { envVar: "", needsKey: false },
};


interface CodexAuth {
  accessToken: string;
  accountId: string;
}

function loadApiKeyFromSettings(envVar: string): string | undefined {
  try {
    const settingsPath = join(homedir(), ".claude", "settings.json");
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      return settings.env?.[envVar];
    }
  } catch { }
  return undefined;
}

function loadCodexAuth(): CodexAuth | null {
  try {
    const authPath = join(homedir(), ".codex", "auth.json");
    const auth = JSON.parse(readFileSync(authPath, "utf-8"));
    const token = auth.tokens?.access_token;
    if (!token) return null;

    // Extract chatgpt_account_id from JWT
    const payload = token.split(".")[1];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    const authClaim = decoded["https://api.openai.com/auth"] || {};
    const accountId = authClaim.chatgpt_account_id || "";

    console.log(`Using codex auth from ~/.codex/auth.json (plan: ${authClaim.chatgpt_plan_type || "unknown"})`);
    return { accessToken: token, accountId };
  } catch {
    return null;
  }
}

import { getValidToken } from "./auth-gemini.js";


export async function loadConfig(args: string[]): Promise<ProxyConfig> {
  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  const port = parseInt(getArg("--port") || process.env.HYDRA_PROXY_PORT || "3456", 10);
  const targetModel = getArg("--model") || process.env.HYDRA_TARGET_MODEL || "";
  const targetProvider = (getArg("--provider") || process.env.HYDRA_TARGET_PROVIDER || "openai") as ProxyConfig["targetProvider"];
  const spoofModel = getArg("--spoof") || process.env.HYDRA_SPOOF_MODEL || "claude-sonnet-4-6";
  const targetUrl = getArg("--target-url") || process.env.HYDRA_TARGET_URL;

  // Passthrough config
  const passthroughArg = getArg("--passthrough");
  let passthroughModels: string[] = [];
  if (passthroughArg) {
    passthroughModels = passthroughArg.split(",").map(m => m.trim());
  } else if (args.includes("--passthrough")) {
    passthroughModels = ["*"];
  } else if (process.env.HYDRA_PASSTHROUGH) {
    const envVal = process.env.HYDRA_PASSTHROUGH;
    passthroughModels = envVal === "true" ? ["*"] : envVal.split(",").map(m => m.trim());
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  // Get provider configuration
  const providerConfig = PROVIDER_CONFIG[targetProvider] || PROVIDER_CONFIG["openai"];

  // Set default URL if not provided
  const effectiveTargetUrl = targetUrl || providerConfig.url;

  // Load auth based on provider
  let openaiApiKey = "";
  let chatgptAccessToken = "";
  let chatgptAccountId = "";
  let geminiAccessToken = "";
  let geminiProjectId = "";

  if (targetProvider === "chatgpt") {
    const codexAuth = loadCodexAuth();
    if (!codexAuth) {
      console.error("Error: No codex auth found. Run: codex --login");
      process.exit(1);
    }
    chatgptAccessToken = codexAuth.accessToken;
    chatgptAccountId = codexAuth.accountId;
  } else if (targetProvider === "gemini" || targetProvider === "antigravity") {
    const geminiAuth = await getValidToken();
    if (!geminiAuth) {
      console.error(`Error: No Gemini auth found. Run: hydra --login`);
      process.exit(1);
    }
    geminiAccessToken = geminiAuth.accessToken;
    geminiProjectId = geminiAuth.projectId || "";
  } else if (providerConfig.needsKey) {
    // Try: env var for specific provider → settings.json → OPENAI_API_KEY fallback → codex auth
    openaiApiKey = process.env[providerConfig.envVar] ||
      loadApiKeyFromSettings(providerConfig.envVar) ||
      process.env.OPENAI_API_KEY ||
      loadApiKeyFromSettings("OPENAI_API_KEY") ||
      "";
    if (!openaiApiKey) {
      const codexAuth = loadCodexAuth();
      openaiApiKey = codexAuth?.accessToken || "";
    }
    if (!openaiApiKey && !targetUrl) {
      console.error(`Error: No API key found for ${targetProvider}.`);
      console.error(`  Set ${providerConfig.envVar} env var, use --target-url, or add to settings.json`);
      process.exit(1);
    }
  }

  if (!targetModel) {
    console.error("Error: --model is required (e.g., --model gpt-5.3-codex)");
    process.exit(1);
  }

  if (passthroughModels.length > 0) {
    console.log("Passthrough enabled — Claude Code auth headers will be relayed to Anthropic API.");
  }

  return { port, targetModel, targetProvider, targetUrl: effectiveTargetUrl, openaiApiKey, spoofModel, passthroughModels, anthropicApiKey, chatgptAccessToken, chatgptAccountId, geminiAccessToken, geminiProjectId };
}
