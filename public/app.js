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
const refreshTestFlightButton = document.querySelector("#refresh-testflight");
const testFlightList = document.querySelector("#testflight-list");
const testFlightModal = document.querySelector("#testflight-modal");
const testFlightModalSubtitle = document.querySelector("#testflight-modal-subtitle");
const testFlightModalReason = document.querySelector("#testflight-modal-reason");
const testFlightModalFiles = document.querySelector("#testflight-modal-files");
const testFlightModalYes = document.querySelector("#testflight-modal-yes");
const testFlightModalNo = document.querySelector("#testflight-modal-no");
const testFlightModalLater = document.querySelector("#testflight-modal-later");
const attachmentsEl = document.querySelector("#attachments");
const attachmentPreview = document.querySelector("#attachment-preview");

let conversation = [];
let activeController = null;
let activeModalProposal = null;
const deferredModalIds = new Set();

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

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusLabel(status) {
  if (status === "pending") return "Needs decision";
  if (status === "deploy_requested") return "Deploy requested";
  if (status === "skipped") return "Skipped";
  if (status === "auto_skipped") return "Auto-skipped";
  if (status === "approval_failed") return "Approval failed";
  return status || "Unknown";
}

function recommendationClass(recommendation) {
  if (recommendation === "yes") return "rec-yes";
  if (recommendation === "hold") return "rec-hold";
  return "rec-no";
}

async function actOnTestFlightProposal(id, action) {
  const res = await fetch(`/api/testflight/proposals/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
  await refreshTestFlightProposals();
}

function renderTestFlightProposals(proposals) {
  testFlightList.innerHTML = "";
  const pending = proposals.filter((proposal) => proposal.status === "pending");
  const recent = proposals.filter((proposal) => proposal.status !== "pending").slice(0, 4);
  const visible = pending.concat(recent);

  if (!visible.length) {
    testFlightList.textContent = "No Apple upload proposals yet. Hermes will add one after the next mobile commit or main push.";
    return;
  }

  for (const proposal of visible) {
    const item = document.createElement("div");
    item.className = `testflight-item ${proposal.status === "pending" ? "is-pending" : ""}`;

    const top = document.createElement("div");
    top.className = "testflight-topline";
    const rec = document.createElement("span");
    rec.className = `recommendation ${recommendationClass(proposal.recommendation)}`;
    rec.textContent = proposal.recommendation || "hold";
    const meta = document.createElement("span");
    meta.className = "muted";
    meta.textContent = `${proposal.channel_label || "Apple upload"} · ${proposal.short_sha || ""} · ${statusLabel(proposal.status)}${proposal.source ? ` · ${proposal.source}` : ""}`;
    top.append(rec, meta);

    const title = document.createElement("div");
    title.className = "testflight-title";
    title.textContent = proposal.subject || "Untitled commit";

    const reason = document.createElement("div");
    reason.className = "testflight-reason";
    reason.textContent = proposal.reason || "No reason recorded.";

    const foot = document.createElement("div");
    foot.className = "testflight-foot muted";
    const changed = Array.isArray(proposal.changed_files) ? proposal.changed_files.length : 0;
    foot.textContent = `${formatDateTime(proposal.committed_at || proposal.created_at)} · ${changed} shown file${changed === 1 ? "" : "s"}`;

    item.append(top, title, reason, foot);

    if (proposal.status === "pending") {
      const actions = document.createElement("div");
      actions.className = "testflight-actions";
      const approve = document.createElement("button");
      approve.className = "approve";
      approve.type = "button";
      approve.textContent = "Yes, upload";
      approve.addEventListener("click", async () => {
        approve.disabled = true;
        try {
          await actOnTestFlightProposal(proposal.id, "approve");
        } catch (err) {
          addMessage("system", `Could not approve ${proposal.channel_label || "Apple upload"}: ${err.message || err}`);
          approve.disabled = false;
        }
      });
      const skip = document.createElement("button");
      skip.className = "ghost";
      skip.type = "button";
      skip.textContent = "No, skip";
      skip.addEventListener("click", async () => {
        skip.disabled = true;
        try {
          await actOnTestFlightProposal(proposal.id, "skip");
        } catch (err) {
          addMessage("system", `Could not skip ${proposal.channel_label || "Apple upload"}: ${err.message || err}`);
          skip.disabled = false;
        }
      });
      actions.append(approve, skip);
      item.append(actions);
    }

    testFlightList.appendChild(item);
  }

  const pendingForModal = pending.find((proposal) => !deferredModalIds.has(proposal.id));
  if (pendingForModal) {
    showTestFlightModal(pendingForModal);
  } else if (!pending.some((proposal) => proposal.id === activeModalProposal?.id)) {
    hideTestFlightModal();
  }
}

function showTestFlightModal(proposal) {
  if (!testFlightModal) return;
  activeModalProposal = proposal;
  testFlightModalSubtitle.textContent = `${proposal.channel_label || "Apple upload"} · ${proposal.short_sha || ""} · ${proposal.subject || "Untitled commit"} · Hermes says ${proposal.recommendation || "hold"}`;
  testFlightModalReason.textContent = proposal.reason || "Hermes left this for your decision.";
  const files = Array.isArray(proposal.changed_files) ? proposal.changed_files.slice(0, 6) : [];
  testFlightModalFiles.textContent = files.length ? `Changed: ${files.join(", ")}${proposal.changed_files.length > files.length ? "…" : ""}` : "";
  testFlightModal.classList.remove("hidden");
}

function hideTestFlightModal() {
  activeModalProposal = null;
  testFlightModal?.classList.add("hidden");
}

async function refreshTestFlightProposals() {
  if (!testFlightList) return;
  testFlightList.textContent = "Checking pending commits…";
  try {
    const res = await fetch("/api/testflight/proposals");
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.detail || data.error || "proposal refresh failed");
    renderTestFlightProposals(data.proposals || []);
  } catch (err) {
    testFlightList.textContent = `Could not load proposals: ${err.message || err}`;
  }
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
refreshTestFlightButton?.addEventListener("click", () => void refreshTestFlightProposals());
testFlightModalYes?.addEventListener("click", async () => {
  if (!activeModalProposal) return;
  testFlightModalYes.disabled = true;
  try {
    await actOnTestFlightProposal(activeModalProposal.id, "approve");
    hideTestFlightModal();
  } catch (err) {
    addMessage("system", `Could not approve ${activeModalProposal.channel_label || "Apple upload"}: ${err.message || err}`);
  } finally {
    testFlightModalYes.disabled = false;
  }
});
testFlightModalNo?.addEventListener("click", async () => {
  if (!activeModalProposal) return;
  testFlightModalNo.disabled = true;
  try {
    await actOnTestFlightProposal(activeModalProposal.id, "skip");
    hideTestFlightModal();
  } catch (err) {
    addMessage("system", `Could not skip ${activeModalProposal.channel_label || "Apple upload"}: ${err.message || err}`);
  } finally {
    testFlightModalNo.disabled = false;
  }
});
testFlightModalLater?.addEventListener("click", () => {
  if (activeModalProposal?.id) deferredModalIds.add(activeModalProposal.id);
  hideTestFlightModal();
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    promptEl.value = button.dataset.prompt || "";
    promptEl.focus();
  });
});

addMessage("system", "New Hermes agent session. Cmd+Enter sends immediately. Agent mode uses MiMo V2.5 Pro through Hermes tools; DeepSeek mode is for smaller text tasks; Gemma mode is for local vision/chat.");
void refreshStatus();
void refreshTestFlightProposals();
setInterval(refreshTestFlightProposals, 30_000);
updateAttachmentPreview();
