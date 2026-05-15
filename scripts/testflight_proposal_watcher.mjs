#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const HOME = process.env.HOME || "/Users/zackseyun";
const MOBILE_REPO = process.env.CARTHA_MOBILE_REPO || "/Users/zackseyun/My Drive/Moltbot-Shared/Documents/GitHub/cartha.ai.mobile";
const STATE_PATH = process.env.CARTHA_TESTFLIGHT_WATCHER_STATE || path.join(HOME, ".hermes", "cartha-testflight-watcher-state.json");
const PROPOSALS_PATH = process.env.CARTHA_TESTFLIGHT_PROPOSALS_PATH || path.join(HOME, ".hermes", "cartha-testflight-proposals.json");
const UI_URL = process.env.CARTHA_HERMES_UI_URL || "http://127.0.0.1:5128/?testflight=1";
const USE_HERMES = process.env.CARTHA_TESTFLIGHT_USE_HERMES !== "0";
const MAX_AGENT_MS = Number.parseInt(process.env.CARTHA_TESTFLIGHT_AGENT_TIMEOUT_MS || "90000", 10);
const PRIME = process.argv.includes("--prime");
const COMMIT_ARG_INDEX = process.argv.indexOf("--commit");
const COMMIT_SHA = COMMIT_ARG_INDEX >= 0 ? process.argv[COMMIT_ARG_INDEX + 1] : "";
const FORCE_PENDING = process.argv.includes("--pending");
const RENOTIFY = process.argv.includes("--renotify");
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
const BUBBLE_ENABLED = process.env.CARTHA_TESTFLIGHT_BUBBLE !== "0";
const BUBBLE_BIN = process.env.CARTHA_AGENT_BUBBLE || path.join(HOME, ".hermes", "scripts", "hermes-bubble", "hermes-bubble");
const REPLIES_PATH = process.env.CARTHA_AGENT_REPLIES_PATH || path.join(HOME, ".hermes", "heartbeat-replies.jsonl");

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

function heuristicDecision({ subject, files, body }, channel = CHANNELS.ios_testflight) {
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

  if (explicitNo) {
    return {
      recommendation: "no",
      confidence: 0.98,
      reason: `Commit explicitly opts out of ${channel.label}.`,
    };
  }
  if (explicitYes) {
    return {
      recommendation: "yes",
      confidence: 0.98,
      reason: `Commit explicitly requests ${channel.label}.`,
    };
  }
  if (docsOnly || relevantFiles.length === 0) {
    return {
      recommendation: "no",
      confidence: 0.86,
      reason: `No user-facing ${channel.label} runtime files changed, so this should not spend an Apple upload slot.`,
    };
  }
  if (releaseKeywords) {
    return {
      recommendation: "yes",
      confidence: 0.78,
      reason: `This looks release-oriented and touches files relevant to ${channel.label}.`,
    };
  }
  if (userFacingKeywords) {
    return {
      recommendation: "hold",
      confidence: 0.66,
      reason: "This is user-facing, but likely should be batched unless you need device/TestFlight validation now.",
    };
  }
  return {
    recommendation: "no",
    confidence: 0.7,
    reason: `Mobile files changed, but the commit does not look release-critical enough to spend a ${channel.label} slot by default.`,
  };
}

async function hermesDecision(input, channel = CHANNELS.ios_testflight) {
  if (!USE_HERMES) return null;
  const prompt = `You are the Cartha Agent, acting as Cartha's Apple release steward. Decide whether this exact commit should spend one scarce ${channel.recommendationPrompt} slot. Return ONLY strict JSON with keys: recommendation (yes|hold|no), confidence (0..1), reason (one concise sentence). Prefer hold/no unless the commit is release-critical, user-facing enough to require physical-device or App Store validation, or explicitly asks for this upload lane.\n\nUpload lane: ${channel.label}\nWorkflow: ${channel.workflow}\nCommit: ${input.sha}\nSubject: ${input.subject}\nAuthor: ${input.author}\nFiles:\n${input.files.map((f) => `- ${f}`).join("\n")}\n\nDiff/stat/context:\n${input.body.slice(0, 8000)}`;
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

function notifyBubble(proposal) {
  if (!BUBBLE_ENABLED) return;
  const channel = proposal.channel || "ios_testflight";
  const isIos = channel === "ios_testflight";
  const title = isIos ? "iOS TestFlight upload?" : `${proposal.channel_label || "Apple upload"}?`;
  const rec = String(proposal.recommendation || "hold").toUpperCase();
  const severity = proposal.recommendation === "yes" ? "warning" : "notable";
  const actions = isIos ? ["Deploy iOS", "Skip", "Later"] : ["Deploy Mac", "Skip", "Later"];
  const message = [
    `Cartha Agent says ${rec} for ${proposal.short_sha}: ${proposal.subject}`,
    proposal.reason,
    "Ignore this and it will disappear; the proposal stays in the local console for later.",
  ].filter(Boolean).join("\n");
  try {
    const child = spawn(BUBBLE_BIN, [
      "--title", title,
      "--message", message.slice(0, 1200),
      "--severity", severity,
      "--duration", proposal.recommendation === "yes" ? "24" : "18",
      "--allow-reply",
      "--no-auto-focus",
      "--reply-id", proposal.id,
      "--reply-out", REPLIES_PATH,
      "--actions", actions.join("\x1f"),
      "--replace-key", "cartha-testflight-proposal",
      ...(proposal.recommendation === "yes" ? ["--sound", "Tink"] : []),
    ], { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // Bubble support is best-effort; terminal-notifier + console remain available.
  }
}

async function notify(proposal) {
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
  } catch {
    // Notification support is best-effort; the Cartha Agent console still shows the proposal.
  }
}

async function getCommitInput(sha) {
  const subject = await git(["show", "-s", "--format=%s", sha]);
  const author = await git(["show", "-s", "--format=%an <%ae>", sha]);
  const committedAt = await git(["show", "-s", "--format=%cI", sha]);
  const files = (await git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha])).split(/\r?\n/u).filter(Boolean);
  const body = await git(["show", "--stat", "--find-renames", "--format=fuller", "--no-ext-diff", "--no-color", sha], { maxBuffer: 8 * 1024 * 1024 });
  return { sha, subject, author, committedAt, files, body };
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
  const proposedStatus = FORCE_PENDING ? "pending" : (decision.recommendation === "no" ? "auto_skipped" : "pending");
  const terminalStatus = existing && ["skipped", "deploy_requested"].includes(existing.status);

  Object.assign(proposal, {
    recommendation: decision.recommendation,
    confidence: decision.confidence,
    reason: decision.reason,
    source: decision.source,
    status: terminalStatus ? existing.status : proposedStatus,
    updated_at: now,
  });

  const next = [proposal, ...proposals.filter((item) => !(item.sha === sha && (item.channel || "ios_testflight") === channelKey))].slice(0, 80);
  await writeJson(PROPOSALS_PATH, next);

  if (updateState) {
    const state = await readJson(STATE_PATH, {});
    state.lastSeenSha = sha;
    state.lastProposalAt = now;
    await writeJson(STATE_PATH, state);
  }

  const shouldNotify = proposal.status === "pending" && (!existing || existing.status !== "pending" || RENOTIFY);
  if (shouldNotify) {
    await notify(proposal);
    console.log(`Cartha Agent ${channel.label} proposal: ${proposal.recommendation.toUpperCase()} ${proposal.short_sha} — ${proposal.reason}`);
  } else if (proposal.status === "pending") {
    console.log(`Cartha Agent ${channel.label} proposal already pending for ${proposal.short_sha}.`);
  } else {
    console.log(`Cartha Agent kept ${channel.label} proposal ${proposal.status} for ${proposal.short_sha}: ${proposal.reason}`);
  }
}

async function main() {
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

  // Keep the scarce-upload decision focused on the latest state of main. Older
  // intermediate commits should not trigger separate upload approvals.
  for (const channelKey of SELECTED_CHANNELS) {
    await createProposalForSha(shas.at(-1), channelKey, { updateState: true });
  }
}

main().catch((err) => {
  console.error(`TestFlight proposal watcher failed: ${err?.message || err}`);
  process.exitCode = 1;
});
