# Using OpenCode with This Stack

Connect [OpenCode](https://opencode.ai) to your local llama-swap stack with authentication and per-model context limits.

## Prerequisites

- The llama-swap stack is running (`./scripts/start.sh`)
- You have an API key from `config.json`
- OpenCode is installed (`go install github.com/anomalyco/opencode@latest` or see [opencode.ai](https://opencode.ai))

## Configure `opencode.json`

Add this to your project's `opencode.json` (or create one):

```json
{
  "provider": {
    "llama-swap": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llama-swap (local)",
      "options": {
        "baseURL": "http://localhost:3000/v1",
        "apiKey": "your-api-key-from-config-json"
      },
      "models": {
        "gpt-oss-120b": {
          "name": "GPT-OSS 120B (Reasoning)",
          "limit": {
            "context": 98304,
            "output": 65536
          }
        },
        "glm-4.7-flash": {
          "name": "GLM 4.7 Flash (General)",
          "limit": {
            "context": 131072,
            "output": 65536
          }
        },
        "qwen3-coder-next": {
          "name": "Qwen3 Coder Next (Coding)",
          "limit": {
            "context": 131072,
            "output": 65536
          }
        }
      }
    }
  }
}
```

### Authentication

The `apiKey` in `options` is sent as a `Bearer` token with every request. Use any key from your `config.json` (or the `API_KEYS` env var). Point `baseURL` at the auth proxy (port 3000), not llama-swap directly (port 8080).

### Context Limits

The `limit.context` values must match the `--ctx-size` in `config.yaml`:

| Model | `--ctx-size` | `limit.context` |
|-------|-------------|-----------------|
| gpt-oss-120b | 98304 (96k) | 98304 |
| glm-4.7-flash | 131072 (128k) | 131072 |
| qwen3-coder-next | 131072 (128k) | 131072 |

If these don't match, OpenCode's auto-compaction will trigger too early or too late, leading to wasted context or HTTP 400 errors from llama-server.

## Auto-Compaction

OpenCode automatically compacts conversations when they approach the context limit. This is enabled by default. To tune it, add to `opencode.json`:

```json
{
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 1000
  }
}
```

- **auto**: Trigger compaction when context overflows (default: `true`)
- **prune**: Remove old tool outputs to reclaim tokens (default: `true`)
- **reserved**: Token buffer to prevent overflow during the compaction step itself

## Verify

Start OpenCode in your project directory and select a llama-swap model. Run a simple prompt to confirm the connection works through the auth proxy.
