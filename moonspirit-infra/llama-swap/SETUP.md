# Moonspirit Infra — Local LLM Server Setup

Run OpenAI's gpt-oss-120b (and other models) locally on macOS Apple Silicon via **llama.cpp** and **llama-swap**.

## Architecture Overview

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────────────┐
│  Your App /CLI  │──────▶│   llama-swap    │──────▶│     llama-server        │
│  (OpenAI API)   │ :8080 │  (proxy/router) │ :1000x│  (llama.cpp inference)  │
└─────────────────┘       └─────────────────┘       └─────────────────────────┘
                           Extracts model name        Actually runs the model
                           from request, starts/       on GPU (Metal) and
                           stops servers as needed     serves completions
```

### What Each Component Does

| Component | Role |
|-----------|------|
| **llama-server** | The inference engine from [llama.cpp](https://github.com/ggml-org/llama.cpp). Loads a GGUF model file into memory, runs it on Apple Metal GPU, and exposes an OpenAI-compatible HTTP API. One instance runs one model at a time. |
| **llama-swap** | A lightweight Go proxy from [mostlygeek/llama-swap](https://github.com/mostlygeek/llama-swap). Sits in front of llama-server and manages model lifecycle. When you request a model, llama-swap starts the right llama-server instance. If a different model is already loaded, it swaps — stops the old one and starts the new one. Supports keeping models in memory indefinitely. |
| **GGUF model files** | Quantized model weights in the GGUF format that llama.cpp understands. The gpt-oss-120b model uses MXFP4 quantization (OpenAI's native training precision) and is ~63 GB across 3 split files. |

## Prerequisites

- macOS on Apple Silicon (M1/M2/M3/M4 — any variant)
- [Homebrew](https://brew.sh)
- At least 80 GB of available unified memory for gpt-oss-120b (128 GB recommended)
- ~70 GB free disk space for the model files

## Fresh Setup (New Mac)

### 1. Install Dependencies

```bash
# llama.cpp (provides llama-server)
brew install llama.cpp

# llama-swap (model proxy/manager)
brew tap mostlygeek/llama-swap
brew install llama-swap

# Hugging Face CLI (for downloading models)
brew install huggingface-cli
```

### 2. Clone This Repo

```bash
git clone <your-repo-url> moonspirit-infra
cd moonspirit-infra
```

### 3. Download the Model

```bash
./scripts/download-model.sh ggml-org/gpt-oss-120b-GGUF
```

This downloads the official MXFP4 GGUF (~63 GB, 3 split files) into `models/gpt-oss-120b-GGUF/`. The download will take a while depending on your connection.

### 4. Start the Server

```bash
# Foreground (see logs in terminal, Ctrl+C to stop):
./scripts/start-server.sh

# Background (logs to llama-swap.log):
./scripts/start-server.sh --bg

# Custom port:
./scripts/start-server.sh --port 9090
```

### 5. Use It

The server is now at `http://127.0.0.1:8080` with a full OpenAI-compatible API.

```bash
# Quick test
curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-oss-120b",
    "messages": [{"role": "user", "content": "Hello! What are you?"}],
    "stream": true
  }'
```

The first request will take some time as the model loads (~63 GB into GPU memory). Subsequent requests are fast.

**Web dashboard:** Open `http://127.0.0.1:8080/ui` to see logs, loaded models, and system status.

## Operations Guide

### Starting and Stopping

| Action | Command |
|--------|---------|
| Start (foreground) | `./scripts/start-server.sh` |
| Start (background) | `./scripts/start-server.sh --bg` |
| Stop (background) | `./scripts/stop-server.sh` |
| Stop (foreground) | `Ctrl+C` |
| Check what's running | `curl http://127.0.0.1:8080/running` |
| Manually unload model | `curl -X POST http://127.0.0.1:8080/models/unload` |

### Downloading Additional Models

```bash
# Any Hugging Face GGUF repo:
./scripts/download-model.sh <hf-repo>

# With a specific file pattern (for repos with multiple quants):
./scripts/download-model.sh bartowski/openai_gpt-oss-120b-GGUF --include "openai_gpt-oss-120b-Q4_K_M/*"

# Another model entirely:
./scripts/download-model.sh TheBloke/Mistral-7B-Instruct-v0.2-GGUF --include "*Q4_K_M.gguf"
```

Models land in `models/<repo-name>/`.

### Adding a New Model to llama-swap

Edit `config.yaml` and add a new entry under `models:`:

```yaml
models:
  "my-new-model":
    cmd: >
      ${llama_server}
      --port ${PORT}
      --model ${models_dir}/my-model-folder/my-model.gguf
      --ctx-size 32768
      --n-gpu-layers 999
      --flash-attn on
      --jinja
    ttl: 0
    aliases:
      - "my-alias"
```

If `--watch-config` is enabled (default in start-server.sh), the change takes effect immediately — no restart needed.

### Model Swapping Behavior

- With `ttl: 0`, a loaded model **stays in memory forever** until you load a different model or shut down
- When you request a model that isn't loaded and a different model IS loaded, llama-swap stops the old server and starts the new one (the "swap")
- The swap takes time (the new model must load into GPU memory)
- To run multiple models simultaneously, use the `groups` feature in config.yaml — see the [llama-swap wiki](https://github.com/mostlygeek/llama-swap/wiki/Configuration)

### Connecting Clients

Any OpenAI-compatible client works. Set:
- **Base URL:** `http://127.0.0.1:8080/v1`
- **API Key:** anything (no auth configured by default)
- **Model:** `gpt-oss-120b` (or any alias from config.yaml)

Examples:
- **Python (openai SDK):** `client = OpenAI(base_url="http://127.0.0.1:8080/v1", api_key="unused")`
- **curl:** See the test command above
- **Continue (VS Code):** Set provider to OpenAI-compatible, point to localhost:8080

### Updating Components

```bash
brew upgrade llama.cpp
brew upgrade llama-swap
```

## Directory Structure

```
moonspirit-infra/
├── config.yaml              # llama-swap configuration
├── SETUP.md                 # This file
├── models/                  # Downloaded model files (gitignored — large!)
│   └── gpt-oss-120b-GGUF/  # ~63 GB, 3 split GGUF files
├── scripts/
│   ├── download-model.sh    # Download GGUF models from Hugging Face
│   ├── start-server.sh      # Start llama-swap (foreground or background)
│   └── stop-server.sh       # Stop background llama-swap
├── llama-swap.log           # Log file (when running in background)
└── llama-swap.pid           # PID file (when running in background)
```

## About gpt-oss-120b

| Attribute | Value |
|-----------|-------|
| Total Parameters | 117B |
| Active Parameters | 5.1B per token (Mixture of Experts) |
| Architecture | MoE — 128 experts, 4 active per token |
| Quantization | MXFP4 (native training precision) |
| Model Size on Disk | ~63 GB (3 split GGUF files) |
| Context Length | Up to 128k tokens (see notes below) |
| License | Apache 2.0 |

The MoE architecture is why this model is practical on a Mac: despite 117B total parameters, only 5.1B activate per token, so inference speed is closer to a 7B model while quality approaches much larger dense models.

## Decisions and Trade-offs

These are choices I made that you might want to revisit:

### Context Size: 8192 tokens (conservative)

The model supports up to 128k tokens, but KV cache memory grows with context size. At 8192 tokens with the model's ~63 GB footprint, total memory usage stays well under 128 GB. You can increase this:

- `--ctx-size 16384` — safe on 128 GB, moderate memory increase
- `--ctx-size 32768` — should work on 128 GB but leaves less headroom
- `--ctx-size 65536` — may work but monitor memory pressure
- `--ctx-size 131072` — full 128k context, may require 192 GB+ or KV cache quantization

To use larger contexts with less memory, add KV cache quantization:
```
--cache-type-k q8_0 --cache-type-v q4_0
```

### MXFP4 Quantization (vs Q4_K_M, Q6_K, etc.)

I chose `ggml-org/gpt-oss-120b-GGUF` which is the MXFP4 variant — this preserves OpenAI's original training precision. Because of the MoE architecture, all quantization levels produce nearly identical file sizes (~62-65 GB), since the MoE expert weights are already in 4-bit. MXFP4 is the recommended choice; there's no meaningful size savings from more aggressive quantization, only quality loss.

### TTL: 0 (never auto-unload)

Per your request, models stay in memory indefinitely. If you add multiple large models and want automatic eviction, change `ttl` to a value in seconds (e.g., `ttl: 300` for 5-minute idle timeout).

### Single Model at a Time

The default config runs one model at a time (swap mode). With 128 GB, you could potentially run gpt-oss-120b alongside a smaller model using the `groups` feature:

```yaml
groups:
  "always-on":
    swap: false
    members:
      - "gpt-oss-120b"
      - "small-helper-model"
```

### No API Key

No authentication is configured. The server only listens on `127.0.0.1` (localhost), so it's not accessible from the network. If you expose it on `0.0.0.0` or through a reverse proxy, add API keys:

```yaml
apiKeys:
  - "your-secret-key-here"
```

### Health Check Timeout: 600 seconds

Loading a 63 GB model can take 30-90 seconds on an M1 Ultra (depending on disk speed and whether the OS has the file cached). 600 seconds is generous. You could lower this to 180 if you find it loads consistently fast.

### --mlock Flag

This tells the OS to keep the model in physical RAM and not swap it out. On macOS with unified memory this helps ensure the model stays GPU-accessible. If you experience memory pressure issues with other apps, you can remove this flag to let macOS manage memory more flexibly.

### --jinja Flag

Enables the Jinja chat template embedded in the GGUF file. This ensures the model's chat format is applied correctly without manual template configuration. Recommended for all models that include a template.

## Troubleshooting

**Model won't load / health check timeout:**
- Check available memory: `memory_pressure` in Terminal
- Reduce `--ctx-size` in config.yaml
- Check logs: `curl http://127.0.0.1:8080/logs` or see llama-swap.log

**Slow first response:**
- Normal — the model takes 30-90s to load into GPU memory on first request
- Subsequent requests are fast
- To preload on startup, add to config.yaml:
  ```yaml
  hooks:
    on_startup:
      preload:
        - "gpt-oss-120b"
  ```

**Out of memory / system becomes unresponsive:**
- Reduce `--ctx-size` (biggest memory lever after model size)
- Remove `--mlock` to let macOS swap if needed
- Add KV cache quantization: `--cache-type-k q8_0 --cache-type-v q4_0`

**Port already in use:**
- Use `--port` flag with start-server.sh: `./scripts/start-server.sh --port 9090`
- Or find what's using the port: `lsof -i :8080`
