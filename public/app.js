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
const attachmentsEl = document.querySelector("#attachments");
const attachmentPreview = document.querySelector("#attachment-preview");

let conversation = [];
let activeController = null;

function selectedBackend() {
  return document.querySelector('input[name="backend"]:checked')?.value || "hermes";
}

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
  attachmentsEl.disabled = busy;
  if (!busy) {
    streamStatus.textContent = "Ready";
  } else if (selectedBackend() === "hermes") {
    streamStatus.textContent = "Hermes agent is using tools…";
  } else if (selectedBackend() === "openrouter") {
    streamStatus.textContent = "DeepSeek is responding…";
  } else {
    streamStatus.textContent = "Gemma is responding…";
  }
}

function creditText(value) {
  if (!Number.isFinite(value)) return "";
  const sign = value < 0 ? "-" : "";
  return ` · OpenRouter credit ${sign}$${Math.abs(value).toFixed(2)}`;
}

async function refreshStatus() {
  setStatus("warn", "Checking local harness…", "Calling Hermes gateway + local vision runtime");
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    if (!data.ok) throw new Error(data.detail || data.error || "status failed");
    const credit = Number(data.creditRemainingUsd);
    if (Number.isFinite(credit) && credit <= 0) {
      setStatus(
        "warn",
        "MiMo configured, credits exhausted",
        `Agent ${data.agentModel} · Small ${data.smallModel} · Vision ${data.model}${creditText(credit)}`,
      );
      return;
    }
    setStatus(
      "ok",
      "Local harness online",
      `Agent ${data.agentModel} · Small ${data.smallModel} · Vision ${data.model} · ${data.latencyMs}ms${creditText(credit)}`,
    );
  } catch (err) {
    setStatus("danger", "Local model offline", err.message || String(err));
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

async function buildUserContent(text) {
  const files = Array.from(attachmentsEl.files || []);
  if (files.length === 0) return text;

  const parts = [{ type: "text", text: text || "Describe the attached image." }];
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const url = await fileToDataUrl(file);
    parts.push({ type: "image_url", image_url: { url } });
  }
  return parts;
}

function attachmentLabel() {
  const files = Array.from(attachmentsEl.files || []);
  if (!files.length) return "";
  return files.map((file) => file.name).join(", ");
}

function updateAttachmentPreview() {
  const files = Array.from(attachmentsEl.files || []);
  if (!files.length) {
    attachmentPreview.textContent = "Vision is enabled. Audio needs E4B or transcription.";
    return;
  }
  const totalMb = files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024;
  attachmentPreview.textContent = `${files.length} image(s): ${files.map((file) => file.name).join(", ")} · ${totalMb.toFixed(1)} MB`;
}

function buildMessages(userContent) {
  const system = systemPromptEl.value.trim();
  const base = system ? [{ role: "system", content: system }] : [];
  return [...base, ...conversation, { role: "user", content: userContent }];
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
    const label = json?.label || json?.name || json?.tool || json?.type || "tool";
    const status = json?.status || json?.message || "running";
    return `Tool: ${label} · ${status}`;
  } catch {
    return `Tool: ${payload.slice(0, 160)}`;
  }
}

async function sendPrompt(text) {
  if (activeController) return;
  const trimmed = text.trim();
  const hasAttachments = Boolean(attachmentsEl.files?.length);
  if (!trimmed && !hasAttachments) return;

  let userContent;
  try {
    userContent = await buildUserContent(trimmed);
  } catch (err) {
    addMessage("assistant", `Could not read attachment: ${err.message || err}`);
    return;
  }
  const attached = attachmentLabel();
  const displayText = attached ? `${trimmed || "Describe this image."}\n\nAttached: ${attached}` : trimmed;
  addMessage("user", displayText);
  const assistantNode = addMessage("assistant", "");
  const messages = buildMessages(userContent);

  // Clear immediately after a valid submit. Long agent runs should not leave
  // stale text sitting in the composer.
  promptEl.value = "";
  attachmentsEl.value = "";
  updateAttachmentPreview();

  activeController = new AbortController();
  setBusy(true);

  let assistantText = "";
  let buffer = "";
  const decoder = new TextDecoder();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, backend: selectedBackend() }),
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
    if (!assistantText.trim()) {
      assistantNode.textContent =
        selectedBackend() === "hermes"
          ? "(No text returned. If MiMo is selected, check OpenRouter credits; Hermes tool prompts are larger than plain chat.)"
          : "(No text returned.)";
    }
    const userMemory = attached ? `${trimmed || "Image question."} [attached image(s): ${attached}]` : trimmed;
    conversation.push({ role: "user", content: userMemory }, { role: "assistant", content: assistantText });
  } catch (err) {
    if (err.name === "AbortError") {
      assistantNode.textContent = assistantText || "Stopped.";
    } else {
      assistantNode.textContent = `Error: ${err.message || err}`;
    }
  } finally {
    activeController = null;
    setBusy(false);
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

attachmentsEl.addEventListener("change", updateAttachmentPreview);
stopButton.addEventListener("click", () => activeController?.abort());
clearButton.addEventListener("click", () => {
  conversation = [];
  messagesEl.innerHTML = "";
  addMessage("system", "New Hermes agent session. Cmd+Enter sends immediately; agent mode can use local tools.");
});
refreshButton.addEventListener("click", () => void refreshStatus());

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    promptEl.value = button.dataset.prompt || "";
    promptEl.focus();
  });
});

addMessage("system", "New Hermes agent session. Cmd+Enter sends immediately. Agent mode uses MiMo V2.5 Pro through Hermes tools; DeepSeek mode is for smaller text tasks; Gemma mode is for local vision/chat.");
void refreshStatus();
