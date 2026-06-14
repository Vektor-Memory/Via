#!/usr/bin/env node
/**
 * via-git-hooks.mjs — Implicit feedback capture via git hooks
 *
 * Installs two hooks into the current git repo:
 *   post-commit  → marks last via prompt as 'success'
 *   post-checkout / post-reset → marks last via prompt as 'revert'
 *
 * Install: node via-git-hooks.mjs install
 * Remove:  node via-git-hooks.mjs remove
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';

const VIA_DIR   = join(homedir(), '.via');
const LAST_F    = join(VIA_DIR, 'last-prompt.json');
const PROMPTS_F = join(VIA_DIR, 'prompts.json');

function getGitRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const POST_COMMIT_HOOK = `#!/bin/sh
# Via prompt implicit feedback — post-commit = success
VIA_LAST="${LAST_F.replace(/\\/g, '/')}"
VIA_PROMPTS="${PROMPTS_F.replace(/\\/g, '/')}"
if [ -f "$VIA_LAST" ]; then
  node -e "
    const fs = require('fs');
    const last = JSON.parse(fs.readFileSync('$VIA_LAST', 'utf8'));
    if (!last.outcome) {
      last.outcome = 'success';
      last.learned_at = new Date().toISOString();
      last.auto_captured = 'git-commit';
      let recs = [];
      try { recs = JSON.parse(fs.readFileSync('$VIA_PROMPTS', 'utf8')); } catch {}
      recs.push(last);
      fs.writeFileSync('$VIA_PROMPTS', JSON.stringify(recs, null, 2));
      fs.writeFileSync('$VIA_LAST', JSON.stringify({...last, outcome: 'success'}, null, 2));
      process.stdout.write('[Via] Prompt outcome auto-captured: success\\\\n');
    }
  " 2>/dev/null || true
fi
`;

const POST_CHECKOUT_HOOK = `#!/bin/sh
# Via prompt implicit feedback — checkout after agent work = possible revert
# Only fires if the previous HEAD was not a branch switch (3rd arg = 0 means file checkout)
if [ "$3" = "0" ]; then
  VIA_LAST="${LAST_F.replace(/\\/g, '/')}"
  if [ -f "$VIA_LAST" ]; then
    node -e "
      const fs = require('fs');
      const last = JSON.parse(fs.readFileSync('$VIA_LAST', 'utf8'));
      if (!last.outcome) {
        process.stdout.write('[Via] Detected file checkout — was this a revert? Run: via prompt --learn revert\\\\n');
      }
    " 2>/dev/null || true
  fi
fi
`;

function install() {
  const root = getGitRoot();
  if (!root) {
    console.error('Not in a git repository.');
    process.exit(1);
  }

  const hooksDir = join(root, '.git', 'hooks');
  if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });

  const commitHook   = join(hooksDir, 'post-commit');
  const checkoutHook = join(hooksDir, 'post-checkout');

  // post-commit
  let existing = '';
  if (existsSync(commitHook)) {
    existing = readFileSync(commitHook, 'utf8');
    if (existing.includes('Via prompt')) {
      console.log('post-commit hook already installed.');
    } else {
      writeFileSync(commitHook, existing + '\n' + POST_COMMIT_HOOK);
      console.log('post-commit hook updated.');
    }
  } else {
    writeFileSync(commitHook, POST_COMMIT_HOOK);
    console.log('post-commit hook installed.');
  }
  chmodSync(commitHook, 0o755);

  // post-checkout
  let existingCo = '';
  if (existsSync(checkoutHook)) {
    existingCo = readFileSync(checkoutHook, 'utf8');
    if (existingCo.includes('Via prompt')) {
      console.log('post-checkout hook already installed.');
    } else {
      writeFileSync(checkoutHook, existingCo + '\n' + POST_CHECKOUT_HOOK);
      console.log('post-checkout hook updated.');
    }
  } else {
    writeFileSync(checkoutHook, POST_CHECKOUT_HOOK);
    console.log('post-checkout hook installed.');
  }
  chmodSync(checkoutHook, 0o755);

  console.log('\nVia git hooks installed. Commits will auto-capture success outcomes.');
}

function remove() {
  const root = getGitRoot();
  if (!root) { console.error('Not in a git repository.'); process.exit(1); }

  const hooksDir = join(root, '.git', 'hooks');
  for (const hookName of ['post-commit', 'post-checkout']) {
    const hookPath = join(hooksDir, hookName);
    if (!existsSync(hookPath)) continue;
    let content = readFileSync(hookPath, 'utf8');
    // Remove Via blocks
    content = content.replace(/\n?# Via prompt.*?fi\n/gs, '');
    writeFileSync(hookPath, content.trim() + '\n');
    console.log(`Removed Via block from ${hookName}`);
  }
}

const cmd = process.argv[2];
if (cmd === 'install') install();
else if (cmd === 'remove') remove();
else {
  console.log('Usage: node via-git-hooks.mjs install|remove');
  process.exit(1);
}
