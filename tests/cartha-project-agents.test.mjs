import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  composeAgentPrompt,
  loadRegistry,
  parseProjectIds,
  projectStatus,
  resolveProject,
  REPO_ROOT,
  validateRegistry,
} from "../lib/cartha-project-agents.mjs";

const registry = loadRegistry();

test("loads and validates the checked-in Cartha project-agent registry", () => {
  assert.equal(registry.version, 1);
  assert.deepEqual(Object.keys(registry.projects), ["assistant", "pob", "mobile", "web", "platform"]);
  assert.ok(Object.keys(registry.agents).length >= 7);
});

test("rejects agents that are assigned outside their project allowlist", () => {
  assert.throws(
    () => composeAgentPrompt({ registry, agentId: "mobile-engineer", projectIds: ["pob"], task: "Edit a verse" }),
    /not authorized/u,
  );
});

test("composes a prompt with CI, boundaries, context, and the requested task", () => {
  const prompt = composeAgentPrompt({
    registry,
    agentId: "orchestrator",
    projectIds: ["pob", "web", "mobile"],
    task: "Plan a reader change without deploying it.",
  });
  assert.match(prompt, /Cartha Orchestrator/u);
  assert.match(prompt, /AWS CodeBuild operational jobs/u);
  assert.match(prompt, /Flutter and hosted Next\.js Bible Reader parity/u);
  assert.match(prompt, /Do not push, merge, deploy/u);
  assert.match(prompt, /PLANNING CONTEXT ONLY/u);
  assert.doesNotMatch(prompt, /Local path:/u);
  assert.match(prompt, /Plan a reader change without deploying it\./u);
});

test("describes current-checkout mode accurately when worktrees are disabled", () => {
  const prompt = composeAgentPrompt({
    registry,
    agentId: "quality-engineer",
    projectIds: ["assistant"],
    task: "Inspect only.",
    worktree: false,
  });
  assert.match(prompt, /PRIMARY — current checkout/u);
  assert.doesNotMatch(prompt, /isolated feature worktree supplied/u);
});

test("resolves sibling repositories from CARTHA_PROJECTS_ROOT", () => {
  const resolved = resolveProject(registry, "mobile", {
    env: { CARTHA_PROJECTS_ROOT: "/tmp/cartha-root" },
    repoRoot: "/ignored/assistant",
  });
  assert.equal(resolved.path, "/tmp/cartha-root/cartha.ai.mobile");
});

test("reports checkout and missing context state without mutating repositories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cartha-projects-"));
  try {
    const mobile = path.join(root, "cartha.ai.mobile");
    await fs.mkdir(path.join(mobile, ".git"), { recursive: true });
    await fs.writeFile(path.join(mobile, "CLAUDE.md"), "# rules\n");
    const status = projectStatus(registry, "mobile", { env: { CARTHA_PROJECTS_ROOT: root } });
    assert.equal(status.exists, true);
    assert.equal(status.git, true);
    assert.ok(status.missingContextFiles.includes("cartha_ai_mobile/UI_MAP.md"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("normalizes comma-separated project ids", () => {
  assert.deepEqual(parseProjectIds("pob, web,pob"), ["pob", "web"]);
  assert.throws(() => parseProjectIds(""), /at least one project/u);
});

test("registry validator rejects unknown project references", () => {
  const copy = structuredClone(registry);
  copy.agents.orchestrator.projects.push("missing");
  assert.throws(() => validateRegistry(copy), /unknown project missing/u);
});

test("CLI dry-run keeps executable work scoped to one primary project", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cartha-agent-cli-"));
  const checkout = path.join(root, "cartha-hermes-agent-assistant");
  const cli = path.join(REPO_ROOT, "scripts", "cartha-agents.mjs");
  try {
    await fs.mkdir(checkout, { recursive: true });
    const init = spawnSync("git", ["init", "-q"], { cwd: checkout, encoding: "utf8" });
    assert.equal(init.status, 0, init.stderr);

    const result = spawnSync(
      process.execPath,
      [cli, "run", "--agent", "quality-engineer", "--projects", "assistant", "--task", "Inspect only.", "--dry-run"],
      { encoding: "utf8", env: { ...process.env, CARTHA_PROJECTS_ROOT: root } },
    );
    assert.equal(result.status, 0, result.stderr);
    const invocation = JSON.parse(result.stdout);
    assert.equal(invocation.cwd, checkout);
    assert.ok(invocation.args.includes("--worktree"));
    assert.ok(invocation.args.includes("--checkpoints"));
    assert.ok(invocation.args.includes("terminal,file,todo,delegation"));
    assert.doesNotMatch(invocation.args.join("\n"), new RegExp(checkout.replaceAll("/", "\\/"), "u"));

    const unisolated = spawnSync(
      process.execPath,
      [cli, "run", "--agent", "quality-engineer", "--projects", "assistant", "--task", "Inspect only.", "--no-worktree", "--dry-run"],
      { encoding: "utf8", env: { ...process.env, CARTHA_PROJECTS_ROOT: root } },
    );
    assert.equal(unisolated.status, 0, unisolated.stderr);
    assert.ok(!JSON.parse(unisolated.stdout).args.includes("--worktree"));

    const multi = spawnSync(
      process.execPath,
      [cli, "run", "--agent", "orchestrator", "--projects", "assistant,pob", "--task", "Edit both.", "--dry-run"],
      { encoding: "utf8", env: { ...process.env, CARTHA_PROJECTS_ROOT: root } },
    );
    assert.notEqual(multi.status, 0);
    assert.match(multi.stderr, /exactly one project/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("published package contains a runnable project registry", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cartha-agent-pack-"));
  try {
    const packed = spawnSync("npm", ["pack", "--silent", "--pack-destination", root], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.equal(packed.status, 0, packed.stderr);
    const archive = path.join(root, packed.stdout.trim().split("\n").at(-1));
    const extracted = spawnSync("tar", ["-xzf", archive, "-C", root], { encoding: "utf8" });
    assert.equal(extracted.status, 0, extracted.stderr);
    await fs.access(path.join(root, "package", "config", "cartha-projects.json"));
    const check = spawnSync(process.execPath, ["scripts/cartha-agents.mjs", "check"], {
      cwd: path.join(root, "package"),
      encoding: "utf8",
    });
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /Registry OK: 5 projects, 7 agents/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
