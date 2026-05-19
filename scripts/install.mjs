#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const defaults = {
  hermesHome: path.join(os.homedir(), '.hermes'),
  agentDir: path.join(os.homedir(), '.hermes', 'hermes-agent'),
  workspaceDir: path.join(os.homedir(), 'hermes-workspace'),
  workspaceCwd: firstExisting([
    path.join(os.homedir(), 'Documents', 'GitHub'),
    path.join(os.homedir(), 'My Drive', 'Moltbot-Shared', 'Documents', 'GitHub'),
    os.homedir(),
  ]),
  agentRepo: 'https://github.com/NousResearch/hermes-agent.git',
  workspaceRepo: 'https://github.com/outsourc-e/hermes-workspace.git',
  agentModel: 'xiaomi/mimo-v2.5-pro',
  smallModel: 'deepseek/deepseek-v4-flash',
  visionModel: 'gemma4:31b-hermes',
};

function firstExisting(paths) {
  return paths.find((p) => fs.existsSync(p)) || paths[0];
}

function usage() {
  console.log(`Hermes Local Agent Kit installer

Usage:
  node scripts/install.mjs [options]

Options:
  --clone / --no-clone          Clone/update Hermes Agent + Hermes Workspace (default: clone)
  --launchd / --no-launchd      Install launchd services (default: launchd on macOS)
  --start / --no-start          Start/restart services after writing plists (default: start)
  --dry-run                     Print commands without changing services
  --force-config                Patch ~/.hermes/config.yaml with kit defaults (default: true)
  --no-force-config             Do not patch ~/.hermes/config.yaml
  --hermes-home <path>          Default: ~/.hermes
  --agent-dir <path>            Default: ~/.hermes/hermes-agent
  --workspace-dir <path>        Default: ~/hermes-workspace
  --workspace-cwd <path>        Terminal cwd exposed to the agent
  --agent-model <model>         Default: ${defaults.agentModel}
  --small-model <model>         Default: ${defaults.smallModel}
  --vision-model <model>        Default: ${defaults.visionModel}

After install:
  ~/.hermes/.env                Add OPENROUTER_API_KEY here
  http://127.0.0.1:5128         Small local console
  http://127.0.0.1:3000         Hermes Workspace UI
  http://127.0.0.1:9119         Native Hermes dashboard
`);
}

function parseArgs(argv) {
  const opts = {
    clone: true,
    launchd: process.platform === 'darwin',
    start: true,
    dryRun: false,
    forceConfig: true,
    ...defaults,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${arg} requires a value`);
      return v;
    };
    if (arg === '-h' || arg === '--help') return { help: true };
    if (arg === '--clone') opts.clone = true;
    else if (arg === '--no-clone') opts.clone = false;
    else if (arg === '--launchd') opts.launchd = true;
    else if (arg === '--no-launchd') opts.launchd = false;
    else if (arg === '--start') opts.start = true;
    else if (arg === '--no-start') opts.start = false;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--force-config') opts.forceConfig = true;
    else if (arg === '--no-force-config') opts.forceConfig = false;
    else if (arg === '--hermes-home') opts.hermesHome = path.resolve(next());
    else if (arg === '--agent-dir') opts.agentDir = path.resolve(next());
    else if (arg === '--workspace-dir') opts.workspaceDir = path.resolve(next());
    else if (arg === '--workspace-cwd') opts.workspaceCwd = path.resolve(next());
    else if (arg === '--agent-model') opts.agentModel = next();
    else if (arg === '--small-model') opts.smallModel = next();
    else if (arg === '--vision-model') opts.visionModel = next();
    else throw new Error(`Unknown option: ${arg}`);
  }
  return opts;
}

function run(cmd, args, opts = {}) {
  const printable = [cmd, ...args].map((s) => (s.includes(' ') ? JSON.stringify(s) : s)).join(' ');
  console.log(`$ ${printable}`);
  if (opts.dryRun) return;
  const result = spawnSync(cmd, args, {
    stdio: opts.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env || {}) },
    cwd: opts.cwd || process.cwd(),
  });
  if (result.status !== 0) {
    const err = result.stderr || result.stdout || `${cmd} exited ${result.status}`;
    throw new Error(err.trim());
  }
  return result.stdout;
}

function which(cmd) {
  const result = spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function readEnvFile(file) {
  const values = new Map();
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    values.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return values;
}

function ensureEnv(file, additions) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const present = readEnvFile(file);
  const lines = [];
  if (!existing) {
    lines.push('# Created by hermes-local-agent-kit. Do not commit this file.', '');
  }
  for (const [key, value] of Object.entries(additions)) {
    if (!present.has(key) || !present.get(key)) lines.push(`${key}=${value}`);
  }
  if (lines.length) {
    fs.appendFileSync(file, `${existing && !existing.endsWith('\n') ? '\n' : ''}${lines.join('\n')}\n`, { mode: 0o600 });
  }
  try { fs.chmodSync(file, 0o600); } catch {}
}

function cloneOrPull(url, dir, opts) {
  if (!fs.existsSync(dir)) {
    run('git', ['clone', url, dir], opts);
    return;
  }
  if (fs.existsSync(path.join(dir, '.git'))) {
    run('git', ['fetch', '--all', '--tags'], { ...opts, cwd: dir });
    run('git', ['pull', '--ff-only'], { ...opts, cwd: dir });
  } else {
    console.warn(`Skipping clone; ${dir} exists but is not a git repo.`);
  }
}

function installHermesAgent(opts) {
  const venv = path.join(opts.agentDir, 'venv');
  const python = path.join(venv, 'bin', 'python');
  if (!fs.existsSync(python)) run('python3', ['-m', 'venv', venv], opts);
  run(python, ['-m', 'pip', 'install', '--upgrade', 'pip'], opts);
  run(python, ['-m', 'pip', 'install', '-e', '.'], { ...opts, cwd: opts.agentDir });
}

function installWorkspace(opts) {
  if (which('corepack')) run('corepack', ['enable'], { ...opts, capture: false });
  if (!which('pnpm')) {
    throw new Error('Missing prerequisite: pnpm. Install it with `corepack enable` or `npm install -g pnpm`.');
  }
  run('pnpm', ['install'], { ...opts, cwd: opts.workspaceDir });
}

function patchHermesConfig(opts) {
  const python = fs.existsSync(path.join(opts.agentDir, 'venv', 'bin', 'python'))
    ? path.join(opts.agentDir, 'venv', 'bin', 'python')
    : 'python3';
  const payload = path.join(os.tmpdir(), `hermes-local-agent-kit-${process.pid}.json`);
  fs.writeFileSync(payload, JSON.stringify(opts));
  const script = `
import json, pathlib, sys
try:
    import yaml
except Exception as exc:
    raise SystemExit('PyYAML is required to patch config.yaml; install Hermes Agent first. ' + str(exc))
opts=json.load(open(sys.argv[1]))
home=pathlib.Path(opts['hermesHome'])
home.mkdir(parents=True, exist_ok=True)
p=home/'config.yaml'
cfg={}
if p.exists():
    cfg=yaml.safe_load(p.read_text()) or {}
cfg['model']={
    'default': opts['agentModel'],
    'provider': 'openrouter',
    'base_url': 'https://openrouter.ai/api/v1',
    'context_length': 1048576,
    'max_tokens': 256,
}
cfg['fallback_providers']=[{
    'provider': 'openrouter',
    'model': opts['smallModel'],
    'base_url': 'https://openrouter.ai/api/v1',
    'key_env': 'OPENROUTER_API_KEY',
}]
cfg.setdefault('platform_toolsets', {})['api_server']=['terminal','file','todo','delegation']
terminal=cfg.setdefault('terminal', {})
terminal['backend']='local'
terminal['cwd']=opts['workspaceCwd']
terminal['timeout']=180
terminal.setdefault('lifetime_seconds', 300)
terminal.setdefault('docker_mount_cwd_to_workspace', False)
p.write_text(yaml.safe_dump(cfg, sort_keys=False, width=120))
print(f'wrote {p}')
`;
  run(python, ['-c', script, payload], opts);
  try { fs.unlinkSync(payload); } catch {}
}

function renderTemplates(opts) {
  const launchDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  fs.mkdirSync(path.join(opts.hermesHome, 'logs'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(repoDir, 'logs'), { recursive: true });
  fs.mkdirSync(launchDir, { recursive: true });
  const nodeBin = which('node') || '/usr/bin/node';
  const pythonBin = path.join(opts.agentDir, 'venv', 'bin', 'python');
  const hermesBin = path.join(opts.agentDir, 'venv', 'bin', 'hermes');
  const replacements = {
    __HOME__: os.homedir(),
    __REPO_DIR__: repoDir,
    __HERMES_HOME__: opts.hermesHome,
    __AGENT_DIR__: opts.agentDir,
    __WORKSPACE_DIR__: opts.workspaceDir,
    __NODE_BIN__: nodeBin,
    __PYTHON_BIN__: pythonBin,
    __HERMES_BIN__: hermesBin,
    __PATH__: `${path.join(opts.agentDir, 'venv', 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
  };
  const templateDir = path.join(repoDir, 'templates', 'launchd');
  const written = [];
  for (const name of fs.readdirSync(templateDir)) {
    if (!name.endsWith('.plist')) continue;
    let content = fs.readFileSync(path.join(templateDir, name), 'utf8');
    for (const [key, value] of Object.entries(replacements)) content = content.replaceAll(key, value);
    const out = path.join(launchDir, name);
    fs.writeFileSync(out, content);
    written.push(out);
  }
  return written;
}

function launchServices(plists, opts) {
  if (opts.dryRun) {
    console.log('Would install/start launchd services:', plists.join(', '));
    return;
  }
  const domain = `gui/${process.getuid()}`;
  for (const plist of plists) {
    const label = path.basename(plist, '.plist');
    // bootout returns non-zero when not loaded; ignore that case.
    spawnSync('launchctl', ['bootout', domain, plist], { stdio: 'ignore' });
    const bootstrap = spawnSync('launchctl', ['bootstrap', domain, plist], { stdio: 'inherit' });
    if (bootstrap.status !== 0) console.warn(`launchctl bootstrap failed for ${label}; it may already be loaded.`);
    spawnSync('launchctl', ['kickstart', '-k', `${domain}/${label}`], { stdio: 'inherit' });
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return usage();

  console.log('Hermes Local Agent Kit installer');
  console.log(JSON.stringify({
    hermesHome: opts.hermesHome,
    agentDir: opts.agentDir,
    workspaceDir: opts.workspaceDir,
    workspaceCwd: opts.workspaceCwd,
    agentModel: opts.agentModel,
    smallModel: opts.smallModel,
  }, null, 2));

  for (const cmd of ['git', 'python3', 'node']) {
    if (!which(cmd)) throw new Error(`Missing prerequisite: ${cmd}`);
  }

  if (opts.dryRun) {
    console.log(`Would ensure ${path.join(opts.hermesHome, '.env')} contains API_SERVER_KEY and OpenRouter placeholders.`);
  } else {
    ensureEnv(path.join(opts.hermesHome, '.env'), {
      API_SERVER_ENABLED: 'true',
      API_SERVER_KEY: randomSecret(32),
      API_SERVER_CORS_ORIGINS: 'http://127.0.0.1:5128,http://localhost:5128,http://127.0.0.1:3000,http://localhost:3000',
      OPENROUTER_API_KEY: '',
    });
  }

  if (opts.clone) {
    cloneOrPull(opts.agentRepo, opts.agentDir, opts);
    cloneOrPull(opts.workspaceRepo, opts.workspaceDir, opts);
    installHermesAgent(opts);
    installWorkspace(opts);
  }

  if (opts.dryRun) {
    console.log(`Would ensure ${path.join(opts.workspaceDir, '.env')} has HERMES_API_TOKEN and HERMES_PASSWORD.`);
  } else {
    const hermesEnv = readEnvFile(path.join(opts.hermesHome, '.env'));
    ensureEnv(path.join(opts.workspaceDir, '.env'), {
      HERMES_API_URL: 'http://127.0.0.1:8642',
      HERMES_DASHBOARD_URL: 'http://127.0.0.1:9119',
      HERMES_API_TOKEN: hermesEnv.get('API_SERVER_KEY') || randomSecret(32),
      CLAUDE_API_TOKEN: hermesEnv.get('API_SERVER_KEY') || randomSecret(32),
      HERMES_PASSWORD: randomSecret(18),
    });
  }

  if (opts.forceConfig) {
    if (opts.dryRun) console.log(`Would patch ${path.join(opts.hermesHome, 'config.yaml')} with model/tool/cwd settings.`);
    else patchHermesConfig(opts);
  }

  if (opts.launchd) {
    const plists = opts.dryRun
      ? fs.readdirSync(path.join(repoDir, 'templates', 'launchd'))
          .filter((name) => name.endsWith('.plist'))
          .map((name) => path.join(os.homedir(), 'Library', 'LaunchAgents', name))
      : renderTemplates(opts);
    console.log('Wrote launchd plists:');
    for (const p of plists) console.log(`  ${p}`);
    if (opts.start) launchServices(plists, opts);
  }

  console.log('\nNext steps:');
  console.log(`1. Add your OpenRouter key to ${path.join(opts.hermesHome, '.env')} as OPENROUTER_API_KEY=...`);
  console.log('2. Open http://127.0.0.1:5128 for the local console.');
  console.log('3. Open http://127.0.0.1:3000 for Hermes Workspace.');
  console.log('4. Run: npm run smoke');
}

main().catch((err) => {
  console.error(`install failed: ${err.message || err}`);
  process.exit(1);
});
