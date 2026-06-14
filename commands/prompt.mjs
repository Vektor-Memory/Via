/**
 * commands/prompt.mjs — Via prompt command
 * Self-improving, historically-informed prompt assembly.
 *
 * Architecture (from hardened spec):
 *   Storage  → JSON (default) → SQLite (>500 records) → VEKTOR (if installed)
 *   Retrieve → BM25 (minisearch, zero native deps) → VEKTOR semantic (if installed)
 *   Assemble → Template fill → LLM refinement (if API key present)
 *   Feedback → --learn flag + git hook integration
 *   Export   → CLAUDE.md / YAML / Codex / Gemini
 *
 * Usage:
 *   via prompt "add authentication to the API"
 *   via prompt "fix the token refresh bug" --type debug
 *   via prompt --learn success
 *   via prompt --learn correction --note "needed JWT not sessions"
 *   via prompt --learn revert
 *   via prompt --history
 *   via prompt --avoid "never use Passport.js" --scope global
 *   via prompt --avoid-list
 *   via prompt --export claude
 *   via prompt --export yaml
 *   via prompt --export codex
 *   via prompt --export gemini
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join }        from 'path';
import { homedir }     from 'os';
import { createHash }  from 'crypto';

// ── Colour helpers (match via.mjs palette) ────────────────────────────────
const _ = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  white: '\x1b[97m', silver: '\x1b[37m', grey: '\x1b[90m',
  sky: '\x1b[38;5;117m', ice: '\x1b[38;5;153m', steel: '\x1b[38;5;67m',
  green: '\x1b[38;5;78m', red: '\x1b[38;5;203m', amber: '\x1b[38;5;221m',
  cobalt: '\x1b[38;5;26m',
};
const c   = (col, s) => `${col}${s}${_.reset}`;
const W   = s => c(_.white + _.bold, s);
const Gr  = s => c(_.grey, s);
const Sk  = s => c(_.sky, s);
const Ic  = s => c(_.ice, s);
const St  = s => c(_.steel, s);
const G   = s => c(_.green, s);
const R   = s => c(_.red, s);
const Y   = s => c(_.amber, s);
const Si  = s => c(_.silver, s);

const BAR = St('│');
const TL  = St('┌─');
const BL  = St('└');
const HR  = St('─');

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }
function box(label) {
  const raw = stripAnsi(label);
  console.log('  ' + TL + ' ' + Ic(label) + ' ' + HR.repeat(Math.max(2, 44 - raw.length)));
}
function boxEnd() { console.log('  ' + BL + HR.repeat(47)); console.log(''); }
function row(label, value) {
  const raw = stripAnsi(label);
  const pad = ' '.repeat(Math.max(1, 22 - raw.length));
  console.log('  ' + BAR + ' ' + label + pad + value);
}
function blank() { console.log('  ' + BAR); }
function info(msg)  { console.log('  ' + Gr('→') + '  ' + msg); }
function ok(msg)    { console.log('\n  ' + G('✓') + '  ' + msg + '\n'); }
function fail(msg)  { console.error('\n  ' + R('✗') + '  ' + msg + '\n'); }
function warn(msg)  { console.log('  ' + Y('⚠') + '  ' + msg); }

// ── Storage paths ──────────────────────────────────────────────────────────
const VIA_DIR     = join(homedir(), '.via');
const PROMPTS_F   = join(VIA_DIR, 'prompts.json');
const AVOID_F     = join(VIA_DIR, 'avoid.json');
const LAST_F      = join(VIA_DIR, 'last-prompt.json');
const GENERIC_F   = join(VIA_DIR, 'generic-patterns.json');

function ensureDir() {
  if (!existsSync(VIA_DIR)) mkdirSync(VIA_DIR, { recursive: true, mode: 0o700 });
}

// ── JSON storage R/W ───────────────────────────────────────────────────────
function loadPrompts() {
  if (!existsSync(PROMPTS_F)) return [];
  try { return JSON.parse(readFileSync(PROMPTS_F, 'utf8')); }
  catch { return []; }
}

function savePrompts(records) {
  ensureDir();
  writeFileSync(PROMPTS_F, JSON.stringify(records, null, 2), { mode: 0o600 });
}

function loadAvoid() {
  if (!existsSync(AVOID_F)) return [];
  try { return JSON.parse(readFileSync(AVOID_F, 'utf8')); }
  catch { return []; }
}

function saveAvoid(entries) {
  ensureDir();
  writeFileSync(AVOID_F, JSON.stringify(entries, null, 2), { mode: 0o600 });
}

function loadLast() {
  if (!existsSync(LAST_F)) return null;
  try { return JSON.parse(readFileSync(LAST_F, 'utf8')); }
  catch { return null; }
}

function saveLast(obj) {
  ensureDir();
  writeFileSync(LAST_F, JSON.stringify(obj, null, 2), { mode: 0o600 });
}

function loadGeneric() {
  if (!existsSync(GENERIC_F)) return getDefaultPatterns();
  try { return JSON.parse(readFileSync(GENERIC_F, 'utf8')); }
  catch { return getDefaultPatterns(); }
}

function saveGeneric(patterns) {
  ensureDir();
  writeFileSync(GENERIC_F, JSON.stringify(patterns, null, 2), { mode: 0o600 });
}

// ── Default generic patterns (ship with Via) ───────────────────────────────
function getDefaultPatterns() {
  return {
    debug: {
      budget: { task: 20, context: 30, success: 10, avoid: 40 },
      template: 'You are debugging a specific issue. Before proposing a fix, list every edge case and boundary condition. Check for similar past failures in context. State your confidence in each hypothesis before testing it.',
    },
    implement: {
      budget: { task: 20, context: 30, success: 40, avoid: 10 },
      template: 'You are implementing a feature. Match the existing architecture and code style exactly. No new dependencies unless explicitly requested. Follow the patterns in the success context below.',
    },
    review: {
      budget: { task: 30, context: 50, success: 10, avoid: 10 },
      template: 'You are reviewing code changes. Apply team standards from context. Flag security issues, logic errors, and style violations separately. Reference specific line numbers.',
    },
    test: {
      budget: { task: 20, context: 30, success: 40, avoid: 10 },
      template: 'You are writing tests. Match the existing test framework, style, and naming conventions exactly. Cover happy path, error cases, and edge cases. Do not introduce new testing utilities.',
    },
    commit: {
      budget: { task: 20, context: 50, success: 20, avoid: 10 },
      template: 'You are writing a git commit message. Match the existing commit history style exactly. Be specific about what changed and why. No generic messages.',
    },
    refactor: {
      budget: { task: 20, context: 30, success: 35, avoid: 15 },
      template: 'You are refactoring code. Preserve all existing behaviour. Do not change public interfaces. Improve readability and reduce complexity. Note any behaviour-changing decisions explicitly.',
    },
    general: {
      budget: { task: 25, context: 30, success: 25, avoid: 20 },
      template: 'You are a senior developer working on this codebase. Use the context below to inform your response.',
    },
  };
}

// ── BM25 (pure JS, zero native deps) ─────────────────────────────────────
// Lightweight BM25 implementation — no minisearch dependency needed
const BM25_K1 = 1.5;
const BM25_B  = 0.75;

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function stem(word) {
  // Basic Porter stemmer rules
  return word
    .replace(/ings?$/, '')
    .replace(/tion$/, '')
    .replace(/ing$/, '')
    .replace(/ed$/, '')
    .replace(/er$/, '')
    .replace(/ly$/, '')
    .replace(/ies$/, 'y')
    .replace(/s$/, '');
}

function stemTokenize(text) {
  return tokenize(text).map(stem);
}

function buildIndex(records) {
  const docs   = records.map(r => stemTokenize(r.task + ' ' + (r.correction_note || '')));
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / (docs.length || 1);
  const df     = {};
  for (const d of docs) {
    const seen = new Set(d);
    for (const t of seen) df[t] = (df[t] || 0) + 1;
  }
  return { docs, avgLen, df, N: docs.length };
}

function bm25Score(index, query, docIdx) {
  const { docs, avgLen, df, N } = index;
  const doc = docs[docIdx];
  const docLen = doc.length;
  const tf = {};
  for (const t of doc) tf[t] = (tf[t] || 0) + 1;

  let score = 0;
  for (const term of stemTokenize(query)) {
    const f = tf[term] || 0;
    if (!f) continue;
    const idf = Math.log((N - (df[term] || 0) + 0.5) / ((df[term] || 0) + 0.5) + 1);
    const tf_norm = (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * docLen / avgLen));
    score += idf * tf_norm;
  }
  return score;
}

function bm25Retrieve(records, query, topK = 5) {
  if (!records.length) return [];
  const index = buildIndex(records);
  const scored = records.map((r, i) => ({ record: r, score: bm25Score(index, query, i) }));
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.record);
}

// ── Task type detection ────────────────────────────────────────────────────
function detectTaskType(task) {
  const t = task.toLowerCase();
  if (/\b(fix|debug|error|bug|crash|fail|broken|issue|null|undefined|exception)\b/.test(t)) return 'debug';
  if (/\b(test|spec|coverage|unit|integration|jest|mocha|pytest|vitest)\b/.test(t)) return 'test';
  if (/\b(review|audit|check|inspect|analyse|analyze|lint)\b/.test(t)) return 'review';
  if (/\b(commit|message|changelog|release|tag)\b/.test(t)) return 'commit';
  if (/\b(refactor|clean|simplify|extract|rename|reorganise|reorganize)\b/.test(t)) return 'refactor';
  if (/\b(add|implement|build|create|write|make|new|feature|endpoint|api|route|component)\b/.test(t)) return 'implement';
  return 'general';
}

// ── Token budget manager ───────────────────────────────────────────────────
const TOKEN_APPROX = 4; // chars per token approx

function approxTokens(text) {
  return Math.ceil((text || '').length / TOKEN_APPROX);
}

function budgetSlice(text, maxTokens) {
  const maxChars = maxTokens * TOKEN_APPROX;
  if (!text || text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '...';
}

// ── AVOID store helpers ────────────────────────────────────────────────────
function getActiveAvoid(avoidList, task, maxTokens = 400) {
  const now = Date.now();
  const DECAY_TASKS = 30;

  // Filter archived entries
  const active = avoidList.filter(e => e.status !== 'archived');

  // Score by relevance to current task
  const taskTokens = stemTokenize(task);
  const scored = active.map(e => {
    const eTokens = stemTokenize(e.constraint + ' ' + (e.reason || ''));
    const overlap = taskTokens.filter(t => eTokens.includes(t)).length;
    // Global scope always gets a base score
    const scopeBoost = e.scope === 'global' ? 2 : 0;
    return { entry: e, score: overlap + scopeBoost };
  });

  // Sort by relevance, take top entries within token budget
  scored.sort((a, b) => b.score - a.score);

  const result = [];
  let used = 0;
  for (const { entry, score } of scored) {
    if (score === 0 && entry.scope !== 'global') continue;
    const tokens = approxTokens(entry.constraint + entry.reason);
    if (used + tokens > maxTokens) break;
    result.push(entry);
    used += tokens;
  }

  return result;
}

function decayAvoid(avoidList, currentTaskCount) {
  return avoidList.map(e => {
    const tasksSinceUse = currentTaskCount - (e.last_task_index || 0);
    if (tasksSinceUse > 30 && e.scope !== 'global' && e.status !== 'archived') {
      return { ...e, status: 'archived' };
    }
    return e;
  });
}

// ── Confidence signal ──────────────────────────────────────────────────────
function computeConfidence(successMatches, failMatches) {
  const total = successMatches.length + failMatches.length;
  if (total === 0) return { level: 'low', emoji: '🔴', rate: 0, total: 0 };
  const rate = Math.round((successMatches.length / total) * 100);
  if (rate >= 80 && total >= 5)  return { level: 'high',   emoji: '🟢', rate, total };
  if (rate >= 60 && total >= 3)  return { level: 'medium', emoji: '🟡', rate, total };
  return { level: 'low', emoji: '🔴', rate, total };
}

// ── JIT abstraction (read-time, ephemeral) ─────────────────────────────────
async function jitAbstract(records, task, apiKey, provider) {
  if (!apiKey || records.length < 3) return null;
  const snippets = records.slice(0, 5).map((r, i) =>
    `Task ${i+1}: "${r.task}" → outcome: ${r.outcome}${r.correction_note ? ` (correction: ${r.correction_note})` : ''}`
  ).join('\n');

  const prompt = `You are extracting a general rule from past coding task patterns.
Past tasks for similar requests:
${snippets}

Current task: "${task}"

Extract ONE concise general rule (max 2 sentences) that would improve performance on the current task.
Focus on patterns, not specifics. Do NOT mention specific filenames or variable names.
Return only the rule, no explanation.`;

  try {
    const result = await callLLM(prompt, apiKey, provider, 150);
    return result?.trim() || null;
  } catch {
    return null;
  }
}

// ── LLM caller (any provider) ──────────────────────────────────────────────
async function detectProvider() {
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', key: process.env.ANTHROPIC_API_KEY };
  if (process.env.OPENAI_API_KEY)    return { provider: 'openai',    key: process.env.OPENAI_API_KEY };
  if (process.env.GROQ_API_KEY)      return { provider: 'groq',      key: process.env.GROQ_API_KEY };
  // Check Ollama
  try {
    const { default: http } = await import('http');
    await new Promise((res, rej) => {
      const req = http.get('http://localhost:11434/api/tags', r => res(r));
      req.on('error', rej);
      req.setTimeout(1000, () => { req.destroy(); rej(new Error('timeout')); });
    });
    return { provider: 'ollama', key: '' };
  } catch { return null; }
}

async function callLLM(prompt, apiKey, provider, maxTokens = 800) {
  const { default: https } = await import('https');
  const { default: http }  = await import('http');

  return new Promise((resolve, reject) => {
    let url, headers, body;

    if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      headers = {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      };
      body = JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });
    } else if (provider === 'openai' || provider === 'groq') {
      const host = provider === 'groq' ? 'api.groq.com' : 'api.openai.com';
      const model = provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';
      url = `https://${host}/v1/chat/completions`;
      headers = { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' };
      body = JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });
    } else if (provider === 'ollama') {
      url = 'http://localhost:11434/api/chat';
      headers = { 'content-type': 'application/json' };
      body = JSON.stringify({
        model: 'llama3',
        stream: false,
        messages: [{ role: 'user', content: prompt }],
      });
    } else {
      return reject(new Error('Unknown provider'));
    }

    const parsed  = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib     = isHttps ? https : http;
    headers['content-length'] = Buffer.byteLength(body);

    const req = lib.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers,
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (provider === 'anthropic') resolve(json.content?.[0]?.text);
          else if (provider === 'ollama') resolve(json.message?.content);
          else resolve(json.choices?.[0]?.message?.content);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Prompt assembly ────────────────────────────────────────────────────────
async function assemblePrompt(task, opts = {}) {
  const { taskType, successMatches, failMatches, avoidEntries, abstraction, totalBudgetTokens = 2000, generic } = opts;

  const pattern = generic[taskType] || generic.general;
  const budget  = pattern.budget;

  // Token allocations
  const budgetTokens = {
    task:    Math.floor(totalBudgetTokens * budget.task    / 100),
    context: Math.floor(totalBudgetTokens * budget.context / 100),
    success: Math.floor(totalBudgetTokens * budget.success / 100),
    avoid:   Math.floor(totalBudgetTokens * budget.avoid   / 100),
  };

  const sections = [];

  // SYSTEM / ROLE
  sections.push(`## SYSTEM\n${pattern.template}`);

  // GOAL
  sections.push(`## GOAL\n${budgetSlice(task, budgetTokens.task)}`);

  // ARCHITECTURE CONTEXT (from success patterns)
  if (successMatches.length > 0) {
    const ctxLines = [];
    if (abstraction) ctxLines.push(`General pattern (JIT abstracted): ${abstraction}`);
    for (const r of successMatches.slice(0, 3)) {
      if (r.context_note) ctxLines.push(`- ${r.context_note}`);
    }
    if (ctxLines.length > 0) {
      sections.push(`## CONTEXT\n${budgetSlice(ctxLines.join('\n'), budgetTokens.context)}`);
    }
  }

  // SUCCESS PATTERNS
  if (successMatches.length > 0) {
    const lines = successMatches.slice(0, 3).map(r =>
      `- Task: "${r.task.slice(0, 80)}" → succeeded${r.correction_note ? ` (note: ${r.correction_note})` : ''}`
    );
    sections.push(`## PATTERNS THAT WORKED\n${budgetSlice(lines.join('\n'), budgetTokens.success)}`);
  }

  // CONSTRAINTS + AVOID
  const avoidLines = [];
  for (const e of avoidEntries) {
    avoidLines.push(`- ${e.constraint}${e.reason ? ` (reason: ${e.reason})` : ''}${e.scope !== 'global' ? ` [${e.scope}]` : ''}`);
  }
  for (const r of failMatches.slice(0, 2)) {
    avoidLines.push(`- Approach failed: "${r.task.slice(0, 60)}"${r.correction_note ? ` — correction: ${r.correction_note}` : ''}`);
  }
  if (avoidLines.length > 0) {
    sections.push(`## AVOID\n${budgetSlice(avoidLines.join('\n'), budgetTokens.avoid)}`);
  }

  // SUCCESS CRITERIA
  sections.push(`## SUCCESS CRITERIA\nThe output should be complete, working, and match the existing codebase patterns. No new dependencies unless explicitly requested. State confidence in the approach before implementing.`);

  return sections.join('\n\n');
}

// ── Print confidence UI ────────────────────────────────────────────────────
function printConfidenceUI(conf, successMatches, failMatches, avoidEntries, abstraction) {
  console.log('');
  box('VIA PROMPT ENGINE');
  blank();

  const confStr = conf.level === 'high'   ? G(`High ${conf.emoji}`) :
                  conf.level === 'medium' ? Y(`Medium ${conf.emoji}`) :
                                            R(`Low ${conf.emoji}`);
  row(Si('Confidence'),
    conf.total > 0
      ? `${confStr} ${Gr(`(${conf.total} past tasks, ${conf.rate}% success rate)`)}`
      : Y('New — no past data yet')
  );
  blank();

  if (successMatches.length > 0 || abstraction) {
    console.log('  ' + BAR + '  ' + G('+') + ' ' + Si('Context injected:'));
    if (abstraction) {
      console.log('  ' + BAR + '    ' + Gr(`JIT abstraction: ${abstraction.slice(0, 80)}...`));
    }
    for (const r of successMatches.slice(0, 3)) {
      console.log('  ' + BAR + '    ' + Gr(`+ "${r.task.slice(0, 60)}..." → ${r.outcome}`));
    }
    blank();
  }

  if (avoidEntries.length > 0 || failMatches.length > 0) {
    console.log('  ' + BAR + '  ' + R('-') + ' ' + Si('AVOID injected:'));
    for (const e of avoidEntries) {
      console.log('  ' + BAR + '    ' + Y(`⚠ ${e.constraint.slice(0, 70)} [${e.scope}]`));
    }
    for (const r of failMatches.slice(0, 2)) {
      console.log('  ' + BAR + '    ' + R(`✗ Failed: "${r.task.slice(0, 60)}..."`));
    }
    blank();
  }

  boxEnd();
}

// ── Export helpers ─────────────────────────────────────────────────────────
function exportClaude(records, avoidList, generic) {
  const successRecs  = records.filter(r => r.outcome === 'success').slice(-20);
  const avoidActive  = avoidList.filter(e => e.status !== 'archived');
  const patterns     = generic;

  const lines = [
    '# VIA PROMPT MEMORY',
    '# Auto-generated by `via prompt --export claude`',
    '# This block is injected into every Claude session automatically.',
    '',
    '## CODEBASE MEMORY',
    '',
  ];

  if (successRecs.length > 0) {
    lines.push('### What has worked in this codebase:');
    for (const r of successRecs.slice(-10)) {
      lines.push(`- ${r.task.slice(0, 100)}${r.context_note ? ` → ${r.context_note}` : ''}`);
    }
    lines.push('');
  }

  if (avoidActive.length > 0) {
    lines.push('### AVOID (enforced constraints):');
    for (const e of avoidActive) {
      lines.push(`- ${e.constraint}${e.reason ? ` (${e.reason})` : ''} [scope: ${e.scope}]`);
    }
    lines.push('');
  }

  lines.push('### Task type guidance:');
  for (const [type, pattern] of Object.entries(patterns)) {
    lines.push(`- ${type.toUpperCase()}: ${pattern.template}`);
  }

  return lines.join('\n');
}

function exportYaml(records, avoidList) {
  // Safe YAML with literal block scalars for all text fields
  const successRecs = records.filter(r => r.outcome === 'success').slice(-20);
  const failRecs    = records.filter(r => r.outcome !== 'success').slice(-10);

  const yamlLines = ['# Via Prompt Patterns', '# Auto-generated — do not edit manually', ''];

  yamlLines.push('success_patterns:');
  for (const r of successRecs) {
    yamlLines.push(`  - id: "${r.id}"`);
    yamlLines.push(`    task: |`);
    yamlLines.push(`      ${r.task.replace(/\n/g, '\n      ')}`);
    yamlLines.push(`    type: "${r.task_type || 'general'}"`);
    yamlLines.push(`    timestamp: "${r.timestamp}"`);
    if (r.context_note) {
      yamlLines.push(`    context_note: |`);
      yamlLines.push(`      ${r.context_note.replace(/\n/g, '\n      ')}`);
    }
  }

  yamlLines.push('');
  yamlLines.push('failure_patterns:');
  for (const r of failRecs) {
    yamlLines.push(`  - id: "${r.id}"`);
    yamlLines.push(`    task: |`);
    yamlLines.push(`      ${r.task.replace(/\n/g, '\n      ')}`);
    yamlLines.push(`    outcome: "${r.outcome}"`);
    if (r.correction_note) {
      yamlLines.push(`    correction: |`);
      yamlLines.push(`      ${r.correction_note.replace(/\n/g, '\n      ')}`);
    }
  }

  yamlLines.push('');
  yamlLines.push('avoid_constraints:');
  for (const e of avoidList.filter(e => e.status !== 'archived')) {
    yamlLines.push(`  - constraint: |`);
    yamlLines.push(`      ${e.constraint.replace(/\n/g, '\n      ')}`);
    yamlLines.push(`    scope: "${e.scope}"`);
    if (e.reason) {
      yamlLines.push(`    reason: |`);
      yamlLines.push(`      ${e.reason.replace(/\n/g, '\n      ')}`);
    }
  }

  return yamlLines.join('\n');
}

function exportCodex() {
  return `# Via Prompt Memory — Codex CLI config
# Place in .codex/settings.json or pass via CODEX_SYSTEM_PROMPT

# This is the context block generated by via prompt --export codex
# Source of truth: ~/.via/prompts.json and ~/.via/avoid.json
`;
}

function exportGemini(records, avoidList) {
  // Gemini uses TOML with {{args}} templating
  const avoidActive = avoidList.filter(e => e.status !== 'archived');
  const lines = [
    '# Via Prompt Memory — Gemini CLI config',
    '# Place in ~/.gemini/skills/via-memory.toml',
    '',
    '[skill]',
    'name = "via-memory"',
    'description = "Inject via prompt memory context"',
    '',
    '[template]',
    'content = """',
    'You have access to the following project memory from Via:',
    '',
  ];

  if (avoidActive.length > 0) {
    lines.push('AVOID these patterns:');
    for (const e of avoidActive) {
      lines.push(`- ${e.constraint}`);
    }
    lines.push('');
  }

  const successRecs = records.filter(r => r.outcome === 'success').slice(-10);
  if (successRecs.length > 0) {
    lines.push('Patterns that have worked:');
    for (const r of successRecs) {
      lines.push(`- ${r.task.slice(0, 80)}`);
    }
  }

  lines.push('"""');
  return lines.join('\n');
}

// ── Main command handler ───────────────────────────────────────────────────
export async function run(args) {
  const flags   = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--learn')      { flags.learn = args[++i]; continue; }
    if (a === '--note')       { flags.note  = args[++i]; continue; }
    if (a === '--type')       { flags.type  = args[++i]; continue; }
    if (a === '--avoid')      { flags.avoid = args[++i]; continue; }
    if (a === '--scope')      { flags.scope = args[++i]; continue; }
    if (a === '--reason')     { flags.reason = args[++i]; continue; }
    if (a === '--export')     { flags.export = args[++i]; continue; }
    if (a === '--history')    { flags.history = true; continue; }
    if (a === '--avoid-list') { flags.avoidList = true; continue; }
    if (a === '--help')       { showHelp(); return; }
    if (!a.startsWith('--')) positional.push(a);
  }

  ensureDir();

  // ── via prompt --learn <outcome> ────────────────────────────────────────
  if (flags.learn) {
    const last = loadLast();
    if (!last) { fail('No recent prompt to learn from. Run via prompt <task> first.'); return; }

    const records = loadPrompts();
    const outcome = flags.learn; // success | correction | revert
    const record  = {
      ...last,
      outcome,
      correction_note: flags.note || null,
      learned_at: new Date().toISOString(),
    };

    records.push(record);
    savePrompts(records);

    // If success, promote any ephemeral JIT abstraction to generic patterns
    if (outcome === 'success' && last.jit_abstraction && last.task_type) {
      const generic = loadGeneric();
      const type    = last.task_type;
      if (!generic[type].learned_rules) generic[type].learned_rules = [];
      generic[type].learned_rules.push({
        rule:      last.jit_abstraction,
        task:      last.task,
        timestamp: new Date().toISOString(),
      });
      saveGeneric(generic);
      info(`JIT abstraction promoted to ${type} generic patterns.`);
    }

    // Decay avoid list
    const avoidList = decayAvoid(loadAvoid(), records.length);
    saveAvoid(avoidList);

    ok(`Outcome recorded: ${outcome}${flags.note ? ` — "${flags.note}"` : ''}`);
    info(`Total stored: ${records.length} prompts`);
    return;
  }

  // ── via prompt --avoid "constraint" ────────────────────────────────────
  if (flags.avoid) {
    const avoidList = loadAvoid();
    const entry = {
      id:               createHash('sha256').update(flags.avoid + Date.now()).digest('hex').slice(0, 8),
      constraint:       flags.avoid,
      scope:            flags.scope || 'global',
      reason:           flags.reason || null,
      status:           'active',
      created_at:       new Date().toISOString(),
      last_task_index:  loadPrompts().length,
    };
    avoidList.push(entry);
    saveAvoid(avoidList);
    ok(`AVOID constraint added [${entry.scope}]: "${flags.avoid}"`);
    return;
  }

  // ── via prompt --avoid-list ─────────────────────────────────────────────
  if (flags.avoidList) {
    const avoidList = loadAvoid();
    const active = avoidList.filter(e => e.status !== 'archived');
    if (!active.length) { info('No active AVOID constraints.'); return; }
    box('AVOID CONSTRAINTS');
    for (const e of active) {
      row(Si(`[${e.scope}]`), W(e.constraint.slice(0, 60)));
      if (e.reason) console.log('  ' + BAR + '          ' + Gr(e.reason));
    }
    boxEnd();
    return;
  }

  // ── via prompt --history ────────────────────────────────────────────────
  if (flags.history) {
    const records = loadPrompts();
    if (!records.length) { info('No prompt history yet.'); return; }
    box(`PROMPT HISTORY  ${Gr(`(${records.length} records)`)}`);
    const recent = records.slice(-10).reverse();
    for (const r of recent) {
      const status = r.outcome === 'success' ? G('✓') : r.outcome === 'revert' ? R('✗') : Y('~');
      row(`${status} ${Si(r.task_type || '?')}`, W(r.task.slice(0, 50) + (r.task.length > 50 ? '...' : '')));
      if (r.correction_note) console.log('  ' + BAR + '    ' + Gr(`correction: ${r.correction_note}`));
    }
    boxEnd();
    return;
  }

  // ── via prompt --export <target> ────────────────────────────────────────
  if (flags.export) {
    const records   = loadPrompts();
    const avoidList = loadAvoid();
    const generic   = loadGeneric();
    let content, filename;

    if (flags.export === 'claude') {
      content  = exportClaude(records, avoidList, generic);
      filename = 'CLAUDE.md';
    } else if (flags.export === 'yaml') {
      content  = exportYaml(records, avoidList);
      filename = '.via/prompt-patterns.yaml';
    } else if (flags.export === 'codex') {
      content  = exportCodex();
      filename = '.codex/via-memory.md';
    } else if (flags.export === 'gemini') {
      content  = exportGemini(records, avoidList);
      filename = '.gemini/skills/via-memory.toml';
    } else {
      fail(`Unknown export target: ${flags.export}. Options: claude, yaml, codex, gemini`);
      return;
    }

    writeFileSync(filename.startsWith('.') ? join(process.cwd(), filename) : filename, content, 'utf8');
    ok(`Exported to ${filename}`);
    info(`${records.filter(r => r.outcome === 'success').length} success patterns, ${avoidList.filter(e => e.status !== 'archived').length} AVOID constraints exported.`);
    return;
  }

  // ── via prompt <task> — main flow ────────────────────────────────────────
  const task = positional.join(' ').trim();
  if (!task) { showHelp(); return; }

  info('Assembling historically-informed prompt...');

  const records   = loadPrompts();
  const avoidList = loadAvoid();
  const generic   = loadGeneric();
  const taskType  = flags.type || detectTaskType(task);

  // Retrieve
  const allSuccess = records.filter(r => r.outcome === 'success');
  const allFail    = records.filter(r => r.outcome !== 'success' && r.outcome);

  const successMatches = bm25Retrieve(allSuccess, task, 5);
  const failMatches    = bm25Retrieve(allFail,    task, 3);
  const avoidEntries   = getActiveAvoid(avoidList, task, 400);

  // Confidence
  const conf = computeConfidence(successMatches, failMatches);

  // JIT abstraction (only if LLM available and enough data)
  const providerInfo = await detectProvider();
  let abstraction = null;
  if (providerInfo && successMatches.length >= 3) {
    try {
      abstraction = await jitAbstract(successMatches, task, providerInfo.key, providerInfo.provider);
    } catch { abstraction = null; }
  }

  // Print confidence UI
  printConfidenceUI(conf, successMatches, failMatches, avoidEntries, abstraction);

  // Assemble prompt
  const prompt = await assemblePrompt(task, {
    taskType,
    successMatches,
    failMatches,
    avoidEntries,
    abstraction,
    totalBudgetTokens: 2000,
    generic,
  });

  // Print assembled prompt
  console.log('\n' + '─'.repeat(60));
  console.log(Ic('[Generated Prompt — ready for Claude / Codex / Gemini]'));
  console.log('─'.repeat(60) + '\n');
  console.log(prompt);
  console.log('\n' + '─'.repeat(60));

  // Save as last prompt for --learn
  const record = {
    id:             createHash('sha256').update(task + Date.now()).digest('hex').slice(0, 8),
    task,
    task_type:      taskType,
    assembled:      prompt,
    jit_abstraction: abstraction,
    context_note:   null,
    outcome:        null,
    correction_note: null,
    timestamp:      new Date().toISOString(),
  };
  saveLast(record);

  console.log('\n  ' + Gr('Record outcome with:'));
  console.log('  ' + Sk('via prompt --learn success'));
  console.log('  ' + Sk('via prompt --learn correction --note "what was wrong"'));
  console.log('  ' + Sk('via prompt --learn revert') + '\n');
}

function showHelp() {
  console.log('');
  box('VIA PROMPT — Self-Improving Prompt Engine');
  blank();
  row(Si('Usage'),     Sk('via prompt <task> [flags]'));
  blank();
  console.log('  ' + BAR + '  ' + W('GENERATE'));
  row('  ' + Sk('via prompt "add auth"'),              Gr('Generate memory-enriched prompt'));
  row('  ' + Sk('via prompt "fix bug" --type debug'),  Gr('Force task type detection'));
  blank();
  console.log('  ' + BAR + '  ' + W('FEEDBACK'));
  row('  ' + Sk('via prompt --learn success'),         Gr('Record successful outcome'));
  row('  ' + Sk('via prompt --learn correction'),      Gr('Record with correction note'));
  row('  ' + Sk('via prompt --learn revert'),          Gr('Record full revert'));
  blank();
  console.log('  ' + BAR + '  ' + W('AVOID'));
  row('  ' + Sk('via prompt --avoid "text" --scope global'), Gr('Add AVOID constraint'));
  row('  ' + Sk('via prompt --avoid-list'),            Gr('Show all active constraints'));
  blank();
  console.log('  ' + BAR + '  ' + W('EXPORT'));
  row('  ' + Sk('via prompt --export claude'),         Gr('Write CLAUDE.md block'));
  row('  ' + Sk('via prompt --export yaml'),           Gr('Write .via/prompt-patterns.yaml'));
  row('  ' + Sk('via prompt --export codex'),          Gr('Write .codex/via-memory.md'));
  row('  ' + Sk('via prompt --export gemini'),         Gr('Write Gemini TOML skill'));
  blank();
  console.log('  ' + BAR + '  ' + W('HISTORY'));
  row('  ' + Sk('via prompt --history'),               Gr('Show recent prompts + outcomes'));
  blank();
  console.log('  ' + BAR + '  ' + Gr('LLM auto-detected from env: ANTHROPIC_API_KEY, OPENAI_API_KEY,'));
  console.log('  ' + BAR + '  ' + Gr('GROQ_API_KEY, or local Ollama at localhost:11434'));
  blank();
  console.log('  ' + BAR + '  ' + Gr('Storage upgrades automatically: JSON → SQLite (>500) → VEKTOR'));
  blank();
  boxEnd();
}
