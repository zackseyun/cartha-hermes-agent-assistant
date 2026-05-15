#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const HOME = process.env.HOME || "/Users/zackseyun";
const MOBILE_REPO = process.env.CARTHA_MOBILE_REPO || "/Users/zackseyun/My Drive/Moltbot-Shared/Documents/GitHub/cartha.ai.mobile";
const STATE_PATH = process.env.CARTHA_TESTFLIGHT_WATCHER_STATE || path.join(HOME, ".hermes", "cartha-testflight-watcher-state.json");
const AUTO_STATE_PATH = process.env.CARTHA_TESTFLIGHT_AUTO_STATE || path.join(HOME, ".hermes", "cartha-testflight-autodeploy-state.json");
const PROPOSALS_PATH = process.env.CARTHA_TESTFLIGHT_PROPOSALS_PATH || path.join(HOME, ".hermes", "cartha-testflight-proposals.json");
const UI_URL = process.env.CARTHA_HERMES_UI_URL || "http://127.0.0.1:5128/?testflight=1";
const USE_HERMES = process.env.CARTHA_TESTFLIGHT_USE_HERMES !== "0";
const AUTO_DEPLOY = process.env.CARTHA_TESTFLIGHT_AUTO_DEPLOY !== "0";
const BUBBLE_ENABLED = process.env.CARTHA_TESTFLIGHT_BUBBLE !== "0";
const BUBBLE_BIN = process.env.CARTHA_AGENT_BUBBLE || path.join(HOME, ".hermes", "scripts", "hermes-bubble", "hermes-bubble");
const IOS_DEPLOY_SH = process.env.CARTHA_IOS_TESTFLIGHT_SH || path.join(HOME, ".hermes", "scripts", "cartha-ios-testflight.sh");
const REPLIES_PATH = process.env.CARTHA_AGENT_REPLIES_PATH || path.join(HOME, ".hermes", "heartbeat-replies.jsonl");
const MAX_AGENT_MS = Number.parseInt(process.env.CARTHA_TESTFLIGHT_AGENT_TIMEOUT_MS || "90000", 10);
const MAX_DAILY_UPLOADS = Number.parseInt(process.env.CARTHA_TESTFLIGHT_MAX_DAILY_UPLOADS || "6", 10);
const AFK_SECONDS = Number.parseInt(process.env.CARTHA_TESTFLIGHT_AFK_SECONDS || "600", 10);
const QUIET_MIN_SECONDS = Number.parseInt(process.env.CARTHA_TESTFLIGHT_QUIET_MIN_SECONDS || "600", 10);
const QUIET_MAX_SECONDS = Number.parseInt(process.env.CARTHA_TESTFLIGHT_QUIET_MAX_SECONDS || "1200", 10);
const RETRY_SECONDS = Number.parseInt(process.env.CARTHA_TESTFLIGHT_RETRY_SECONDS || "300", 10);
const MAX_WAIT_SECONDS = Number.parseInt(process.env.CARTHA_TESTFLIGHT_MAX_WAIT_SECONDS || String(4 * 60 * 60), 10);
const NO_SCHEDULE = process.env.CARTHA_TESTFLIGHT_NO_SCHEDULE === "1";
const DRY_RUN = process.env.CARTHA_TESTFLIGHT_DRY_RUN === "1";

const PRIME = process.argv.includes("--prime");
const COMMIT_ARG_INDEX = process.argv.indexOf("--commit");
const COMMIT_SHA = COMMIT_ARG_INDEX >= 0 ? process.argv[COMMIT_ARG_INDEX + 1] : "";
const SETTLE_ARG_INDEX = process.argv.indexOf("--settle-check");
const SETTLE_SHA = SETTLE_ARG_INDEX >= 0 ? process.argv[SETTLE_ARG_INDEX + 1] : "";
const FORCE_PENDING = process.argv.includes("--pending") && !AUTO_DEPLOY;
const FORCE_MANUAL = process.argv.includes("--manual") || process.argv.includes("--ask");
const RENOTIFY = process.argv.includes("--renotify");
const DELAY_ARG_INDEX = process.argv.indexOf("--delay");
const DELAY_SECONDS = DELAY_ARG_INDEX >= 0 ? Number.parseInt(process.argv[DELAY_ARG_INDEX + 1] || "0", 10) : 0;
const ATTEMPT_ARG_INDEX = process.argv.indexOf("--attempt");
const ATTEMPT = ATTEMPT_ARG_INDEX >= 0 ? Number.parseInt(process.argv[ATTEMPT_ARG_INDEX + 1] || "1", 10) : 1;
const STARTED_ARG_INDEX = process.argv.indexOf("--started-at");
const STARTED_AT = STARTED_ARG_INDEX >= 0 ? process.argv[STARTED_ARG_INDEX + 1] : new Date().toISOString();
const CHANNEL_ARG_INDEX = process.argv.indexOf("--channel");
const CHANNEL_ARG = CHANNEL_ARG_INDEX >= 0 ? process.argv[CHANNEL_ARG_INDEX + 1] : (process.env.CARTHA_TESTFLIGHT_CHANNEL || "ios_testflight");

const CHANNELS = {
  ios_testflight: {
    idPrefix: "ios-tf",
    label: "iOS TestFlight",
    workflow: "deploy-ios.yml",
    recommendationPrompt: "iOS TestFlight upload",
  },
  macos_appstore: {
    idPrefix: "mac-mas",
    label: "Mac App Store",
    workflow: "deploy-macos.yml",
    recommendationPrompt: "Mac App Store Connect upload",
  },
};
const SELECTED_CHANNELS = CHANNEL_ARG === "all" ? Object.keys(CHANNELS) : [CHANNEL_ARG].filter((key) => CHANNELS[key]);

async function ensureParent(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await ensureParent(filePath);
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmp, filePath);
}

async function git(args, options = {}) {
  const { stdout } = await run("git", ["-C", MOBILE_REPO, ...args], {
    timeout: options.timeout ?? 30_000,
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
  });
  return stdout.trim();
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] || fallback) : fallback;
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1b\[[0-9;]*m/gu, "");
}

function extractJsonObject(text) {
  const raw = stripAnsi(text).trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch {}
  }
  return null;
}

function localDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function randomQuietDelaySeconds() {
  const min = Math.max(0, Math.min(QUIET_MIN_SECONDS, QUIET_MAX_SECONDS));
  const max = Math.max(min, QUIET_MAX_SECONDS);
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function idleSeconds() {
  if (process.env.CARTHA_TESTFLIGHT_ASSUME_AFK === "1") return AFK_SECONDS;
  try {
    const { stdout } = await run("ioreg", ["-c", "IOHIDSystem"], { timeout: 5_000, maxBuffer: 1024 * 1024 });
    const match = stdout.match(/"HIDIdleTime"\s*=\s*(\d+)/u);
    if (match) return Math.floor(Number.parseInt(match[1], 10) / 1_000_000_000);
  } catch {}
  return 0;
}

function todayDeploys(autoState) {
  const today = localDayKey();
  return (Array.isArray(autoState.deploys) ? autoState.deploys : [])
    .filter((entry) => localDayKey(new Date(entry.at || 0)) === today);
}

async function dailyCapStatus() {
  const autoState = await readJson(AUTO_STATE_PATH, { deploys: [] });
  const deploys = todayDeploys(autoState);
  return { autoState, deploys, count: deploys.length, remaining: Math.max(0, MAX_DAILY_UPLOADS - deploys.length) };
}

async function recordAutoDeploy(sha, detail = "") {
  if (DRY_RUN) return;
  const autoState = await readJson(AUTO_STATE_PATH, { deploys: [] });
  const deploys = Array.isArray(autoState.deploys) ? autoState.deploys : [];
  if (!deploys.some((entry) => entry.sha === sha)) {
    deploys.push({ sha, short_sha: sha.slice(0, 8), at: new Date().toISOString(), source: "cartha-agent-auto", detail: detail.slice(0, 500) });
  }
  autoState.deploys = deploys.slice(-200);
  autoState.updated_at = new Date().toISOString();
  await writeJson(AUTO_STATE_PATH, autoState);
}

function heuristicDecision({ subject, files }, channel = CHANNELS.ios_testflight) {
  const lowerSubject = subject.toLowerCase();
  const relevantFiles = files.filter((file) => {
    const common =
      file.startsWith("cartha_ai_mobile/lib/") ||
      file.startsWith("cartha_ai_mobile/assets/") ||
      file.startsWith("packages/") ||
      file.startsWith("features/") ||
      file === "cartha_ai_mobile/pubspec.yaml" ||
      file === "cartha_ai_mobile/pubspec.lock";
    if (channel === CHANNELS.macos_appstore) {
      return common || file.startsWith("cartha_ai_mobile/macos/") || file === ".github/workflows/deploy-macos.yml";
    }
    return common || file.startsWith("cartha_ai_mobile/ios/") || file === ".github/workflows/deploy-ios.yml";
  });
  const docsOnly = files.length > 0 && files.every((file) =>
    file.endsWith(".md") ||
    file.includes("/docs/") ||
    file.startsWith("docs/") ||
    file.includes("README") ||
    file.includes("DESIGN")
  );
  const explicitYes = channel === CHANNELS.macos_appstore ? /\[(macos-appstore|macos-store|mas)\]/iu.test(subject) : /\[(testflight|tf)\]/iu.test(subject);
  const explicitNo = channel === CHANNELS.macos_appstore ? /\[(skip[ -]?macos|no[ -]?mas|skip mas)\]/iu.test(subject) : /\[(skip[ -]?testflight|no[ -]?tf|skip tf)\]/iu.test(subject);
  const releaseKeywords = /(release|hotfix|urgent|review|ship|testflight|tf|app store|store)/iu.test(lowerSubject);
  const userFacingKeywords = /(fix|feat|polish|refine|auth|login|onboarding|call|video|camera|push|notification|purchase|profile|message|bible|clip|crash|blank|blocked|room|huddl|drop-in|connect)/iu.test(lowerSubject);

  if (explicitNo) return { recommendation: "no", confidence: 0.98, reason: `Commit explicitly opts out of ${channel.label}.` };
  if (explicitYes) return { recommendation: "yes", confidence: 0.98, reason: `Commit explicitly requests ${channel.label}.` };
  if (docsOnly || relevantFiles.length === 0) return { recommendation: "no", confidence: 0.86, reason: `No user-facing ${channel.label} runtime files changed.` };
  if (releaseKeywords) return { recommendation: "yes", confidence: 0.78, reason: `Release-oriented ${channel.label} change.` };
  if (userFacingKeywords) return { recommendation: "hold", confidence: 0.66, reason: "User-facing change; batch unless validation is needed now." };
  return { recommendation: "hold", confidence: 0.7, reason: `Mobile files changed; use quiet-window deploy policy.` };
}

async function hermesDecision(input, channel = CHANNELS.ios_testflight) {
  if (!USE_HERMES) return null;
  const prompt = `You are the Cartha Agent, acting as Cartha's Apple release steward. Decide whether this exact commit should spend one scarce ${channel.recommendationPrompt} slot. Return ONLY strict JSON with keys: recommendation (yes|hold|no), confidence (0..1), reason (one concise sentence). Prefer hold/no unless the commit is release-critical, user-facing enough to require physical-device or App Store validation, or explicitly asks for this upload lane. This decision is advisory; automation separately enforces a quiet window, AFK gating, and a 6/day cap.\n\nUpload lane: ${channel.label}\nWorkflow: ${channel.workflow}\nCommit: ${input.sha}\nSubject: ${input.subject}\nAuthor: ${input.author}\nFiles:\n${input.files.map((f) => `- ${f}`).join("\n")}\n\nDiff/stat/context:\n${input.body.slice(0, 8000)}`;
  try {
    const { stdout } = await run("hermes", ["--oneshot", prompt, "--provider", process.env.CARTHA_TESTFLIGHT_HERMES_PROVIDER || "openrouter", "--model", process.env.CARTHA_TESTFLIGHT_HERMES_MODEL || "deepseek/deepseek-v4-flash"], {
      cwd: MOBILE_REPO,
      timeout: MAX_AGENT_MS,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, HERMES_ACCEPT_HOOKS: "1" },
    });
    const parsed = extractJsonObject(stdout);
    if (!parsed || !["yes", "hold", "no"].includes(parsed.recommendation)) return null;
    return {
      recommendation: parsed.recommendation,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      reason: String(parsed.reason || "Cartha Agent returned a recommendation.").slice(0, 280),
      source: "hermes",
    };
  } catch {
    return null;
  }
}

function tinyBubble(title, message, severity = "info") {
  if (!BUBBLE_ENABLED) return;
  try {
    const child = spawn(BUBBLE_BIN, [
      "--title", title.slice(0, 80),
      "--message", message.slice(0, 160),
      "--severity", severity,
      "--duration", severity === "warning" ? "7" : "5",
      "--replace-key", "cartha-testflight-auto",
    ], { detached: true, stdio: "ignore" });
    child.unref();
  } catch {}
}

function notifyBubble(proposal) {
  if (!BUBBLE_ENABLED) return;
  const channel = proposal.channel || "ios_testflight";
  const isIos = channel === "ios_testflight";
  const title = isIos ? "TestFlight?" : `${proposal.channel_label || "Apple upload"}?`;
  const rec = String(proposal.recommendation || "hold").toUpperCase();
  const actions = isIos ? ["Deploy iOS", "Skip"] : ["Deploy Mac", "Skip"];
  const message = `${proposal.short_sha} · ${rec} · auto in 10–20m if quiet + AFK`;
  try {
    const child = spawn(BUBBLE_BIN, [
      "--title", title,
      "--message", message.slice(0, 160),
      "--severity", "info",
      "--duration", "12",
      "--allow-reply",
      "--non-blocking-reply",
      "--actions-only",
      "--no-auto-focus",
      "--reply-id", proposal.id,
      "--reply-out", REPLIES_PATH,
      "--actions", actions.join("\x1f"),
      "--replace-key", "cartha-testflight-proposal",
    ], { detached: true, stdio: "ignore" });
    child.unref();
  } catch {}
}

async function notifyManual(proposal) {
  notifyBubble(proposal);
  const notifier = process.env.CARTHA_TESTFLIGHT_NOTIFIER || "terminal-notifier";
  const title = proposal.recommendation === "yes" ? `Cartha Agent recommends ${proposal.channel_label}` : `Cartha Agent wants your ${proposal.channel_label} call`;
  const subtitle = `${proposal.short_sha} · ${proposal.subject.slice(0, 60)}`;
  const message = `${proposal.reason} Tap to approve or skip.`;
  try {
    await run(notifier, [
      "-title", title,
      "-subtitle", subtitle,
      "-message", message,
      "-group", `cartha-testflight-${proposal.short_sha}`,
      "-open", UI_URL,
      "-sound", proposal.recommendation === "yes" ? "default" : "Pop",
    ], { timeout: 5_000 });
  } catch {}
}

async function getCommitInput(sha) {
  const subject = await git(["show", "-s", "--format=%s", sha]);
  const author = await git(["show", "-s", "--format=%an <%ae>", sha]);
  const committedAt = await git(["show", "-s", "--format=%cI", sha]);
  const files = (await git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha])).split(/\r?\n/u).filter(Boolean);
  const body = await git(["show", "--stat", "--find-renames", "--format=fuller", "--no-ext-diff", "--no-color", sha], { maxBuffer: 8 * 1024 * 1024 });
  return { sha, subject, author, committedAt, files, body };
}

async function writeProposal(proposal) {
  const proposals = await readJson(PROPOSALS_PATH, []);
  const next = [proposal, ...proposals.filter((item) => !(item.sha === proposal.sha && (item.channel || "ios_testflight") === (proposal.channel || "ios_testflight")))].slice(0, 80);
  await writeJson(PROPOSALS_PATH, next);
}

async function patchProposal(sha, channelKey, patch) {
  const proposals = await readJson(PROPOSALS_PATH, []);
  const index = proposals.findIndex((item) => item.sha === sha && (item.channel || "ios_testflight") === channelKey);
  if (index < 0) return null;
  proposals[index] = { ...proposals[index], ...patch, updated_at: new Date().toISOString() };
  await writeJson(PROPOSALS_PATH, proposals);
  return proposals[index];
}

function scheduleSettleCheck(sha, channelKey, delaySeconds, attempt = 1, startedAt = new Date().toISOString()) {
  if (NO_SCHEDULE || DRY_RUN) return;
  const script = process.argv[1];
  const child = spawn(process.execPath, [
    script,
    "--settle-check", sha,
    "--channel", channelKey,
    "--delay", String(Math.max(0, delaySeconds)),
    "--attempt", String(attempt),
    "--started-at", startedAt,
  ], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

async function createProposalForSha(sha, channelKey = "ios_testflight", { updateState = false } = {}) {
  const channel = CHANNELS[channelKey] || CHANNELS.ios_testflight;
  const input = await getCommitInput(sha);
  const fallback = heuristicDecision(input, channel);
  const agent = await hermesDecision(input, channel);
  const decision = agent || { ...fallback, source: "heuristic" };

  const proposals = await readJson(PROPOSALS_PATH, []);
  const existing = proposals.find((item) => item.sha === sha && (item.channel || "ios_testflight") === channelKey);
  const now = new Date().toISOString();
  const proposal = existing || {
    id: `${channel.idPrefix}-${sha.slice(0, 12)}`,
    sha,
    short_sha: sha.slice(0, 8),
    channel: channelKey,
    channel_label: channel.label,
    workflow: channel.workflow,
    subject: input.subject,
    author: input.author,
    committed_at: input.committedAt,
    changed_files: input.files,
    created_at: now,
  };
  const terminalStatus = existing && ["skipped", "deploy_requested", "auto_superseded"].includes(existing.status);
  const quietDelaySeconds = Number.parseInt(argValue("--quiet-delay", "0"), 10) || randomQuietDelaySeconds();
  let proposedStatus = "pending";
  let autoDeployAfter = proposal.auto_deploy_after;
  let autoPolicy = proposal.auto_policy;

  const explicitSkip = decision.recommendation === "no" && /explicitly opts out/iu.test(decision.reason || "");
  if (channelKey === "ios_testflight" && AUTO_DEPLOY && !FORCE_MANUAL && !FORCE_PENDING) {
    proposedStatus = explicitSkip ? "auto_skipped" : "auto_waiting";
    autoDeployAfter = new Date(Date.now() + quietDelaySeconds * 1000).toISOString();
    autoPolicy = {
      quiet_window_seconds: quietDelaySeconds,
      afk_seconds: AFK_SECONDS,
      max_daily_uploads: MAX_DAILY_UPLOADS,
      mode: "quiet-afk-auto-deploy",
    };
  } else if (FORCE_PENDING || FORCE_MANUAL) {
    proposedStatus = "pending";
  } else {
    proposedStatus = decision.recommendation === "no" ? "auto_skipped" : "pending";
  }

  Object.assign(proposal, {
    recommendation: decision.recommendation,
    confidence: decision.confidence,
    reason: decision.reason,
    source: decision.source,
    status: terminalStatus ? existing.status : proposedStatus,
    auto_deploy_after: autoDeployAfter,
    auto_policy: autoPolicy,
    updated_at: now,
  });

  await writeProposal(proposal);

  if (updateState || channelKey === "ios_testflight") {
    const state = await readJson(STATE_PATH, {});
    if (channelKey === "ios_testflight") {
      state.latestIosCandidateSha = sha;
      state.latestIosCandidateAt = now;
    }
    state.lastSeenSha = sha;
    state.lastProposalAt = now;
    await writeJson(STATE_PATH, state);
  }

  if (proposal.status === "auto_waiting") {
    if (!existing || RENOTIFY) notifyBubble(proposal);
    scheduleSettleCheck(sha, channelKey, quietDelaySeconds, 1, now);
    console.log(`Cartha Agent will auto-check iOS TestFlight ${proposal.short_sha} after ${Math.round(quietDelaySeconds / 60)}m quiet + ${Math.round(AFK_SECONDS / 60)}m AFK.`);
  } else if (proposal.status === "pending") {
    const shouldNotify = !existing || existing.status !== "pending" || RENOTIFY;
    if (shouldNotify) await notifyManual(proposal);
    console.log(`Cartha Agent ${channel.label} proposal pending for ${proposal.short_sha}.`);
  } else {
    console.log(`Cartha Agent kept ${channel.label} proposal ${proposal.status} for ${proposal.short_sha}: ${proposal.reason}`);
  }
}

async function autoDeploySettledCommit(sha, channelKey = "ios_testflight") {
  if (DELAY_SECONDS > 0) await sleep(DELAY_SECONDS * 1000);

  if (channelKey !== "ios_testflight") return;
  const state = await readJson(STATE_PATH, {});
  if (state.latestIosCandidateSha && state.latestIosCandidateSha !== sha) {
    await patchProposal(sha, channelKey, { status: "auto_superseded", auto_result: "newer commit arrived" });
    return;
  }

  const head = await git(["rev-parse", "HEAD"]);
  if (head !== sha) {
    await patchProposal(sha, channelKey, { status: "auto_superseded", auto_result: `HEAD moved to ${head.slice(0, 8)}` });
    return;
  }

  const cap = await dailyCapStatus();
  if (cap.count >= MAX_DAILY_UPLOADS) {
    await patchProposal(sha, channelKey, { status: "auto_cap_reached", auto_result: `${cap.count}/${MAX_DAILY_UPLOADS} uploads already queued today` });
    tinyBubble("TestFlight cap hit", `${cap.count}/${MAX_DAILY_UPLOADS} today`, "info");
    return;
  }

  const idle = await idleSeconds();
  if (idle < AFK_SECONDS) {
    const startedMs = Date.parse(STARTED_AT) || Date.now();
    const elapsed = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
    await patchProposal(sha, channelKey, { status: "auto_waiting", auto_result: `waiting for AFK (${idle}s/${AFK_SECONDS}s)`, auto_attempt: ATTEMPT });
    if (elapsed + RETRY_SECONDS <= MAX_WAIT_SECONDS) {
      scheduleSettleCheck(sha, channelKey, RETRY_SECONDS, ATTEMPT + 1, STARTED_AT);
      console.log(`Still active (${idle}s idle); rechecking ${sha.slice(0, 8)} in ${Math.round(RETRY_SECONDS / 60)}m.`);
    } else {
      await patchProposal(sha, channelKey, { status: "auto_waiting", auto_result: "quiet window passed, but AFK condition never held" });
    }
    return;
  }

  const reason = `Cartha Agent auto-deploy after quiet window; user AFK ${Math.round(idle / 60)}m; daily uploads ${cap.count}/${MAX_DAILY_UPLOADS}.`;
  const env = { ...process.env };
  if (DRY_RUN) env.CARTHA_IOS_DEPLOY_DRY_RUN = "1";
  try {
    const { stdout, stderr } = await run(IOS_DEPLOY_SH, ["deploy", sha, reason], {
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
      env,
    });
    const detail = `${stdout || ""}${stderr || ""}`.trim();
    await recordAutoDeploy(sha, detail);
    await patchProposal(sha, channelKey, {
      status: "deploy_requested",
      approved_at: new Date().toISOString(),
      deploy_requested_at: new Date().toISOString(),
      deploy_stdout: detail.slice(0, 1500),
      deploy_error: "",
      auto_result: reason,
    });
    tinyBubble("TestFlight queued", sha.slice(0, 8), "info");
    console.log(`Queued iOS TestFlight deploy for ${sha.slice(0, 8)} after quiet+AFK gate.`);
  } catch (err) {
    const detail = String(err?.stderr || err?.stdout || err?.message || err).slice(0, 1500);
    await patchProposal(sha, channelKey, { status: "approval_failed", deploy_error: detail, auto_result: reason });
    tinyBubble("TestFlight failed", sha.slice(0, 8), "warning");
    throw err;
  }
}

async function main() {
  if (SETTLE_SHA) {
    await autoDeploySettledCommit(SETTLE_SHA, CHANNEL_ARG || "ios_testflight");
    return;
  }

  if (COMMIT_SHA) {
    for (const channelKey of SELECTED_CHANNELS) {
      await createProposalForSha(COMMIT_SHA, channelKey, { updateState: false });
    }
    return;
  }

  await git(["fetch", "origin", "main", "--quiet"], { timeout: 45_000 }).catch(() => null);
  const latest = await git(["rev-parse", "origin/main"]);
  const state = await readJson(STATE_PATH, {});

  if (PRIME || !state.lastSeenSha) {
    state.lastSeenSha = latest;
    state.primedAt = new Date().toISOString();
    await writeJson(STATE_PATH, state);
    console.log(`Primed TestFlight proposal watcher at ${latest.slice(0, 8)}.`);
    return;
  }

  if (state.lastSeenSha === latest) return;

  let shas = [];
  try {
    shas = (await git(["log", "--reverse", "--format=%H", `${state.lastSeenSha}..origin/main`])).split(/\r?\n/u).filter(Boolean);
  } catch {
    shas = [latest];
  }
  if (shas.length === 0) return;

  for (const channelKey of SELECTED_CHANNELS) {
    await createProposalForSha(shas.at(-1), channelKey, { updateState: true });
  }
}

main().catch((err) => {
  console.error(`TestFlight proposal watcher failed: ${err?.message || err}`);
  process.exitCode = 1;
});
