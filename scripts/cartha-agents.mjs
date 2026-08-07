#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

import {
  composeAgentPrompt,
  loadRegistry,
  parseProjectIds,
  projectStatus,
  resolveAgent,
  resolveProject,
} from "../lib/cartha-project-agents.mjs";

function usage(exitCode = 0) {
  console.log(`Cartha cross-repository agent control plane

Usage:
  node scripts/cartha-agents.mjs list
  node scripts/cartha-agents.mjs check
  node scripts/cartha-agents.mjs status [--json]
  node scripts/cartha-agents.mjs prompt --agent ID --projects ID[,ID] --task TEXT
  node scripts/cartha-agents.mjs run --agent ID --projects ID --task TEXT [--no-worktree] [--dry-run]
  node scripts/cartha-agents.mjs validate --project ID [--execute]

Environment:
  CARTHA_PROJECTS_ROOT  Parent directory containing sibling Cartha repositories.

Safety:
  run uses an isolated Hermes worktree by default. validate only prints commands
  unless --execute is supplied. Deployment, cloud mutation, publishing, and store
  submission are never initiated by this CLI.`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (["json", "execute", "dry-run", "no-worktree"].includes(key)) {
      flags[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    flags[key] = value;
    index += 1;
  }
  return { command, flags };
}

function gitValue(projectPath, args) {
  const result = spawnSync("git", ["-C", projectPath, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function printList(registry) {
  console.log("Agents:");
  for (const [id, agent] of Object.entries(registry.agents)) {
    console.log(`  ${id.padEnd(19)} ${agent.name} [${agent.tier}] -> ${agent.projects.join(", ")}`);
  }
  console.log("\nProjects:");
  for (const [id, project] of Object.entries(registry.projects)) {
    console.log(`  ${id.padEnd(10)} ${project.repository} — ${project.ci}`);
  }
}

function collectStatus(registry) {
  return Object.keys(registry.projects).map((projectId) => {
    const status = projectStatus(registry, projectId);
    if (!status.git) return { ...status, branch: null, dirty: null, remote: null };
    return {
      ...status,
      branch: gitValue(status.path, ["branch", "--show-current"]),
      dirty: Boolean(gitValue(status.path, ["status", "--porcelain"])),
      remote: gitValue(status.path, ["remote", "get-url", "origin"]),
    };
  });
}

function printStatus(registry, jsonOutput) {
  const statuses = collectStatus(registry);
  if (jsonOutput) {
    console.log(JSON.stringify(statuses, null, 2));
    return;
  }
  for (const status of statuses) {
    const state = !status.exists ? "MISSING" : !status.git ? "NOT_GIT" : status.dirty ? "DIRTY" : "clean";
    console.log(`${status.id.padEnd(10)} ${state.padEnd(7)} ${String(status.branch || "-").padEnd(36)} ${status.path}`);
    if (status.missingContextFiles.length) console.log(`           context not found: ${status.missingContextFiles.join(", ")}`);
  }
}

function requireFlags(flags, names) {
  for (const name of names) {
    if (!flags[name]) throw new Error(`--${name} is required`);
  }
}

function buildPrompt(registry, flags) {
  requireFlags(flags, ["agent", "projects", "task"]);
  const projectIds = parseProjectIds(flags.projects);
  return {
    projectIds,
    prompt: composeAgentPrompt({
      registry,
      agentId: flags.agent,
      projectIds,
      task: flags.task,
      worktree: !flags["no-worktree"],
    }),
  };
}

function runAgent(registry, flags) {
  const { projectIds, prompt } = buildPrompt(registry, flags);
  if (projectIds.length !== 1) {
    throw new Error("executable runs accept exactly one project; use prompt for cross-project planning and separate run commands for repository-scoped edits");
  }
  const primary = resolveProject(registry, projectIds[0]);
  if (!projectStatus(registry, projectIds[0]).git) throw new Error(`primary project is not a local git checkout: ${primary.path}`);
  if (flags["no-worktree"] && gitValue(primary.path, ["status", "--porcelain"])) {
    throw new Error("--no-worktree requires a clean primary checkout; use the default isolated worktree or commit/stash existing changes");
  }
  resolveAgent(registry, flags.agent);

  const args = [
    "chat",
    "-q", prompt,
    "--source", `cartha-agent:${flags.agent}`,
    "--checkpoints",
    "--max-turns", "120",
    "--toolsets", "terminal,file,todo,delegation",
  ];
  if (!flags["no-worktree"]) args.push("--worktree");

  if (flags["dry-run"]) {
    console.log(JSON.stringify({ command: "hermes", args, cwd: primary.path }, null, 2));
    return;
  }
  const result = spawnSync("hermes", args, { cwd: primary.path, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function validateProject(registry, flags) {
  requireFlags(flags, ["project"]);
  const project = resolveProject(registry, flags.project);
  const status = projectStatus(registry, flags.project);
  if (!status.git) throw new Error(`project is not a local git checkout: ${project.path}`);
  console.log(`${project.name} validation plan:`);
  project.validation.forEach((command, index) => console.log(`  ${index + 1}. ${command}`));
  if (!flags.execute) {
    console.log("\nDry run only. Re-run with --execute to run these commands.");
    return;
  }
  for (const command of project.validation) {
    console.log(`\n$ ${command}`);
    const result = spawnSync("/bin/bash", ["-lc", command], { cwd: project.path, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }
  }
}

function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (!command || command === "help" || flags.help) usage(0);
  const registry = loadRegistry();
  switch (command) {
    case "list": printList(registry); break;
    case "check": console.log(`Registry OK: ${Object.keys(registry.projects).length} projects, ${Object.keys(registry.agents).length} agents.`); break;
    case "status": printStatus(registry, Boolean(flags.json)); break;
    case "prompt": console.log(buildPrompt(registry, flags).prompt); break;
    case "run": runAgent(registry, flags); break;
    case "validate": validateProject(registry, flags); break;
    default: usage(1);
  }
}

try {
  main();
} catch (error) {
  console.error(`cartha-agents: ${error.message}`);
  process.exit(1);
}
