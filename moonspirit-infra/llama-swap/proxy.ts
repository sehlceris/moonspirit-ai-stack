import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROXY_PORT = parseInt(process.env.PROXY_PORT ?? "3000", 10);
const UPSTREAM_URL = process.env.UPSTREAM_URL ?? "http://127.0.0.1:8080";

// Hop-by-hop headers that must not be forwarded
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade",
]);

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
// Some chat templates (e.g. gpt-oss-120b) reject assistant messages that have
// both `thinking` and `content` alongside `tool_calls`.  Merge thinking into
// content so the template only sees one text field.

const sanitizeMessages = (body: Record<string, unknown>): Record<string, unknown> => {
  const messages = body.messages;
  if (!Array.isArray(messages)) return body;

  let modified = false;
  for (const msg of messages) {
    if (
      msg.role === "assistant" &&
      msg.tool_calls &&
      msg.thinking &&
      msg.content
    ) {
      msg.content = msg.thinking + "\n\n" + msg.content;
      delete msg.thinking;
      modified = true;
    }
  }

  if (modified) {
    console.log("Sanitized assistant messages: merged thinking into content");
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
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        const parsed = JSON.parse(raw);
        const sanitized = sanitizeMessages(parsed);
        const newBody = Buffer.from(JSON.stringify(sanitized), "utf-8");
        forwardRequest(req, res, headers, newBody);
      } catch {
        // If we can't parse the body, forward as-is
        forwardRequest(req, res, headers, Buffer.concat(chunks));
      }
    });
  } else {
    forwardRequest(req, res, headers);
  }
});

server.on("error", (err) => {
  console.error(`Server error: ${err.message}`);
});

server.listen(PROXY_PORT, "0.0.0.0", () => {
  console.log(`Proxy listening on 0.0.0.0:${PROXY_PORT} -> ${UPSTREAM_URL} [${apiKeys.size} key(s)]`);
});

process.on("uncaughtException", (err) => {
  console.error(`Uncaught exception: ${err.message}`);
});

process.on("unhandledRejection", (reason) => {
  console.error(`Unhandled rejection: ${reason}`);
});
