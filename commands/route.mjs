/**
 * commands/route.mjs — via route
 * Intelligent tool routing. Given a task, recommends which AI tool to use
 * based on cost, capability, and what's already in memory.
 *
 * Usage:
 *   via route "refactor the auth module"
 *   via route "write unit tests for utils.js"
 *   via route "summarise this PDF"
 *   via route --json
 */

import { detectTools } from '../utils/detect.mjs';
import { readConfig, hasSlipstream } from '../utils/config.mjs';
import { table, label, heading, blank, green, yellow, dim, bold } from '../utils/format.mjs';

// Capability profiles for each tool
const TOOL_PROFILES = {
  claude: {
    strengths:  ['writing', 'analysis', 'reasoning', 'code review', 'summarise', 'pdf', 'plan', 'research', 'explain'],
    cost:       'medium',
    best_for:   'Long-context reasoning, writing, analysis, file processing',
  },
  cursor: {
    strengths:  ['code', 'refactor', 'debug', 'implement', 'unit test', 'function', 'class', 'module', 'fix', 'error'],
    cost:       'medium',
    best_for:   'In-editor coding, refactors, debugging, implementation',
  },
  windsurf: {
    strengths:  ['code', 'autocomplete', 'scaffold', 'boilerplate', 'generate', 'prototype'],
    cost:       'low',
    best_for:   'Fast code generation, scaffolding, autocomplete',
  },
  chatgpt: {
    strengths:  ['image', 'dalle', 'vision', 'browse', 'plugin', 'search', 'draw'],
    cost:       'medium',
    best_for:   'Image generation, browsing, plugin ecosystem',
  },
};

function score(task, profile) {
  const t = task.toLowerCase();
  return profile.strengths.reduce((acc, kw) => acc + (t.includes(kw) ? 1 : 0), 0);
}

function rankTools(task, available) {
  return Object.entries(TOOL_PROFILES)
    .filter(([tool]) => available[tool])
    .map(([tool, profile]) => ({
      tool,
      score:   score(task, profile),
      cost:    profile.cost,
      best_for: profile.best_for,
    }))
    .sort((a, b) => b.score - a.score || (a.cost === 'low' ? -1 : 1));
}

export async function run(args) {
  const taskArgs = args.filter(a => !a.startsWith('--'));
  const asJSON   = args.includes('--json');
  const task     = taskArgs.join(' ');

  if (!task) {
    console.log(`
  Usage: via route "<task description>"

  Examples:
    via route "refactor the auth module"
    via route "summarise this 50-page PDF"
    via route "generate unit tests for utils.js"
    via route "draw a product wireframe"
`);
    return;
  }

  const tools   = detectTools();
  const ranked  = rankTools(task, tools);

  if (asJSON) { console.log(JSON.stringify({ task, ranked }, null, 2)); return; }

  console.log(`\n  ${bold('via route')} — "${task}"\n`);

  if (!ranked.length) {
    console.log('  No AI tools detected. Run: via status\n');
    return;
  }

  const top = ranked[0];
  console.log(`  ${green('→')} Recommended: ${bold(top.tool)}`);
  console.log(`    ${top.best_for}`);
  blank();

  if (ranked.length > 1) {
    const display = ranked.map((r, i) => ({
      rank:     i === 0 ? '★' : String(i + 1),
      tool:     r.tool,
      match:    r.score > 0 ? '●'.repeat(Math.min(r.score, 5)) : '–',
      cost:     r.cost,
      best_for: r.best_for.slice(0, 45),
    }));
    console.log(table(display, ['rank', 'tool', 'match', 'cost', 'best_for']));
  }

  if (!hasSlipstream()) {
    console.log(dim('  Upgrade to Slipstream for routing informed by actual usage history → npx via upgrade\n'));
  } else {
    blank();
  }
}
