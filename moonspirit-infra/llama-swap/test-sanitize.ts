import http from "node:http";

const PROXY_URL = process.env.PROXY_URL ?? "http://127.0.0.1:3000";
const API_KEY = process.env.API_KEY ?? "test-key-1";
const MODEL = "gpt-oss-120b";

// --- Unit test: mirror the sanitization logic from proxy.ts ---

type Message = Record<string, unknown>;

const sanitizeMessages = (messages: Message[]): Message[] => {
  for (const msg of messages) {
    if (msg.role !== "assistant" || !msg.tool_calls) continue;

    const hasThinking = msg.thinking != null;
    const hasReasoning = msg.reasoning_content != null;
    if (!hasThinking && !hasReasoning) continue;

    const content = typeof msg.content === "string" ? (msg.content as string) : "";
    if (!content) continue; // no conflict when content is empty

    delete msg.thinking;
    delete msg.reasoning_content;
  }
  return messages;
};

const tool_calls = [
  { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"NYC"}' } },
];

let failures = 0;

const check = (label: string, ok: boolean, detail?: string) => {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}`);
  if (!ok) {
    failures++;
    if (detail) console.log(`    ${detail}`);
  }
};

const unitTests = () => {
  console.log("=== Unit tests: sanitizeMessages ===\n");

  // 1: thinking + content + tool_calls -> drop thinking, keep content
  {
    const msgs: Message[] = [
      { role: "assistant", thinking: "Analysis.", content: "Action.", tool_calls },
    ];
    sanitizeMessages(msgs);
    check(
      "thinking + content + tool_calls -> drops thinking",
      msgs[0].content === "Action." &&
        msgs[0].thinking === undefined,
      `content=${JSON.stringify(msgs[0].content)} thinking=${JSON.stringify(msgs[0].thinking)}`,
    );
  }

  // 2: reasoning_content + content + tool_calls -> drop reasoning_content, keep content
  {
    const msgs: Message[] = [
      { role: "assistant", reasoning_content: "Analysis.", content: "Action.", tool_calls },
    ];
    sanitizeMessages(msgs);
    check(
      "reasoning_content + content + tool_calls -> drops reasoning_content",
      msgs[0].content === "Action." &&
        msgs[0].reasoning_content === undefined,
      `content=${JSON.stringify(msgs[0].content)} reasoning_content=${JSON.stringify(msgs[0].reasoning_content)}`,
    );
  }

  // 3: reasoning_content + empty content + tool_calls -> no conflict, leave as-is
  {
    const msgs: Message[] = [
      { role: "assistant", reasoning_content: "Analysis.", content: "", tool_calls },
    ];
    sanitizeMessages(msgs);
    check(
      "reasoning_content + empty content + tool_calls -> left as-is (no conflict)",
      msgs[0].content === "" &&
        msgs[0].reasoning_content === "Analysis.",
      `content=${JSON.stringify(msgs[0].content)} reasoning_content=${JSON.stringify(msgs[0].reasoning_content)}`,
    );
  }

  // 4: only reasoning_content + tool_calls (no content key at all) -> no conflict, leave as-is
  {
    const msgs: Message[] = [
      { role: "assistant", reasoning_content: "Analysis.", tool_calls },
    ];
    sanitizeMessages(msgs);
    check(
      "reasoning_content + tool_calls (no content key) -> left as-is",
      msgs[0].reasoning_content === "Analysis." &&
        msgs[0].content === undefined,
    );
  }

  // 5: only content + tool_calls (no reasoning) -> no change
  {
    const msgs: Message[] = [
      { role: "assistant", content: "Calling tool.", tool_calls },
    ];
    sanitizeMessages(msgs);
    check(
      "content + tool_calls, no reasoning -> unchanged",
      msgs[0].content === "Calling tool." &&
        msgs[0].thinking === undefined &&
        msgs[0].reasoning_content === undefined,
    );
  }

  // 6: thinking + content but NO tool_calls -> no change
  {
    const msgs: Message[] = [
      { role: "assistant", thinking: "Reasoning.", content: "Answer." },
    ];
    sanitizeMessages(msgs);
    check(
      "thinking + content, no tool_calls -> unchanged",
      msgs[0].thinking === "Reasoning." && msgs[0].content === "Answer.",
    );
  }

  // 7: user messages never touched
  {
    const msgs: Message[] = [
      { role: "user", content: "Hello", reasoning_content: "hmm" },
    ];
    sanitizeMessages(msgs);
    check("user messages -> unchanged", msgs[0].reasoning_content === "hmm");
  }

  console.log("");
};

// --- Integration tests: send problematic payloads through the live proxy ---

const sendRequest = (
  label: string,
  messages: Message[],
): Promise<void> =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      max_tokens: 200,
    });

    const url = new URL("/v1/chat/completions", PROXY_URL);

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          const status = res.statusCode ?? 0;

          if (status !== 200) {
            if (raw.includes("Cannot pass both content and thinking")) {
              console.error(`  [FAIL] ${label}: Jinja raise_exception (HTTP ${status})`);
            } else {
              console.error(`  [FAIL] ${label}: HTTP ${status}`);
              console.error(`    ${raw.slice(0, 300)}`);
            }
            failures++;
            resolve();
            return;
          }

          let body: any;
          try {
            body = JSON.parse(raw);
          } catch {
            console.error(`  [FAIL] ${label}: invalid JSON response`);
            failures++;
            resolve();
            return;
          }

          const msg = body.choices?.[0]?.message;
          const content = msg?.content ?? "";
          console.log(`  [PASS] ${label} -> "${content.slice(0, 80)}${content.length > 80 ? "..." : ""}"`);
          resolve();
        });
      },
    );

    req.on("error", (err) => {
      console.error(`  [FAIL] ${label}: ${err.message}`);
      failures++;
      resolve();
    });

    req.write(payload);
    req.end();
  });

const integrationTests = async () => {
  console.log("=== Integration tests: proxy + llama.cpp ===\n");

  // Test A: thinking + content + tool_calls (original bug)
  await sendRequest("thinking + content + tool_calls", [
    { role: "user", content: "What is the weather in New York?" },
    {
      role: "assistant",
      thinking: "I should use the weather tool.",
      content: "Let me check.",
      tool_calls: [
        {
          id: "call_abc",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"New York"}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "call_abc", content: '{"temp":"72F","condition":"sunny"}' },
    { role: "user", content: "Summarize in one sentence." },
  ]);

  // Test B: reasoning_content + empty content + tool_calls (the actual OpenCode pattern)
  await sendRequest("reasoning_content + empty content + tool_calls", [
    { role: "user", content: "What is the weather in New York?" },
    {
      role: "assistant",
      reasoning_content: "The user wants weather data. I'll call get_weather.",
      content: "",
      tool_calls: [
        {
          id: "call_xyz",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"New York"}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "call_xyz", content: '{"temp":"72F","condition":"sunny"}' },
    { role: "user", content: "Summarize in one sentence." },
  ]);

  // Test C: reasoning_content + non-empty content + tool_calls
  await sendRequest("reasoning_content + content + tool_calls", [
    { role: "user", content: "What is the weather in New York?" },
    {
      role: "assistant",
      reasoning_content: "Let me think about this.",
      content: "I'll look that up.",
      tool_calls: [
        {
          id: "call_def",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"New York"}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "call_def", content: '{"temp":"72F","condition":"sunny"}' },
    { role: "user", content: "Summarize in one sentence." },
  ]);

  // Test D: clean message (no reasoning fields) -> should still work
  await sendRequest("clean messages (no reasoning)", [
    { role: "user", content: "Say hello in exactly 5 words." },
  ]);

  console.log("");
};

// --- Run ---

unitTests();

integrationTests().then(() => {
  if (failures > 0) {
    console.log(`${failures} test(s) FAILED`);
    process.exit(1);
  }
  console.log("--- ALL PASSED ---");
});
