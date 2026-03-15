# HydraTeams

> **The model doesn't matter. The orchestration does.**

A translation proxy that lets Claude Code Agent Teams use any AI model as a teammate. GPT Codex, Gemini, Ollama: they all become full Claude Code agents with 15+ tools, file access, bash, git, and autonomous task execution.

One proxy. One env var. Any model.

**Status:** Working. OpenAI, ChatGPT subscription, and Google Gemini (Antigravity) providers tested end-to-end.

```bash
$ hydra --model gemini-2.0-flash --provider gemini

╔══════════════════════════════════════════╗
║           HydraProxy v0.2.0              ║
╠══════════════════════════════════════════╣
║  Port:        3456                       ║
║  Target:      gemini-2.0-flash           ║
║  Provider:    gemini                     ║
║  Spoofing as: claude-sonnet-4-6          ║
╚══════════════════════════════════════════╝

Ready. Set ANTHROPIC_BASE_URL=http://localhost:3456 on teammate processes.
```

## How It Works

Claude Code Agent Teams spawns teammates as separate Claude Code processes. Each teammate communicates with its LLM via the Anthropic Messages API. HydraTeams is a proxy that intercepts these API calls and translates them to any provider's format.

The teammate is still a **full Claude Code instance** with every tool — Read, Write, Edit, Bash, Glob, Grep, Git. It just doesn't know its brain is GPT or Gemini instead of Claude.

```
┌─────────────────────┐
│   Lead Agent        │    Real Claude (passthrough)
│   (Claude Opus)     │    Detected via hydra:lead marker
│   Spawns teammates  │
└──────────┬──────────┘
           │
           │  ANTHROPIC_BASE_URL=http://localhost:3456
           │
┌──────────▼──────────┐
│  Teammate Process   │    Full Claude Code instance
│  (Claude Code CLI)  │    15+ tools, file access, bash
│  All tools work     │    Thinks it's calling Anthropic
└──────────┬──────────┘
           │
           │  POST /v1/messages (Anthropic format)
           │
┌──────────▼──────────┐
│    HydraProxy       │    Translates API formats
│    localhost:3456    │    Anthropic ↔ OpenAI / Gemini
│                     │    Streams SSE both ways
└──────────┬──────────┘
           │
           │  Chat Completions, Gemini, or Responses API
           │
┌──────────▼──────────┐
│  Gemini 2.0 Flash   │    Any model, any provider
│  (or GPT-4o, etc.)  │    Zero cost via subscription
└─────────────────────┘
```

## Why HydraTeams?

**You already have the best agent framework.** Claude Code Agent Teams is a battle-tested multi-agent system with agentic loops, 15+ tools, file-based coordination, task dependency graphs, messaging, plan approval, and graceful shutdown. Building another one is reinventing the wheel. HydraTeams makes Agent Teams model-agnostic instead.

**Real cost savings.** Not every task needs a $15/M token frontier model. Route research to Gemini Flash ($0.01), codegen to Codex ($0.12), architecture to Opus ($0.15). Same team, smart routing, real savings. Or use your ChatGPT Plus or Google Gemini subscription and pay **$0 extra**.

**Zero vendor lock-in.** If OpenAI is down, route through Gemini. If prices change, switch. New model drops? Update one config value.

## Quick Start

```bash
# Install globally
npm install -g hydra-proxy

# Or clone and link
git clone https://github.com/Pickle-Pixel/HydraTeams.git
cd HydraTeams
npm install
npm run build
npm link
```

### 1. Authenticate (Subscription Users)

If you are using a subscription-based provider (ChatGPT Plus or Google Gemini), run the login command once:

```bash
# For ChatGPT Plus (Codex)
codex --login

# For Google Gemini / Antigravity
hydra --login
```

### 2. Start the Proxy

Use the `hydra` CLI for a simple setup:

```bash
# Use Google Gemini (Subscription)
hydra --model gemini-2.0-flash --provider gemini

# Use OpenAI API
export OPENAI_API_KEY=sk-...
hydra --model gpt-4o

# Use local Ollama
hydra --model deepseek-v3 --provider ollama
```

### 3. Use with Claude Code

Add `<!-- hydra:lead -->` to your project's `CLAUDE.md` (this tells the proxy which requests are from the lead agent and should passthrough to real Claude).

```bash
# Set the env var and use Claude Code normally
export ANTHROPIC_BASE_URL=http://localhost:3456
claude
```

The lead runs on real Claude (passthrough). Spawned teammates run on your target model (translated).

## CLI Options (`hydra`)

| Flag | Description |
|---|---|
| `--login` | Run OAuth flow for Google Gemini authentication |
| `--model <name>` | Target model (required) |
| `--provider <name>` | Provider: `openai`, `gemini`, `antigravity`, `chatgpt`, `ollama`, `moonshot`, `deepseek`, `groq`, `alibaba` |
| `--url <url>` | Custom API URL (for OpenAI-compatible APIs) |
| `--port <port>` | Proxy port (default: 3456) |
| `--passthrough` | Enable passthrough for lead agent |
| `--spoof <model>` | Model to report to Claude Code (default: `claude-sonnet-4-6`) |

## Supported Providers

### Google Gemini / Antigravity (`--provider gemini`)

Uses your existing Google account subscription.
- **Setup:** Run `hydra --login` to authenticate.
- **Login:** Opens a browser window for Google sign-in.
- **Auth:** Auto-refreshes tokens and detects your project ID.
- **Models:** `gemini-2.0-flash`, `gemini-1.5-pro`, etc.

### ChatGPT Backend (`--provider chatgpt`)

Uses your ChatGPT Plus subscription via the backend Responses API.
- **Setup:** Run `codex --login` first.
- **Auth:** Auto-reads from `~/.codex/auth.json`.
- **Models:** `gpt-5-codex`, `gpt-5.3-codex`, etc.

### OpenAI & Compatible (`--provider openai`, `moonshot`, `deepseek`, etc.)

Standard OpenAI Chat Completions API.
- **Auth:** Uses provider-specific env vars (e.g., `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`) or reads from `~/.claude/settings.json`.

## What Works Today

- **Google Gemini Auth** — Full support for Gemini models via account auth (`--login`)
- **ChatGPT Subscription** — GPT Codex models via ChatGPT Plus subscription
- **OpenAI API** — All GPT models via API key
- **Mixed team routing** — Lead on real Claude (passthrough), teammates on GPT/Gemini
- **Full agentic tool loops** — All 15+ Claude Code tools work through translation
- **Token usage tracking** — Handles usage metadata and token counting
- **Auto-Retry** — Graceful handling of rate limits (429)

## Project Structure

```
src/
├── index.ts                    Entry point
├── cli.ts                      CLI wrapper (hydra)
├── auth-gemini.ts              Google OAuth PKCE implementation
├── proxy.ts                    HTTP server, 3-way routing, passthrough
├── config.ts                   Configuration and auth loading
└── translators/
    ├── request-gemini.ts       Anthropic → Google Gemini
    ├── response-gemini.ts      Gemini SSE → Anthropic SSE
    ├── request.ts              Anthropic → OpenAI
    ├── response.ts             OpenAI SSE → Anthropic SSE
    └── ...                     ChatGPT Responses API translators
```

## Documentation

| Document | Description |
|----------|-------------|
| [JOURNEY.md](JOURNEY.md) | The full build story — architecture pivots and subscription hacks |
| [VISION.md](VISION.md) | Why translation beats custom frameworks |
| [Architecture](architecture/ARCHITECTURE.md) | Technical spec — API translation maps |

## License

[MIT](LICENSE)
