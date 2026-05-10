#!/usr/bin/env node
const base = process.env.HERMES_UI_URL || "http://127.0.0.1:5128";
const expectedCwd = process.env.EXPECTED_AGENT_CWD || "";

function parseDeltas(raw) {
  let text = "";
  let toolEvents = 0;
  for (const block of raw.split("\n\n")) {
    if (block.includes("event: hermes.tool.progress") || block.includes("event: tool")) toolEvents += 1;
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        text += parsed?.choices?.[0]?.delta?.content ?? parsed?.text ?? "";
      } catch {
        // ignore custom/non-JSON progress frames
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
  console.log(`status ok: agent=${status.agentModel} small=${status.smallModel} vision=${status.model}`);

  const creditRemaining = Number(status.creditRemainingUsd);
  if (Number.isFinite(creditRemaining) && creditRemaining <= 0) {
    console.warn(`agent/small smoke may fail: OpenRouter credits are exhausted (${creditRemaining.toFixed(2)} USD remaining)`);
  }

  const small = await streamText("openrouter", "Reply exactly: small route ok");
  if (!small.text.toLowerCase().includes("small route ok")) {
    throw new Error(`small-model smoke failed: ${small.text}`);
  }

  const agent = await streamText("hermes", "Use a terminal tool to print only the current working directory.");
  if (expectedCwd && !agent.text.includes(expectedCwd)) {
    throw new Error(`agent smoke failed: expected cwd ${expectedCwd}, got: ${agent.text}`);
  }
  if (!agent.text.trim()) throw new Error("agent smoke failed: empty response");

  console.log("smoke ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
