const messagesEl = document.querySelector("#messages");
const composer = document.querySelector("#composer");
const promptEl = document.querySelector("#prompt");
const systemPromptEl = document.querySelector("#system-prompt");
const statusDot = document.querySelector("#status-dot");
const statusText = document.querySelector("#status-text");
const statusDetail = document.querySelector("#status-detail");
const streamStatus = document.querySelector("#stream-status");
const sendButton = document.querySelector("#send");
const stopButton = document.querySelector("#stop");
const clearButton = document.querySelector("#clear-chat");
const refreshButton = document.querySelector("#refresh-status");

let conversation = [];
let activeController = null;

function setStatus(kind, text, detail = "") {
  statusDot.className = `dot dot-${kind}`;
  statusText.textContent = text;
  statusDetail.textContent = detail;
}

function addMessage(role, content) {
  const node = document.createElement("div");
  node.className = `message ${role}`;
  node.textContent = content;
  messagesEl.appendChild(node);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return node;
}

function addToolChip(content) {
  const node = document.createElement("div");
  node.className = "tool-chip";
  node.textContent = content;
  messagesEl.appendChild(node);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setBusy(busy) {
  sendButton.disabled = busy;
  stopButton.disabled = !busy;
  promptEl.disabled = busy;
  streamStatus.textContent = busy ? "Hermes is thinking…" : "Ready";
}

async function refreshStatus() {
  setStatus("warn", "Checking Hermes…", "Calling local API server");
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    if (!data.ok) throw new Error(data.detail || data.error || "status failed");
    setStatus("ok", "Hermes online", `${data.model} · ${data.latencyMs}ms · ${data.hermesApiBase}`);
  } catch (err) {
    setStatus("danger", "Hermes offline", err.message || String(err));
  }
}

function buildMessages(userText) {
  const system = systemPromptEl.value.trim();
  const base = system ? [{ role: "system", content: system }] : [];
  return [...base, ...conversation, { role: "user", content: userText }];
}

function parseSseChunk(buffer, onEvent) {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    let event = "message";
    const data = [];
    for (const line of part.split(/\n/u)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length) onEvent(event, data.join("\n"));
  }
  return rest;
}

function deltaFromChatChunk(payload) {
  try {
    const json = JSON.parse(payload);
    return json?.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
}

function toolProgressText(payload) {
  try {
    const json = JSON.parse(payload);
    const label = json?.name || json?.tool || json?.type || "tool";
    const status = json?.status || json?.message || "running";
    return `Tool: ${label} · ${status}`;
  } catch {
    return `Tool: ${payload.slice(0, 160)}`;
  }
}

async function sendPrompt(text) {
  if (activeController) return;
  const trimmed = text.trim();
  if (!trimmed) return;

  addMessage("user", trimmed);
  const assistantNode = addMessage("assistant", "");
  const messages = buildMessages(trimmed);
  activeController = new AbortController();
  setBusy(true);

  let assistantText = "";
  let buffer = "";
  const decoder = new TextDecoder();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: activeController.signal,
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseChunk(buffer, (event, data) => {
        if (data === "[DONE]") return;
        if (event === "hermes.tool.progress") {
          addToolChip(toolProgressText(data));
          return;
        }
        const delta = deltaFromChatChunk(data);
        if (delta) {
          assistantText += delta;
          assistantNode.textContent = assistantText;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      });
    }
    if (!assistantText.trim()) assistantNode.textContent = "(No text returned.)";
    conversation.push({ role: "user", content: trimmed }, { role: "assistant", content: assistantText });
  } catch (err) {
    if (err.name === "AbortError") {
      assistantNode.textContent = assistantText || "Stopped.";
    } else {
      assistantNode.textContent = `Error: ${err.message || err}`;
    }
  } finally {
    activeController = null;
    setBusy(false);
    promptEl.value = "";
    promptEl.focus();
  }
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendPrompt(promptEl.value);
});

promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void sendPrompt(promptEl.value);
  }
});

stopButton.addEventListener("click", () => activeController?.abort());
clearButton.addEventListener("click", () => {
  conversation = [];
  messagesEl.innerHTML = "";
  addMessage("system", "New local Hermes session. Use Cmd+Enter to send.");
});
refreshButton.addEventListener("click", () => void refreshStatus());

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    promptEl.value = button.dataset.prompt || "";
    promptEl.focus();
  });
});

addMessage("system", "New local Hermes session. Use Cmd+Enter to send. The browser never sees your Hermes API key.");
void refreshStatus();
