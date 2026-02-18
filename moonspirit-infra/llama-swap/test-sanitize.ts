import http from "node:http";

const PROXY_URL = process.env.PROXY_URL ?? "http://127.0.0.1:3000";
const API_KEY = process.env.API_KEY ?? "test-key-1";
const MODEL = "gpt-oss-120b";

// --- Unit test: verify sanitization logic in isolation ---

type Message = {
  role: string;
  content?: string;
  thinking?: string;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

const sanitizeMessages = (messages: Message[]): Message[] => {
  for (const msg of messages) {
    if (
      msg.role === "assistant" &&
      msg.tool_calls &&
      msg.thinking &&
      msg.content
    ) {
      msg.content = msg.thinking + "\n\n" + msg.content;
      delete msg.thinking;
    }
  }
  return messages;
};

const unitTests = () => {
  console.log("=== Unit tests: sanitizeMessages ===\n");

  // Test 1: assistant with thinking + content + tool_calls -> merge
  {
    const msgs: Message[] = [
      {
        role: "assistant",
        thinking: "Let me analyze this.",
        content: "I'll look up the weather.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"NYC"}' },
          },
        ],
      },
    ];
    sanitizeMessages(msgs);
    const ok =
      msgs[0].content === "Let me analyze this.\n\nI'll look up the weather." &&
      msgs[0].thinking === undefined &&
      msgs[0].tool_calls !== undefined;
    console.log(`  [${ok ? "PASS" : "FAIL"}] Merges thinking into content when tool_calls present`);
    if (!ok) {
      console.log(`    content: ${JSON.stringify(msgs[0].content)}`);
      console.log(`    thinking: ${JSON.stringify(msgs[0].thinking)}`);
    }
  }

  // Test 2: assistant with thinking + content but NO tool_calls -> no change
  {
    const msgs: Message[] = [
      {
        role: "assistant",
        thinking: "Reasoning here.",
        content: "Final answer.",
      },
    ];
    sanitizeMessages(msgs);
    const ok = msgs[0].thinking === "Reasoning here." && msgs[0].content === "Final answer.";
    console.log(`  [${ok ? "PASS" : "FAIL"}] Leaves non-tool-call messages unchanged`);
  }

  // Test 3: assistant with only content + tool_calls (no thinking) -> no change
  {
    const msgs: Message[] = [
      {
        role: "assistant",
        content: "Calling tool.",
        tool_calls: [
          {
            id: "call_2",
            type: "function",
            function: { name: "search", arguments: '{"q":"test"}' },
          },
        ],
      },
    ];
    sanitizeMessages(msgs);
    const ok = msgs[0].content === "Calling tool." && msgs[0].thinking === undefined;
    console.log(`  [${ok ? "PASS" : "FAIL"}] No change when thinking is absent`);
  }

  // Test 4: user messages are never touched
  {
    const msgs: Message[] = [
      { role: "user", content: "Hello", thinking: "hmm" } as any,
    ];
    sanitizeMessages(msgs);
    const ok = (msgs[0] as any).thinking === "hmm";
    console.log(`  [${ok ? "PASS" : "FAIL"}] User messages are not modified`);
  }

  console.log("");
};

// --- Integration test: send the problematic payload through the live proxy ---

const integrationTest = () => {
  console.log("=== Integration test: proxy + llama.cpp ===\n");

  // This payload mimics what OpenCode sends: an assistant message with
  // thinking + content + tool_calls, followed by a tool result, then
  // a user message continuing the conversation.
  const messages = [
    { role: "user", content: "What is the weather in New York?" },
    {
      role: "assistant",
      thinking: "The user wants weather info. I should use the get_weather tool.",
      content: "Let me check the weather for you.",
      tool_calls: [
        {
          id: "call_abc123",
          type: "function",
          function: {
            name: "get_weather",
            arguments: JSON.stringify({ city: "New York" }),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_abc123",
      content: JSON.stringify({ temp: "72F", condition: "sunny" }),
    },
    { role: "user", content: "Thanks! Summarize that in one sentence." },
  ];

  const payload = JSON.stringify({
    model: MODEL,
    messages,
    stream: false,
    max_tokens: 200,
  });

  const url = new URL("/v1/chat/completions", PROXY_URL);

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

  console.log(`Sending problematic payload to ${url.href}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Payload has assistant message with thinking + content + tool_calls\n`);

  const req = http.request(options, (res) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      const status = res.statusCode ?? 0;

      if (status !== 200) {
        // Check if this is the specific Jinja error
        if (raw.includes("Cannot pass both content and thinking")) {
          console.error(`FAIL: Got the Jinja raise_exception error (HTTP ${status})`);
          console.error(`  The proxy sanitization did NOT work.`);
          console.error(`  Response: ${raw.slice(0, 500)}`);
        } else {
          console.error(`FAIL: HTTP ${status}`);
          console.error(`  Response: ${raw.slice(0, 500)}`);
        }
        process.exit(1);
      }

      let body: any;
      try {
        body = JSON.parse(raw);
      } catch {
        console.error(`FAIL: Response is not valid JSON:\n${raw.slice(0, 500)}`);
        process.exit(1);
      }

      const msg = body.choices?.[0]?.message;
      const content = msg?.content ?? "";
      const reasoning = msg?.reasoning_content ?? "";

      if (content.length === 0 && reasoning.length === 0) {
        console.error(`FAIL: Empty response content: ${JSON.stringify(msg)}`);
        process.exit(1);
      }

      console.log("HTTP 200 OK");
      if (reasoning) console.log(`Reasoning: "${reasoning.slice(0, 150)}..."`);
      console.log(`Content: "${content.slice(0, 200)}"`);
      console.log(`\n--- PASS ---`);
    });
  });

  req.on("error", (err) => {
    console.error(`FAIL: Request error: ${err.message}`);
    process.exit(1);
  });

  req.write(payload);
  req.end();
};

// Run unit tests first, then integration
unitTests();
integrationTest();
