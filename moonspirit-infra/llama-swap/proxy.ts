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
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
};

// --- Proxy ---

const upstream = new URL(UPSTREAM_URL);

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
  // Ensure Host matches the upstream target
  headers.host = upstream.host;

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
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", () => {
    sendJson(res, 502, { error: "Bad Gateway" });
  });

  // Stream request body to upstream
  req.pipe(proxyReq);
});

server.listen(PROXY_PORT, () => {
  console.log(`Proxy listening on :${PROXY_PORT} -> ${UPSTREAM_URL} [${apiKeys.size} key(s)]`);
});
