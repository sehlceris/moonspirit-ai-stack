# Spec — Local LLM Auth Proxy

## Requirements

### Startup
- `./scripts/start-server.sh` launches llama-swap, which manages llama-server instances
- Model `gpt-oss-120b` loads automatically on first request (already downloaded)

### Auth Proxy (`proxy.ts`)
- TypeScript HTTP server on port 3000 (configurable via `PROXY_PORT`)
- Validates `Authorization: Bearer <key>` on every request
- Returns `401 {"error": "Unauthorized"}` for missing/invalid tokens
- Proxies valid requests to llama-swap with full streaming support (no buffering)
- Returns `502 {"error": "Bad Gateway"}` on upstream connection failure

### API Key Configuration
- Reads keys from `config.json` (`{ "apiKeys": ["key1", ...] }`) — takes priority
- Falls back to `API_KEYS` env var (comma-separated)
- Exits with error if neither source provides keys

### Test Scripts
- `test-inference.ts` — non-streaming chat completion, validates HTTP 200, JSON structure, non-empty response
- `test-streaming.ts` — streaming chat completion, validates SSE `text/event-stream`, multiple chunks (proves streaming), `data: [DONE]` terminator
- Both executable via `npx tsx <script>`, exit 0 on pass, exit 1 on fail
- Both support reasoning models (`reasoning_content` + `content` fields)

### Streaming
- Proxy pipes upstream response directly to client (no buffering)
- SSE chunks arrive incrementally (validated by test: chunk count > 1)

## Verified
- Auth rejects invalid tokens (401)
- Auth passes valid tokens through to llama-swap
- Non-streaming inference returns valid completion
- Streaming inference delivers tokens incrementally (38 chunks observed in test)
- Reasoning model output handled correctly (reasoning_content + content)
