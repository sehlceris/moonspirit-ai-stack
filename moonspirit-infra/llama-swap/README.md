# llama-swap

Run multiple large language models locally on macOS Apple Silicon with automatic model swapping, Bearer-token auth, and an OpenAI-compatible API.

## How It Works

Three services form a pipeline:

```
Client -> proxy.ts (:3000, auth) -> llama-swap (:8080, model routing) -> llama-server (:10001+, inference)
```

| Component | Role |
|-----------|------|
| **llama-server** | [llama.cpp](https://github.com/ggerganov/llama.cpp) inference engine. Loads a GGUF model, runs on Metal GPU, exposes an OpenAI-compatible API. |
| **llama-swap** | [mostlygeek/llama-swap](https://github.com/mostlygeek/llama-swap) — Go proxy that routes requests by model name and starts/stops llama-server instances on demand. Only one LLM loads at a time; embeddings run in a separate group so they stay available. |
| **proxy.ts** | Lightweight TypeScript auth proxy. Validates `Authorization: Bearer <key>` on every request, streams responses through without buffering. |

## Default Models

LLMs share a swap group (one loaded at a time). The embeddings model runs alongside any active LLM.

| Model | Type | Params (total / active) | Quant | Size | Context |
|-------|------|------------------------|-------|------|---------|
| [gpt-oss-120b](https://huggingface.co/ggml-org/gpt-oss-120b-GGUF) | Reasoning | 117B / 5.1B (MoE) | MXFP4 | ~63 GB | 96k |
| [GLM-4.7-Flash](https://huggingface.co/unsloth/GLM-4.7-Flash-GGUF) | General | 30B / 3B (MoE) | UD-Q4_K_XL | ~17.5 GB | 128k |
| [Qwen3-Coder-Next](https://huggingface.co/unsloth/Qwen3-Coder-Next-GGUF) | Coding | 80B / 3B (MoE) | Q4_K_M | ~48.5 GB | 128k |
| [nomic-embed-text-v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF) | Embeddings | 137M | f16 | ~274 MB | 8k |

All LLMs are Mixture-of-Experts — only a fraction of parameters activate per token, so inference is fast despite the large total sizes.

## Prerequisites

- macOS Apple Silicon (M1/M2/M3/M4)
- Homebrew, Node.js
- 80 GB+ unified memory (128 GB recommended)
- ~150 GB free disk space

## Quick Start

```bash
# 1. Install dependencies
brew install llama.cpp huggingface-cli
brew tap mostlygeek/llama-swap && brew install llama-swap

# 2. Download models (~130 GB total, skips existing)
./scripts/download-default-models.sh

# 3. Install Node dependencies
npm install

# 4. Set up API keys
cp config.example.json config.json   # then edit with your own keys

# 5. Start the stack
./scripts/start.sh          # foreground (Ctrl+C to stop)
./scripts/start.sh --bg     # background mode

# 6. Test
npx tsx test-inference.ts    # non-streaming completion
npx tsx test-streaming.ts    # streaming completion
npx tsx test-embeddings.ts   # embeddings
```

### start.sh flags

| Flag | Default | Description |
|------|---------|-------------|
| `--port PORT` | 8080 | llama-swap port (localhost only) |
| `--proxy-port PORT` | 3000 | Auth proxy port (0.0.0.0) |
| `--bg` | — | Run in background, logs to `*.log` files |
| `--no-watch` | — | Disable auto-reload on config.yaml changes |

## Directory Layout

```
llama-swap/
├── proxy.ts                    # Auth proxy source
├── config.yaml                 # llama-swap model routing config
├── config.example.json         # API keys template (copy to config.json)
├── test-inference.ts           # Non-streaming test
├── test-streaming.ts           # Streaming test
├── test-embeddings.ts          # Embeddings test
├── scripts/
│   ├── start.sh                # Start both services
│   ├── stop.sh                 # Stop background services
│   ├── download-default-models.sh
│   ├── download-model.sh       # Download any HuggingFace GGUF repo
│   ├── autostart-install.sh    # macOS LaunchAgent (start on login)
│   └── autostart-uninstall.sh
└── models/                     # GGUF files (gitignored, ~130 GB)
```

## API Endpoints

All endpoints require a Bearer token from your `config.json` and are served at `http://localhost:3000/v1`.

### LLM Chat Completions

`POST /v1/chat/completions`

Available models: `gpt-oss-120b`, `glm-4.7-flash`, `qwen3-coder-next` (and their aliases).

**Streaming:**

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-oss-120b",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

**Non-streaming:**

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-4.7-flash",
    "messages": [{"role": "user", "content": "Explain quantum computing in one sentence."}],
    "stream": false,
    "max_tokens": 200
  }'
```

### Embeddings

`POST /v1/embeddings`

Available models: `nomic-embed` (aliases: `nomic-embed-text`, `text-embedding-nomic`, `nomic-ai/nomic-embed-text-v1.5`).

Returns 768-dimensional vectors. The embeddings model runs in a separate group, so it stays loaded alongside whichever LLM is active.

```bash
curl http://localhost:3000/v1/embeddings \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nomic-embed",
    "input": ["Hello, world!", "Embeddings are useful for semantic search."]
  }'
```

Single string input also works:

```bash
curl http://localhost:3000/v1/embeddings \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nomic-embed",
    "input": "A single sentence to embed."
  }'
```

### List Models

`GET /v1/models`

```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer YOUR_KEY"
```

### Operations (localhost only)

```bash
curl http://127.0.0.1:8080/running                   # check loaded model
curl -X POST http://127.0.0.1:8080/models/unload     # unload current model
open http://127.0.0.1:8080/ui                         # web dashboard
brew upgrade llama.cpp llama-swap                      # upgrade
```

### Adding Models

```bash
./scripts/download-model.sh <hf-repo> [--include <pattern>]
```

Then add an entry to `config.yaml` and assign it to a group. Changes apply automatically if `--watch-config` is active (on by default).

## IDE Integration

### OpenCode

See [OPENCODE.md](OPENCODE.md) for full setup. In short, add a `llama-swap` provider to your project's `opencode.json` pointing at `http://localhost:3000/v1` with your API key. Match each model's `limit.context` to its `--ctx-size` in `config.yaml`.

### Any OpenAI-compatible tool

Use base URL `http://localhost:3000/v1`, set your API key as the Bearer token, and use model names from `config.yaml` (e.g. `gpt-oss-120b`, `glm-4.7-flash`, `qwen3-coder-next`). Model aliases also work (e.g. `gpt-oss`, `qwen3-coder`). For embeddings, use model `nomic-embed` with the `/v1/embeddings` endpoint.

## Autostart on Login

```bash
./scripts/autostart-install.sh     # enable (opens Terminal on login)
./scripts/autostart-uninstall.sh   # disable
```

## Auth Proxy Details

- Reads keys from `config.json` (priority) or `API_KEYS` env var (comma-separated)
- Returns `401` for missing/invalid tokens, `502` on upstream failure
- Streams responses without buffering — no added latency
- Binds to `0.0.0.0` so it's accessible from other devices on your network

## Tuning

| Setting | Where | Notes |
|---------|-------|-------|
| Context size | `config.yaml` `--ctx-size` | Larger = more memory. For big contexts with less RAM: add `--cache-type-k q8_0 --cache-type-v q4_0` |
| TTL | `config.yaml` `ttl` | `0` = never auto-unload. Set a value (seconds) for idle timeout. |
| `--mlock` | `config.yaml` | Keeps model pinned in RAM. Remove if you're hitting memory pressure. |
| Preload | `config.yaml` | Add `hooks.on_startup.preload` to load a model at startup instead of on first request. |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Health check timeout | Check memory (`memory_pressure`), reduce `--ctx-size`, inspect `curl http://127.0.0.1:8080/logs` |
| Slow first response | Normal — 30-90s model load time. Use preload hook to warm up at startup. |
| OOM / memory pressure | Reduce `--ctx-size`, remove `--mlock`, add KV cache quantization flags |
| Port in use | `lsof -i :8080` or `lsof -i :3000` to find the conflict |
