#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const authPath = process.argv[2] || path.join(os.homedir(), '.hermes', 'auth.json');
if (!fs.existsSync(authPath)) {
  console.log(`No auth.json found at ${authPath}`);
  process.exit(0);
}

const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
let changed = 0;
for (const entry of auth?.credential_pool?.openrouter || []) {
  if (entry.last_status || entry.last_error_code || entry.last_error_message) {
    entry.last_status = null;
    entry.last_status_at = null;
    entry.last_error_code = null;
    entry.last_error_reason = null;
    entry.last_error_message = null;
    entry.last_error_reset_at = null;
    changed += 1;
  }
}
auth.updated_at = new Date().toISOString();
if (changed) fs.writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
console.log(changed ? `Reset ${changed} OpenRouter credential-pool entr${changed === 1 ? 'y' : 'ies'}.` : 'No OpenRouter exhaustion state to reset.');
