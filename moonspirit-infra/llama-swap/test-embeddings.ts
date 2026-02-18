import http from "node:http";

const PROXY_URL = process.env.PROXY_URL ?? "http://127.0.0.1:3000";
const API_KEY = process.env.API_KEY ?? "test-key-1";
const MODEL = "nomic-embed";

const url = new URL("/v1/embeddings", PROXY_URL);

const payload = JSON.stringify({
  model: MODEL,
  input: ["Hello, world!", "Embeddings are useful for semantic search."],
});

const options: http.RequestOptions = {
  hostname: url.hostname,
  port: url.port,
  path: url.pathname,
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
    "Content-Length": Buffer.byteLength(payload),
  },
};

const fail = (reason: string): never => {
  console.error(`FAIL: ${reason}`);
  process.exit(1);
};

console.log(`Testing embeddings against ${url.href}`);
console.log(`Model: ${MODEL}\n`);

const req = http.request(options, (res) => {
  const chunks: Buffer[] = [];

  res.on("data", (chunk: Buffer) => chunks.push(chunk));

  res.on("end", () => {
    if (res.statusCode !== 200) {
      fail(`Expected HTTP 200, got ${res.statusCode}\n${Buffer.concat(chunks).toString()}`);
    }
    console.log("HTTP 200 OK");

    const raw = Buffer.concat(chunks).toString();
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      fail(`Response is not valid JSON:\n${raw.slice(0, 500)}`);
    }
    console.log("Valid JSON response");

    // Validate object type
    if (body.object !== "list") {
      fail(`Expected object "list", got: "${body.object}"`);
    }

    // Validate data array
    if (!Array.isArray(body.data) || body.data.length !== 2) {
      fail(`Expected 2 embedding objects, got: ${JSON.stringify(body.data?.length)}`);
    }
    console.log(`Embeddings returned: ${body.data.length}`);

    // Validate each embedding
    for (let i = 0; i < body.data.length; i++) {
      const emb = body.data[i];
      if (emb.object !== "embedding") {
        fail(`data[${i}].object expected "embedding", got "${emb.object}"`);
      }
      if (!Array.isArray(emb.embedding) || emb.embedding.length === 0) {
        fail(`data[${i}].embedding expected non-empty array`);
      }
      if (typeof emb.embedding[0] !== "number") {
        fail(`data[${i}].embedding[0] expected number, got ${typeof emb.embedding[0]}`);
      }
      console.log(`  [${i}] dimensions: ${emb.embedding.length}, first value: ${emb.embedding[0].toFixed(6)}`);
    }

    // Validate usage
    if (!body.usage || typeof body.usage.prompt_tokens !== "number") {
      fail(`Expected usage.prompt_tokens, got: ${JSON.stringify(body.usage)}`);
    }
    console.log(`Usage: ${body.usage.prompt_tokens} prompt tokens`);

    // Validate model
    console.log(`Model: ${body.model}`);

    console.log(`\n--- PASS ---`);
  });
});

req.on("error", (err) => fail(`Request error: ${err.message}`));
req.write(payload);
req.end();
