import assert from "node:assert/strict";
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
