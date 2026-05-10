const base = process.env.HERMES_UI_URL || "http://127.0.0.1:5128";

function parseDeltas(raw) {
  let text = "";
  for (const block of raw.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        text += json?.choices?.[0]?.delta?.content ?? "";
      } catch {
        // ignore custom/non-JSON progress frames for smoke validation
      }
    }
  }
  return text;
}

async function main() {
  const status = await fetch(`${base}/api/status`).then((res) => res.json());
  if (!status.ok) throw new Error(`status failed: ${JSON.stringify(status)}`);

  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Reply exactly: gemma ui ok" }],
      backend: "ollama",
    }),
  });
  if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);

  const raw = await res.text();
  const text = parseDeltas(raw);
  if (!text.toLowerCase().includes("gemma ui ok")) {
    throw new Error(`expected streamed response to include smoke phrase; got ${text || raw.slice(0, 500)}`);
  }
  console.log("smoke ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
