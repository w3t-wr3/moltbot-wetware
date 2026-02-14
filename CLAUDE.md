# CLAUDE.md — Moltworker-Wetware

## Project Overview

**Moltworker-Wetware** is a fork of [cloudflare/moltworker](https://github.com/cloudflare/moltworker) that runs [OpenClaw](https://github.com/openclaw/openclaw) (formerly Moltbot/Clawdbot) — a personal AI assistant — inside a [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/) container.

- **Status:** Experimental proof-of-concept, not officially supported
- **License:** Apache 2.0
- **Repo:** https://github.com/w3t-wr3/moltbot-wetware.git

## Architecture

```
Browser / Chat Client
        │
        ▼
┌───────────────────────────────────────┐
│  Cloudflare Worker (Hono.js)          │
│  - Edge auth via Cloudflare Access    │
│  - Proxies HTTP + WebSocket           │
│  - Manages sandbox lifecycle          │
│  - Serves admin UI (React/Vite)       │
│  - Injects gateway token into WS URL  │
└──────────────┬────────────────────────┘
               │ sandbox.wsConnect() / containerFetch()
               ▼
┌───────────────────────────────────────┐
│  Cloudflare Sandbox Container         │
│  (standard-1: ½ vCPU, 4 GiB, 8 GB)  │
│  ┌─────────────────────────────────┐  │
│  │  OpenClaw Gateway (port 18789)  │  │
│  │  - Control UI (web chat)        │  │
│  │  - WebSocket RPC protocol       │  │
│  │  - Agent runtime                │  │
│  │  - Chat channels (TG/DC/Slack)  │  │
│  └─────────────────────────────────┘  │
│  ┌─────────────────────────────────┐  │
│  │  rclone sync loop → R2 storage  │  │
│  └─────────────────────────────────┘  │
└───────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main Hono app: middleware, route mounting, WebSocket/HTTP proxy to container |
| `src/types.ts` | TypeScript interfaces (`MoltbotEnv`, `AppEnv`, `AccessUser`, `JWTPayload`) |
| `src/config.ts` | Constants: `MOLTBOT_PORT=18789`, `STARTUP_TIMEOUT_MS=180000` |
| `src/gateway/env.ts` | Builds env vars mapping Worker secrets → container env |
| `src/gateway/process.ts` | Find/start/manage OpenClaw gateway process in sandbox |
| `src/gateway/r2.ts` | R2 bucket mounting via rclone |
| `src/gateway/sync.ts` | R2 backup sync logic |
| `src/auth/middleware.ts` | Cloudflare Access JWT validation middleware |
| `src/auth/jwt.ts` | JWT decoding and verification |
| `src/routes/api.ts` | `/api/*` — device management, gateway control |
| `src/routes/admin-ui.ts` | `/_admin/*` — static admin UI serving |
| `src/routes/debug.ts` | `/debug/*` — process listing, logs, container config |
| `src/routes/cdp.ts` | `/cdp/*` — Chrome DevTools Protocol proxy |
| `src/routes/public.ts` | Public routes (health, logos, status) |
| `src/client/App.tsx` | React admin UI |
| `start-openclaw.sh` | Container startup: R2 restore → onboard → config patch → sync loop → gateway |
| `Dockerfile` | Container image: `cloudflare/sandbox:0.7.0` + Node 22 + OpenClaw + rclone |
| `wrangler.jsonc` | Worker + container + R2 + browser binding config |
| `.github/workflows/deploy.yml` | CI: push to main → `npm ci && wrangler deploy` |

## Project Structure

```
src/
├── index.ts              # Main worker entry
├── types.ts              # Type definitions
├── config.ts             # Constants
├── auth/                 # Cloudflare Access authentication
│   ├── jwt.ts
│   ├── middleware.ts
│   └── index.ts
├── gateway/              # Container/gateway management
│   ├── env.ts            # Env var builder
│   ├── process.ts        # Process lifecycle
│   ├── r2.ts             # R2 mounting
│   ├── sync.ts           # R2 sync
│   ├── utils.ts          # waitForProcess helper
│   └── index.ts
├── routes/               # Route handlers
│   ├── api.ts            # /api/*
│   ├── admin-ui.ts       # /_admin/*
│   ├── debug.ts          # /debug/*
│   ├── cdp.ts            # /cdp/*
│   ├── public.ts         # Public routes
│   └── index.ts
├── client/               # React admin UI (Vite)
│   ├── App.tsx
│   ├── api.ts
│   ├── main.tsx
│   └── pages/AdminPage.tsx
├── utils/logging.ts      # Log redaction
└── assets/               # HTML templates
```

## Commands

```bash
npm run build        # Vite build (worker + client)
npm run deploy       # wrangler deploy (builds + deploys)
npm run dev          # Vite dev server
npm run start        # wrangler dev (local worker)
npm test             # vitest run
npm run test:watch   # vitest watch mode
npm run typecheck    # tsc --noEmit
npm run lint         # oxlint src/
npm run format       # oxfmt --write src/
```

## CI/CD

Push to `main` triggers `.github/workflows/deploy.yml`:
1. Checkout → Node 22 → `npm ci`
2. `npx wrangler deploy` (uses `CLOUDFLARE_API_TOKEN` repo secret)
3. Wrangler builds the Docker image, pushes it, and deploys the worker

## Secrets Configuration

Set via `npx wrangler secret put <NAME>`:

### Required (at least one AI provider)

| Secret | Description |
|--------|-------------|
| `ANTHROPIC_API_KEY` | Direct Anthropic API key |
| `OPENAI_API_KEY` | Direct OpenAI API key |
| `OPENROUTER_API_KEY` | OpenRouter API key (100+ models) |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` + `CF_AI_GATEWAY_ACCOUNT_ID` + `CF_AI_GATEWAY_GATEWAY_ID` | Cloudflare AI Gateway (all three required together) |

### Required (authentication)

| Secret | Description |
|--------|-------------|
| `MOLTBOT_GATEWAY_TOKEN` | Gateway token — mapped to `OPENCLAW_GATEWAY_TOKEN` in container, injected into WS URL as `?token=` |
| `CF_ACCESS_TEAM_DOMAIN` | Cloudflare Access team domain (e.g., `myteam.cloudflareaccess.com`) |
| `CF_ACCESS_AUD` | Cloudflare Access Application Audience tag |

### Optional

| Secret | Description |
|--------|-------------|
| `DEV_MODE` | `true` → skip CF Access + device pairing (local dev only) |
| `E2E_TEST_MODE` | `true` → skip CF Access, keep device pairing |
| `DEBUG_ROUTES` | `true` → enable `/debug/*` endpoints |
| `SANDBOX_SLEEP_AFTER` | Container idle timeout: `never` (default), `10m`, `1h` |
| `R2_ACCESS_KEY_ID` | R2 access key for persistence |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_BUCKET_NAME` | Override bucket name (default: `moltbot-data`) |
| `CF_ACCOUNT_ID` | Cloudflare account ID (for R2 endpoint) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` | Slack tokens |
| `CDP_SECRET` | Shared secret for `/cdp/*` authentication |
| `WORKER_URL` | Public worker URL (for CDP endpoint) |
| `CF_AI_GATEWAY_MODEL` | Model override: `provider/model-id` |

## Authentication Layers

1. **Cloudflare Access (edge)** — JWT validation on `/_admin/*`, `/api/*`, `/debug/*`, and the catch-all proxy. Skipped when `DEV_MODE=true`.
2. **Gateway Token (container)** — `MOLTBOT_GATEWAY_TOKEN` is passed to the container as `OPENCLAW_GATEWAY_TOKEN`. The worker injects it into WebSocket URLs via `?token=` query param before `sandbox.wsConnect()`. The gateway validates the token on every connection.
3. **Device Pairing (container)** — New devices are held pending until approved via `/_admin/`. Paired devices are stored in OpenClaw config.

### Token Flow

```
Worker receives WS request
  → Checks env.MOLTBOT_GATEWAY_TOKEN
  → Appends ?token=<value> to URL if not already present
  → Calls sandbox.wsConnect(modifiedRequest, 18789)
  → Container gateway validates token
  → If valid, proceeds to device pairing check
```

## Conventions

- **Language:** TypeScript (strict mode)
- **Framework:** Hono.js (web framework for Workers)
- **Build:** Vite (client) + Wrangler (worker)
- **Linter:** oxlint
- **Formatter:** oxfmt
- **Tests:** Vitest, colocated `*.test.ts` files, `node` environment
- **Client:** React 19, JSX
- **Container:** `cloudflare/sandbox:0.7.0` base image

## Cloudflare Configuration

- **Worker name:** `moltbot-wetware`
- **Container:** `standard-1` (½ vCPU, 4 GiB RAM, 8 GB disk)
- **Compatibility date:** `2025-05-06`
- **Compatibility flags:** `nodejs_compat`
- **R2 bucket:** `moltbot-data`
- **Durable Objects:** `Sandbox` class (SQLite migration v1)
- **Browser binding:** `BROWSER` (for CDP/Puppeteer)
- **Static assets:** `./dist/client` (admin UI, SPA mode)

## Debugging

### Enable debug routes

```bash
npx wrangler secret put DEBUG_ROUTES
# Enter: true
```

### Debug endpoints (require CF Access + `DEBUG_ROUTES=true`)

- `GET /debug/processes` — List all container processes (add `?logs=true` for stdout/stderr)
- `GET /debug/logs?id=<pid>` — Logs for a specific process
- `GET /debug/version` — Container + OpenClaw version info
- `GET /debug/container-config` — Dump OpenClaw config (verify `gateway.auth.token`)

### Live logs

```bash
npx wrangler tail                    # Stream worker logs
npx wrangler secret list             # Verify secrets are set
```

### Common issues

- **WebSocket `token_mismatch`:** `MOLTBOT_GATEWAY_TOKEN` not set, or not mapped to container env, or not injected into WS URL
- **Cold start 1-2 min:** Normal for sandbox containers
- **Exit code 126:** CRLF line endings in `start-openclaw.sh` (Windows Git). Fix: `git config core.autocrlf input`
- **WebSocket fails in `wrangler dev`:** Known limitation — WS proxying through sandbox doesn't work locally. Deploy to Cloudflare for full functionality.
- **R2 not working:** Ensure all three secrets set (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CF_ACCOUNT_ID`). R2 mounting only works in production.

## Container Startup Flow

`start-openclaw.sh` runs these phases:

1. **R2 restore** — If R2 configured, restore config/workspace/skills via rclone (handles legacy `.clawdbot` → `openclaw` migration)
2. **Onboard** — If no config exists, `openclaw onboard --non-interactive` creates one
3. **Config patch** — Node.js script patches `openclaw.json` for channels, gateway auth token, trusted proxies, AI Gateway model overrides, OpenRouter
4. **Sync loop** — Background process watches for file changes, syncs to R2 every 30 seconds
5. **Start gateway** — `exec openclaw gateway --port 18789 --verbose --allow-unconfigured --bind lan [--token $OPENCLAW_GATEWAY_TOKEN]`

## Adding a New Environment Variable

1. Add to `MoltbotEnv` in `src/types.ts`
2. If passed to container, add to `buildEnvVars()` in `src/gateway/env.ts`
3. If used in startup, add handling in `start-openclaw.sh`
4. Update `.dev.vars.example`
5. Document in README.md secrets table

## Reference Docs

- [Cloudflare Sandbox SDK](https://developers.cloudflare.com/sandbox/)
- [Sandbox WebSocket Connections](https://developers.cloudflare.com/sandbox/guides/websocket-connections/) — `sandbox.wsConnect(request, port)`
- [Cloudflare Moltworker Blog Post](https://blog.cloudflare.com/moltworker-self-hosted-ai-agent/)
- [OpenClaw Documentation](https://docs.openclaw.ai/)
- [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
- [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- [Cloudflare Containers Pricing](https://developers.cloudflare.com/containers/pricing/)
