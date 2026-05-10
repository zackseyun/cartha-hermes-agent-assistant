const base = process.env.HERMES_UI_URL || "http://127.0.0.1:5128";

function parseDeltas(raw) {
  let text = "";
  let toolEvents = 0;
  for (const block of raw.split("\n\n")) {
    if (block.includes("event: hermes.tool.progress")) toolEvents += 1;
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        text += JSON.parse(data)?.choices?.[0]?.delta?.content ?? "";
      } catch {
        // ignore custom/non-JSON progress frames for smoke validation
      }
    }
  }
  return { text, toolEvents };
}

async function streamText(backend, content) {
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backend, messages: [{ role: "user", content }] }),
  });
  if (!res.ok || !res.body) throw new Error(`${backend} chat failed: ${res.status} ${await res.text()}`);
  return parseDeltas(await res.text());
}

async function main() {
  const status = await fetch(`${base}/api/status`).then((res) => res.json());
  if (!status.ok) throw new Error(`status failed: ${JSON.stringify(status)}`);

  const deepseek = await streamText("openrouter", "Reply exactly: deepseek ui ok");
  if (!deepseek.text.toLowerCase().includes("deepseek ui ok")) {
    throw new Error(`deepseek smoke failed: ${deepseek.text}`);
  }

  const agent = await streamText("hermes", "Use a terminal or file tool to print only the current working directory.");
  if (!agent.text.includes("/Users/zackseyun/My Drive/Moltbot-Shared/Documents/GitHub")) {
    throw new Error(`agent smoke failed: ${agent.text}`);
  }

  console.log("smoke ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
