import http from "node:http";

const PROXY_URL = process.env.PROXY_URL ?? "http://127.0.0.1:3000";
const API_KEY = process.env.API_KEY ?? "test-key-1";
const MODEL = "gpt-oss-120b";

const url = new URL("/v1/chat/completions", PROXY_URL);

const payload = JSON.stringify({
  model: MODEL,
  messages: [{ role: "user", content: "Say hello in exactly 5 words." }],
  stream: false,
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
  console.error(`FAIL: ${reason}`);
  process.exit(1);
};

console.log(`Testing non-streaming inference against ${url.href}`);
console.log(`Model: ${MODEL}\n`);

const req = http.request(options, (res) => {
  const chunks: Buffer[] = [];

  res.on("data", (chunk: Buffer) => chunks.push(chunk));

  res.on("end", () => {
    // Validate HTTP status
    if (res.statusCode !== 200) {
      fail(`Expected HTTP 200, got ${res.statusCode}\n${Buffer.concat(chunks).toString()}`);
    }
    console.log("HTTP 200 OK");

    // Validate JSON
    const raw = Buffer.concat(chunks).toString();
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      fail(`Response is not valid JSON:\n${raw.slice(0, 500)}`);
    }
    console.log("Valid JSON response");

    // Validate choices array
    if (!Array.isArray(body.choices) || body.choices.length === 0) {
      fail(`Expected non-empty choices array, got: ${JSON.stringify(body.choices)}`);
    }
    console.log(`Choices: ${body.choices.length}`);

    // Validate message content (reasoning models may use reasoning_content + content)
    const msg = body.choices[0]?.message;
    const content = msg?.content ?? "";
    const reasoning = msg?.reasoning_content ?? "";
    if (content.length === 0 && reasoning.length === 0) {
      fail(`Expected non-empty content or reasoning_content, got: ${JSON.stringify(msg)}`);
    }

    if (reasoning) console.log(`\nReasoning: "${reasoning.slice(0, 200)}..."`);
    if (content) console.log(`\nContent: "${content}"`);
    console.log(`\n--- PASS ---`);
  });
});

req.on("error", (err) => fail(`Request error: ${err.message}`));
req.write(payload);
req.end();
