# Local LLM Server Setup

Run local LLMs and embeddings on macOS Apple Silicon via llama.cpp, llama-swap, and an auth proxy.

## Architecture

```
Client -> proxy.ts (:3000, auth) -> llama-swap (:8080, model routing) -> llama-server (:10001+, inference)
```

| Component | What it does |
|-----------|-------------|
| **llama-server** | llama.cpp inference engine. Loads GGUF model, runs on Metal GPU, exposes OpenAI-compatible API. |
| **llama-swap** | Go proxy ([mostlygeek/llama-swap](https://github.com/mostlygeek/llama-swap)). Routes by model name, starts/stops llama-server instances on demand. Config: `config.yaml`. |
| **proxy.ts** | TypeScript auth proxy. Validates Bearer tokens, streams responses through to llama-swap. Reads keys from `config.json` or `API_KEYS` env var. |

## Prerequisites

- macOS Apple Silicon (M1/M2/M3/M4)
- Homebrew, Node.js (for proxy and tests)
- 80 GB+ unified memory (128 GB recommended)
- ~150 GB free disk space (all default models)

## Setup

### 1. Install dependencies

```bash
brew install llama.cpp
brew tap mostlygeek/llama-swap && brew install llama-swap
brew install huggingface-cli
```

### 2. Download models

```bash
./scripts/download-default-models.sh    # all default models (~130 GB total)
./scripts/download-model.sh <hf-repo>   # or download individually
```

Skips models already downloaded. See [Default Models](#default-models) for the full list.

### 3. Install Node dependencies

```bash
npm install
```

### 4. Configure API keys

Copy the example and add your keys:

```bash
cp config.example.json config.json
```

Edit `config.json`:

```json
{ "apiKeys": ["your-key-here"] }
```

Alternatively, set `API_KEYS=key1,key2` env var (config.json takes priority).

### 5. Start the stack

```bash
./scripts/start.sh          # foreground (Ctrl+C stops both)
./scripts/start.sh --bg     # background (logs to llama-swap.log, proxy.log)
./scripts/stop.sh           # stop both background processes
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port PORT` | `8080` | llama-swap port (127.0.0.1 only) |
| `--proxy-port PORT` | `3000` | Auth proxy port (0.0.0.0) |
| `--bg` | — | Run in background |
| `--no-watch` | — | Don't auto-reload config.yaml on change |

### 6. Test

```bash
npx tsx test-inference.ts    # single completion
npx tsx test-streaming.ts    # streaming completion
```

## Directory Structure

```
llama-swap/
├── config.yaml              # llama-swap model config
├── config.example.json      # API keys template (copy to config.json)
├── config.json              # API keys (gitignored)
├── proxy.ts                 # Auth proxy (port 3000)
├── test-inference.ts        # Inference test script
├── test-streaming.ts        # Streaming test script
├── package.json
├── tsconfig.json
├── scripts/
│   ├── start.sh               # Start both services
│   ├── stop.sh                # Stop both services
│   ├── autostart-install.sh   # Enable launch-on-login
│   ├── autostart-uninstall.sh   # Disable launch-on-login
│   ├── download-default-models.sh # Download all default models
│   └── download-model.sh         # Download a single HF model
├── models/                  # gitignored, ~63 GB
└── node_modules/            # gitignored
```

## Default Models

LLMs swap — one loaded at a time. Embeddings run in a separate group alongside the active LLM.

| Model | Type | Params (total/active) | Quant | Size | Context |
|-------|------|-----------------------|-------|------|---------|
| [gpt-oss-120b](https://huggingface.co/ggml-org/gpt-oss-120b-GGUF) | Reasoning LLM | 117B / 5.1B (MoE) | MXFP4 | ~63 GB | 128k |
| [GLM-4.7-Flash](https://huggingface.co/bartowski/zai-org_GLM-4.7-Flash-GGUF) | General LLM | 30B / 3B (MoE) | Q4_K_M | ~18 GB | 128k |
| [Qwen3-Coder-Next](https://huggingface.co/Qwen/Qwen3-Coder-Next-GGUF) | Coding LLM | 80B / 3B (MoE) | Q4_K_M | ~48 GB | 256k |
| [nomic-embed-text-v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF) | Embeddings | 137M | f16 | ~274 MB | 8k |

MoE models only activate a fraction of parameters per token, so inference speed is much faster than their total param count suggests.

## Operations

```bash
curl http://127.0.0.1:8080/running                     # check loaded models
curl -X POST http://127.0.0.1:8080/models/unload       # unload current model
open http://127.0.0.1:8080/ui                           # web dashboard
./scripts/download-model.sh <hf-repo> [--include PAT]   # download a model
brew upgrade llama.cpp llama-swap                        # upgrade
```

## Autostart on Login

Opens the stack in a Terminal window on login (macOS LaunchAgent). Ctrl+C in that window stops both services.

```bash
./scripts/autostart-install.sh     # enable
./scripts/autostart-uninstall.sh   # disable
launchctl start com.moonspirit.llama-swap  # trigger now without rebooting
```

## Notes

- **Context size:** Default 8192. Increase in `config.yaml` (`--ctx-size`). For larger contexts with less memory: `--cache-type-k q8_0 --cache-type-v q4_0`.
- **TTL:** Set to 0 (never auto-unload). Change `ttl` in config.yaml for idle timeout.
- **`--mlock`:** Keeps model in physical RAM. Remove if memory pressure is an issue.
- **`--watch-config`:** Enabled by default; config.yaml changes apply without restart.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Health check timeout | Check memory (`memory_pressure`), reduce `--ctx-size`, check `curl http://127.0.0.1:8080/logs` |
| Slow first response | Normal — 30-90s model load. Add `hooks.on_startup.preload` in config.yaml to preload. |
| OOM | Reduce `--ctx-size`, remove `--mlock`, add KV cache quantization |
| Port in use | `lsof -i :8080` or `lsof -i :3000` |
