/**
 * commands/context.mjs — via context
 * Universal context injection. Pulls memory, formats for target AI tool.
 *
 * Usage:
 *   via context --query "current project"
 *   via context --query "auth system" --for cursor
 *   via context --query "deploy" --for windsurf --json
 */

import { readConfig, hasSlipstream } from '../utils/config.mjs';
import { getDb, viaDir } from '../utils/db.mjs';
import { label, heading, blank, bold, dim } from '../utils/format.mjs';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';

// Tool-specific system prompt wrappers
const FORMATS = {
  claude:    (block) => `<memory>\n${block}\n</memory>`,
  cursor:    (block) => `// CONTEXT\n${block.split('\n').map(l => `// ${l}`).join('\n')}`,
  windsurf:  (block) => `<!-- CONTEXT\n${block}\n-->`,
  chatgpt:   (block) => `[MEMORY CONTEXT]\n${block}\n[END CONTEXT]`,
  langchain: (block) => block,
  raw:       (block) => block,
};

async function recallLocal(query) {
  try {
    const db = await getDb('memory');
    db.exec(`CREATE TABLE IF NOT EXISTS memory (
      id INTEGER PRIMARY KEY,
      content TEXT NOT NULL,
      tags TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    const rows = db.prepare(
      `SELECT content FROM memory WHERE content LIKE ? ORDER BY id DESC LIMIT 10`
    ).all(`%${query}%`);
    return rows.map(r => r.content).join('\n\n');
  } catch {
    return '';
  }
}

async function recallSlipstream(query) {
  // Slipstream upgrade: calls vektor_recall via local IPC or env key
  // For now returns empty — wired when VEKTOR_API_KEY is present
  return '';
}

export async function run(args) {
  const queryIdx = args.indexOf('--query');
  const forIdx   = args.indexOf('--for');
  const asJSON   = args.includes('--json');
  const copy     = args.includes('--copy');

  const query  = queryIdx !== -1 ? args[queryIdx + 1] : args[0];
  const target = (forIdx !== -1 ? args[forIdx + 1] : 'raw').toLowerCase();

  if (!query) {
    console.log(`
  Usage: via context --query <topic> [--for <tool>] [--json] [--copy]

  Tools:  claude  cursor  windsurf  chatgpt  langchain  raw

  Examples:
    via context --query "current sprint" --for cursor
    via context --query "auth system" --for claude --copy
`);
    return;
  }

  const formatter = FORMATS[target] ?? FORMATS.raw;

  // Pull memory — Slipstream if connected, else local SQLite
  const recall = hasSlipstream()
    ? await recallSlipstream(query)
    : await recallLocal(query);

  const config   = readConfig();
  const profile  = config.profile ?? '';
  const sections = [];

  if (profile) sections.push(`PROFILE\n${profile}`);
  if (recall)  sections.push(`RECALL: ${query}\n${recall}`);
  if (!sections.length) sections.push(`No memory found for: "${query}"\nRun 'via ingest' to add knowledge.`);

  const block = sections.join('\n\n---\n\n');
  const output = formatter(block);

  if (asJSON) {
    console.log(JSON.stringify({ query, target, block, formatted: output }, null, 2));
    return;
  }

  if (copy) {
    // Attempt clipboard write (cross-platform)
    try {
      const cmd = process.platform === 'darwin' ? 'pbcopy'
                : process.platform === 'win32'  ? 'clip'
                : 'xclip -selection clipboard';
      const { spawnSync } = await import('child_process');
      const proc = spawnSync(cmd, { input: output, shell: true });
      if (proc.status === 0) console.log('  ✓ Copied to clipboard');
    } catch {
      console.log('  Could not copy — paste below manually:');
    }
  }

  console.log(`\n  ${bold(`via context`)} — formatted for ${target}\n`);
  console.log(output);
  blank();

  if (!hasSlipstream()) {
    console.log(dim(`  Upgrade to Slipstream for semantic recall → npx via upgrade`));
    blank();
  }
}

