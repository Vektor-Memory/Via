/**
 * commands/upgrade.mjs — via upgrade
 * Connect Vektor Slipstream for semantic recall, vector search, and graph linking.
 * Writes VEKTOR_API_KEY to ~/.via/config.json and validates the connection.
 *
 * Usage:
 *   via upgrade                      # interactive
 *   via upgrade --key <KEY>          # non-interactive
 *   via upgrade --status             # check current connection
 *   via upgrade --disconnect         # remove key
 */

import { createInterface } from 'readline';
import { readConfig, writeConfig, hasSlipstream, setConfig } from '../utils/config.mjs';
import { bold, green, red, yellow, dim, blank } from '../utils/format.mjs';

const SLIPSTREAM_URL = 'https://api.vektormemory.com/v1';
const UPGRADE_URL    = 'https://vektormemory.com';

async function validateKey(key) {
  try {
    const res = await fetch(`${SLIPSTREAM_URL}/status`, {
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { valid: true, plan: data.plan ?? 'pro', facts: data.memory_count ?? 0 };
    }
    return { valid: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function showStatus() {
  const config = readConfig();
  const key    = process.env.VEKTOR_API_KEY || config.slipstream_key;
  console.log(`\n  ${bold('via upgrade')} — Slipstream status\n`);
  if (!key) {
    console.log(`  ${yellow('Not connected')}`);
    console.log(`  Run: via upgrade\n`);
    return;
  }
  console.log(`  Key: ${dim(key.slice(0, 8) + '...' + key.slice(-4))}`);
  console.log('  Validating...');
  const result = await validateKey(key);
  if (result.valid) {
    console.log(`  ${green('✓')} Connected — plan: ${result.plan} · ${result.facts} facts in memory`);
  } else {
    console.log(`  ${red('✗')} Connection failed: ${result.reason}`);
    console.log(`  Run: via upgrade --key <NEW_KEY>`);
  }
  blank();
}

export async function run(args) {
  // Status check
  if (args.includes('--status')) {
    await showStatus();
    return;
  }

  // Disconnect
  if (args.includes('--disconnect')) {
    const config = readConfig();
    delete config.slipstream_key;
    writeConfig(config);
    console.log(`\n  ${yellow('⚠')}  Slipstream disconnected. Local SQLite memory still active.\n`);
    return;
  }

  // Non-interactive key supply
  const keyIdx = args.indexOf('--key');
  if (keyIdx !== -1) {
    const key = args[keyIdx + 1];
    if (!key) { console.error('  --key requires a value'); process.exit(1); }

    process.stdout.write('  Validating key...');
    const result = await validateKey(key);
    if (!result.valid) {
      // Accept anyway — API may be offline; user knows their key
      console.log(`\n  ${yellow('⚠')}  Could not validate (${result.reason}) — saving anyway.`);
    } else {
      console.log(` ${green('✓')}`);
      console.log(`  Plan: ${result.plan} · ${result.facts} facts`);
    }

    setConfig('slipstream_key', key);
    console.log(`\n  ${green('✓')} Slipstream key saved to ~/.via/config.json`);
    console.log(`  All via commands now use semantic recall.\n`);
    console.log(dim(`  Run 'via status' to confirm, 'via context --query <topic>' to test.\n`));
    return;
  }

  // Interactive flow
  console.log(`
  ${bold('via upgrade')} — Connect Vektor Slipstream

  Slipstream adds:
    · Semantic recall across all your AI tools
    · Vector search + graph linking for via ingest
    · Cross-session memory that never resets

  Get your key → ${UPGRADE_URL}
`);

  if (hasSlipstream()) {
    console.log(`  ${green('✓')} Already connected. Run 'via upgrade --status' to check.\n`);
    return;
  }

  const rl  = createInterface({ input: process.stdin, output: process.stdout });
  const key = (await prompt(rl, '  Paste your Slipstream key (or press Enter to skip): ')).trim();
  rl.close();

  if (!key) {
    console.log(`\n  Skipped. Run 'via upgrade --key <KEY>' when ready.\n`);
    return;
  }

  process.stdout.write('\n  Validating...');
  const result = await validateKey(key);

  if (!result.valid) {
    console.log(` ${yellow('⚠')}  Could not validate (${result.reason})`);
    const rl2  = createInterface({ input: process.stdin, output: process.stdout });
    const save = (await prompt(rl2, '  Save anyway? (y/N): ')).trim().toLowerCase();
    rl2.close();
    if (save !== 'y') { console.log('  Cancelled.\n'); return; }
  } else {
    console.log(` ${green('✓')}`);
    console.log(`  Plan: ${result.plan} · ${result.facts} facts in memory`);
  }

  setConfig('slipstream_key', key);
  blank();
  console.log(`  ${green('✓')} Slipstream connected. ~/.via/config.json updated.`);
  console.log(`  Run 'via status' to see your full ecosystem health.\n`);
}
