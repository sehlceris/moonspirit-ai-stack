import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROXY_PORT = parseInt(process.env.PROXY_PORT ?? "3000", 10);
const UPSTREAM_URL = process.env.UPSTREAM_URL ?? "http://127.0.0.1:8080";
const DEBUG = process.env.DEBUG === "1" || process.env.DEBUG === "true";

// Hop-by-hop headers that must not be forwarded
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade",
]);

// --- Debug logging ---

const debug = (...args: unknown[]) => {
  if (!DEBUG) return;
  const ts = new Date().toISOString();
  console.log(`[DEBUG ${ts}]`, ...args);
};

const summarizeMessage = (msg: Record<string, unknown>): string => {
  const role = msg.role ?? "?";
  const parts: string[] = [`role=${role}`];
  if (msg.content != null) parts.push(`content=${String(msg.content).length}ch`);
  if (msg.thinking != null) parts.push(`thinking=${String(msg.thinking).length}ch`);
  if (msg.reasoning_content != null) parts.push(`reasoning_content=${String(msg.reasoning_content).length}ch`);
  if (Array.isArray(msg.tool_calls)) parts.push(`tool_calls=${msg.tool_calls.length}`);
  if (msg.tool_call_id != null) parts.push(`tool_call_id=${msg.tool_call_id}`);
  if (msg.name != null) parts.push(`name=${msg.name}`);
  return `{ ${parts.join(", ")} }`;
};

const logMessages = (label: string, messages: unknown[]) => {
  debug(`${label} (${messages.length} messages):`);
  for (let i = 0; i < messages.length; i++) {
    debug(`  [${i}] ${summarizeMessage(messages[i] as Record<string, unknown>)}`);
  }
};

// --- API key loading ---

const loadApiKeys = (): Set<string> => {
  const configPath = path.join(__dirname, "config.json");

  // Prefer config.json if it exists
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.apiKeys) && parsed.apiKeys.length > 0) {
      return new Set(parsed.apiKeys as string[]);
    }
  } catch {
    // config.json missing or malformed — fall through to env var
  }

  // Fallback to API_KEYS env var
  const envKeys = process.env.API_KEYS;
  if (envKeys) {
    const keys = envKeys.split(",").map(k => k.trim()).filter(Boolean);
    if (keys.length > 0) return new Set(keys);
  }

  console.error("No API keys found. Provide config.json or set API_KEYS env var.");
  process.exit(1);
};

const apiKeys = loadApiKeys();

// --- Auth ---

const authenticate = (req: http.IncomingMessage): boolean => {
  const header = req.headers.authorization;
  if (!header) return false;
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return false;
  return apiKeys.has(parts[1]);
};

const sendJson = (res: http.ServerResponse, status: number, body: object) => {
  if (res.headersSent || res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
};

// --- Message sanitization ---
// The gpt-oss-120b Jinja chat template raises an exception when an assistant
// message with tool_calls contains both a reasoning field and content.
// OpenCode sends `reasoning_content` (OpenAI-style); llama.cpp maps that to
// `thinking` internally.  For assistant+tool_calls messages, drop the reasoning
// fields — they're prior-turn chain-of-thought that doesn't need to be sent
// back.  If content is empty, leave reasoning as-is (it becomes the sole text
// field, which the template handles fine).

const sanitizeMessages = (body: Record<string, unknown>): Record<string, unknown> => {
  const messages = body.messages;
  if (!Array.isArray(messages)) {
    debug("sanitizeMessages: no messages array found");
    return body;
  }

  if (DEBUG) logMessages("INCOMING messages", messages);

  let modified = false;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.tool_calls) continue;

    const hasThinking = msg.thinking != null;
    const hasReasoning = msg.reasoning_content != null;
    if (!hasThinking && !hasReasoning) continue;

    const content = typeof msg.content === "string" ? msg.content : "";

    // If content is empty, there's no conflict — the template accepts a single
    // reasoning field on its own.  Leave the message alone.
    if (!content) {
      debug(`  [${i}] SKIP: reasoning present but content is empty — no conflict`);
      continue;
    }

    debug(`  [${i}] DROPPING reasoning fields (content=${content.length}ch, thinking=${hasThinking}(${String(msg.thinking ?? "").length}ch), reasoning_content=${hasReasoning}(${String(msg.reasoning_content ?? "").length}ch))`);
    delete msg.thinking;
    delete msg.reasoning_content;
    modified = true;
  }

  if (modified) {
    console.log("Sanitized assistant messages: dropped reasoning fields");
    if (DEBUG) logMessages("OUTGOING messages (after sanitization)", messages);
  } else {
    debug("sanitizeMessages: no changes needed");
  }

  return body;
};

// --- Proxy ---

const upstream = new URL(UPSTREAM_URL);

const isChatCompletions = (url: string | undefined): boolean =>
  !!url && /\/v1\/chat\/completions\b/.test(url);

const forwardRequest = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  headers: http.OutgoingHttpHeaders,
  body?: Buffer,
) => {
  if (body) {
    headers["content-length"] = Buffer.byteLength(body);
  }

  const proxyReq = http.request(
    {
      hostname: upstream.hostname,
      port: upstream.port,
      path: req.url,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.on("error", (err) => {
        console.error(`Upstream response error: ${err.message}`);
        res.destroy();
      });
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    console.error(`Upstream request error: ${err.message}`);
    sendJson(res, 502, { error: "Bad Gateway" });
  });

  res.on("close", () => {
    if (!res.writableFinished) {
      console.error("Client disconnected, aborting upstream request");
      proxyReq.destroy();
    }
  });

  res.on("error", (err) => {
    console.error(`Client response error: ${err.message}`);
    proxyReq.destroy();
  });

  req.on("error", (err) => {
    console.error(`Client request error: ${err.message}`);
    proxyReq.destroy();
  });

  if (body) {
    proxyReq.end(body);
  } else {
    req.pipe(proxyReq);
  }
};

const server = http.createServer((req, res) => {
  if (!authenticate(req)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  // Build forwarded headers, stripping hop-by-hop
  const headers: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      headers[key] = value;
    }
  }
  headers.host = upstream.host;

  // For chat completions, buffer the body so we can sanitize messages
  if (isChatCompletions(req.url)) {
    debug(`>>> ${req.method} ${req.url} (chat completions — buffering for sanitization)`);
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      debug(`Request body size: ${raw.length} bytes`);
      try {
        const parsed = JSON.parse(raw);
        debug(`Model: ${parsed.model ?? "unknown"}, stream: ${parsed.stream ?? false}`);
        const sanitized = sanitizeMessages(parsed);
        const newBody = Buffer.from(JSON.stringify(sanitized), "utf-8");
        debug(`Forwarding sanitized body (${newBody.length} bytes)`);
        forwardRequest(req, res, headers, newBody);
      } catch (err) {
        debug(`JSON parse failed, forwarding raw body: ${err}`);
        forwardRequest(req, res, headers, Buffer.concat(chunks));
      }
    });
  } else {
    debug(`>>> ${req.method} ${req.url} (passthrough)`);
    forwardRequest(req, res, headers);
  }
});

server.on("error", (err) => {
  console.error(`Server error: ${err.message}`);
});

server.listen(PROXY_PORT, "0.0.0.0", () => {
  console.log(`Proxy listening on 0.0.0.0:${PROXY_PORT} -> ${UPSTREAM_URL} [${apiKeys.size} key(s)]${DEBUG ? " [DEBUG ON]" : ""}`);
});

process.on("uncaughtException", (err) => {
  console.error(`Uncaught exception: ${err.message}`);
});

process.on("unhandledRejection", (reason) => {
  console.error(`Unhandled rejection: ${reason}`);
});
