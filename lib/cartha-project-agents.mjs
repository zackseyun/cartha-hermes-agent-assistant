import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(MODULE_DIR, "..");
export const DEFAULT_REGISTRY_PATH = path.join(REPO_ROOT, "config", "cartha-projects.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stringArray(value, label, { allowEmpty = false } = {}) {
  assert(Array.isArray(value), `${label} must be an array`);
  if (!allowEmpty) assert(value.length > 0, `${label} must not be empty`);
  for (const item of value) assert(typeof item === "string" && item.trim(), `${label} entries must be non-empty strings`);
  return value;
}

export function validateRegistry(registry) {
  assert(registry && typeof registry === "object" && !Array.isArray(registry), "registry must be an object");
  assert(registry.version === 1, "registry.version must be 1");
  assert(registry.defaults && typeof registry.defaults === "object", "registry.defaults is required");
  assert(registry.projects && typeof registry.projects === "object", "registry.projects is required");
  assert(registry.agents && typeof registry.agents === "object", "registry.agents is required");

  const projectIds = Object.keys(registry.projects);
  const agentIds = Object.keys(registry.agents);
  assert(projectIds.length > 0, "registry must define at least one project");
  assert(agentIds.length > 0, "registry must define at least one agent");

  for (const [id, project] of Object.entries(registry.projects)) {
    assert(/^[a-z][a-z0-9-]*$/u.test(id), `invalid project id: ${id}`);
    assert(typeof project.name === "string" && project.name.trim(), `projects.${id}.name is required`);
    assert(/^[^/]+\/[^/]+$/u.test(project.repository || ""), `projects.${id}.repository must be owner/repo`);
    assert(typeof project.directory === "string" && project.directory.trim(), `projects.${id}.directory is required`);
    stringArray(project.contextFiles, `projects.${id}.contextFiles`);
    stringArray(project.validation, `projects.${id}.validation`);
    stringArray(project.boundaries, `projects.${id}.boundaries`);
    assert(typeof project.ci === "string" && project.ci.trim(), `projects.${id}.ci is required`);
  }

  for (const [id, agent] of Object.entries(registry.agents)) {
    assert(/^[a-z][a-z0-9-]*$/u.test(id), `invalid agent id: ${id}`);
    assert(typeof agent.name === "string" && agent.name.trim(), `agents.${id}.name is required`);
    assert(["routine", "coding", "reasoning"].includes(agent.tier), `agents.${id}.tier is invalid`);
    stringArray(agent.projects, `agents.${id}.projects`);
    stringArray(agent.rules, `agents.${id}.rules`);
    assert(typeof agent.mission === "string" && agent.mission.trim(), `agents.${id}.mission is required`);
    for (const projectId of agent.projects) {
      assert(projectIds.includes(projectId), `agents.${id} references unknown project ${projectId}`);
    }
  }
  assert(Array.isArray(registry.relationships), "registry.relationships must be an array");
  for (const [index, relationship] of registry.relationships.entries()) {
    assert(projectIds.includes(relationship.producer), `relationships.${index} references unknown producer ${relationship.producer}`);
    assert(projectIds.includes(relationship.consumer), `relationships.${index} references unknown consumer ${relationship.consumer}`);
    assert(typeof relationship.contract === "string" && relationship.contract.trim(), `relationships.${index}.contract is required`);
  }
  return registry;
}

export function loadRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  return validateRegistry(parsed);
}

export function resolveProjectsRoot(registry, { env = process.env, repoRoot = REPO_ROOT } = {}) {
  const envName = registry.defaults.projectsRootEnv;
  const configured = envName && env[envName] ? path.resolve(env[envName]) : null;
  return configured || path.resolve(repoRoot, "..");
}

export function resolveProject(registry, projectId, options = {}) {
  const project = registry.projects[projectId];
  if (!project) throw new Error(`unknown project: ${projectId}`);
  const projectsRoot = resolveProjectsRoot(registry, options);
  return { id: projectId, ...project, path: path.join(projectsRoot, project.directory) };
}

export function resolveAgent(registry, agentId) {
  const agent = registry.agents[agentId];
  if (!agent) throw new Error(`unknown agent: ${agentId}`);
  return { id: agentId, ...agent };
}

export function parseProjectIds(raw) {
  const ids = String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!ids.length) throw new Error("at least one project id is required");
  return [...new Set(ids)];
}

export function composeAgentPrompt({ registry, agentId, projectIds, task, worktree = true }) {
  const agent = resolveAgent(registry, agentId);
  const selected = projectIds.map((projectId) => resolveProject(registry, projectId));
  for (const project of selected) {
    if (!agent.projects.includes(project.id)) throw new Error(`${agentId} is not authorized for project ${project.id}`);
  }
  assert(typeof task === "string" && task.trim(), "task must be a non-empty string");

  const projectSections = selected.map((project, index) => [
    `### ${project.name} (${project.id})`,
    `Access: ${index === 0 ? (worktree ? "PRIMARY — use the current working directory, which Hermes places in an isolated worktree" : "PRIMARY — current checkout; edits allowed only after confirming it is clean") : "PLANNING CONTEXT ONLY — do not use this multi-project prompt for an executable agent run"}`,
    `Repository: ${project.repository}`,
    `Checkout directory name: ${project.directory}`,
    `Native CI/CD: ${project.ci}`,
    `Read first: ${project.contextFiles.join(", ")}`,
    "Validation commands:",
    ...project.validation.map((command) => `- ${command}`),
    "Hard boundaries:",
    ...project.boundaries.map((boundary) => `- ${boundary}`),
  ].join("\n")).join("\n\n");
  const selectedIds = new Set(projectIds);
  const contracts = registry.relationships
    .filter(({ producer, consumer }) => selectedIds.has(producer) || selectedIds.has(consumer))
    .map(({ producer, consumer, contract }) => `- ${producer} -> ${consumer}: ${contract}`);

  return [
    `You are ${agent.name}, a project-local Cartha specialist.`,
    "",
    `Mission: ${agent.mission}`,
    `Model tier intent: ${agent.tier}.`,
    "",
    "Operating rules:",
    ...agent.rules.map((rule) => `- ${rule}`),
    "- Read the repository context files before editing.",
    "- Inspect git status before writing. Never overwrite unrelated work.",
    `- ${worktree ? "Use the isolated feature worktree supplied for primary-project mutations." : "This run explicitly uses the current primary checkout; confirm it remains clean before any mutation."}`,
    "- Executable runs are single-project only. Multi-project prompts are for planning; open a separate scoped run in each repository before editing it.",
    "- Run the smallest sufficient validation and report actual output.",
    "- Do not push, merge, deploy, publish, upload to an app store, or mutate cloud infrastructure unless the task explicitly authorizes that exact action.",
    "- When work spans repositories, state dependency order and keep commits repository-scoped.",
    "",
    "## Assigned projects",
    projectSections,
    "",
    "## Cross-repository contracts",
    ...(contracts.length ? contracts : ["- None registered for this project."]),
    "",
    "## Task",
    task.trim(),
  ].join("\n");
}

export function projectStatus(registry, projectId, { env = process.env, repoRoot = REPO_ROOT } = {}) {
  const project = resolveProject(registry, projectId, { env, repoRoot });
  const exists = fs.existsSync(project.path);
  const git = exists && fs.existsSync(path.join(project.path, ".git"));
  const missingContextFiles = exists
    ? project.contextFiles.filter((relativePath) => !fs.existsSync(path.join(project.path, relativePath)))
    : [...project.contextFiles];
  return { ...project, exists, git, missingContextFiles };
}
