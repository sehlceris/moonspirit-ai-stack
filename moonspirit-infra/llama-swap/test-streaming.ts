import http from "node:http";

const PROXY_URL = process.env.PROXY_URL ?? "http://127.0.0.1:3000";
const API_KEY = process.env.API_KEY ?? "test-key-1";
const MODEL = "gpt-oss-120b";

const url = new URL("/v1/chat/completions", PROXY_URL);

const payload = JSON.stringify({
  model: MODEL,
  messages: [{ role: "user", content: "Count from 1 to 5, one number per line." }],
  stream: true,
  max_tokens: 500,
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
  console.error(`\nFAIL: ${reason}`);
  process.exit(1);
};

console.log(`Testing streaming inference against ${url.href}`);
console.log(`Model: ${MODEL}\n`);

const req = http.request(options, (res) => {
  // Validate HTTP status
  if (res.statusCode !== 200) {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => fail(`Expected HTTP 200, got ${res.statusCode}\n${Buffer.concat(chunks).toString()}`));
    return;
  }
  console.log("HTTP 200 OK");

  // Validate content type
  const contentType = res.headers["content-type"] ?? "";
  if (!contentType.includes("text/event-stream")) {
    fail(`Expected content-type text/event-stream, got: ${contentType}`);
  }
  console.log(`Content-Type: ${contentType}`);

  let chunkCount = 0;
  let receivedDone = false;
  let buffer = "";

  process.stdout.write("\nTokens: ");

  res.on("data", (raw: Buffer) => {
    buffer += raw.toString();

    // Process complete lines from the buffer
    const lines = buffer.split("\n");
    // Keep the last (potentially incomplete) line in the buffer
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith(":")) continue;

      if (trimmed === "data: [DONE]") {
        receivedDone = true;
        continue;
      }

      if (!trimmed.startsWith("data: ")) continue;

      const jsonStr = trimmed.slice(6);
      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        fail(`Chunk is not valid JSON: ${jsonStr.slice(0, 200)}`);
      }

      // Validate chunk structure
      if (!Array.isArray(parsed.choices) || parsed.choices.length === 0) {
        fail(`Chunk missing choices array: ${jsonStr.slice(0, 200)}`);
      }

      const delta = parsed.choices[0]?.delta;
      if (delta === undefined) {
        fail(`Chunk missing choices[0].delta: ${jsonStr.slice(0, 200)}`);
      }

      chunkCount++;

      // Print token content inline (reasoning models emit reasoning_content too)
      const token = delta.content ?? delta.reasoning_content ?? "";
      if (token) {
        process.stdout.write(token);
      }
    }
  });

  res.on("end", () => {
    console.log(`\n\nChunks received: ${chunkCount}`);

    if (!receivedDone) {
      fail("Stream did not end with data: [DONE]");
    }
    console.log("Received data: [DONE]");

    if (chunkCount <= 1) {
      fail(`Expected more than 1 chunk to prove streaming, got ${chunkCount}`);
    }
    console.log(`Streaming confirmed (${chunkCount} chunks)`);

    console.log(`\n--- PASS ---`);
  });
});

req.on("error", (err) => fail(`Request error: ${err.message}`));
req.write(payload);
req.end();
