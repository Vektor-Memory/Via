/**
 * commands/diff.mjs — via diff
 */
import { getDb } from '../utils/db.mjs';
import { heading, headingEnd, label, blank, table, green, red, yellow, dim, steel } from '../utils/format.mjs';

async function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS diffs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt     TEXT NOT NULL,
    tool       TEXT NOT NULL,
    response   TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
}

function lastId(db) { return db.prepare(`SELECT MAX(id) as id FROM diffs`).get()?.id ?? 0; }
function wordCount(text) { return text.trim().split(/\s+/).length; }

function similarity(a, b) {
  const wa = new Set(a.toLowerCase().split(/\s+/));
  const wb = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wa].filter(w => wb.has(w)).length;
  return Math.round((intersection / Math.max(wa.size, wb.size)) * 100);
}

// Word-boundary aware wrap
function wrapWords(text, width) {
  const words = text.replace(/\n/g, ' ').split(/\s+/);
  const lines = [];
  let line    = '';
  for (const word of words) {
    if ((line + (line ? ' ' : '') + word).length > width) {
      if (line) lines.push(line);
      line = word.length > width ? word.slice(0, width) : word;
    } else {
      line = line ? line + ' ' + word : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function sideBySide(a, b, width = 42) {
  const aLines = wrapWords(a, width);
  const bLines = wrapWords(b, width);
  const len    = Math.max(aLines.length, bLines.length);
  const out    = [];
  for (let i = 0; i < Math.min(len, 18); i++) {
    const al = (aLines[i] ?? '').padEnd(width);
    const bl = bLines[i] ?? '';
    out.push(`  │  ${al}  ${dim('|')}  ${bl}`);
  }
  if (len > 18) out.push(`  │  ${dim('... ' + (len - 18) + ' more lines')}`);
  return out.join('\n');
}


// ── Live comparison (streaming) ───────────────────────────────────────────────
async function liveCompare(prompt, toolA, toolB, apiKeys) {
  const { default: https } = await import('https');
  const { default: http }  = await import('http');

  console.log('');
  console.log('  ┌─ LIVE COMPARISON ─────────────────────────────────────');
  console.log('  │  Prompt: ' + prompt.slice(0, 60));
  console.log('  │  Tools:  ' + toolA + '  vs  ' + toolB);
  console.log('  └────────────────────────────────────────────────────────');
  console.log('');

  const results = { a: '', b: '' };
  const labels  = { a: toolA.toUpperCase(), b: toolB.toUpperCase() };
  const done    = { a: false, b: false };

  // Stream from Anthropic
  async function streamAnthropic(key, label, slot) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      });
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      }, res => {
        process.stdout.write('\n  [' + label + '] ');
        res.on('data', chunk => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              const text = data.delta?.text || '';
              if (text) { results[slot] += text; process.stdout.write(text); }
            } catch {}
          }
        });
        res.on('end', () => { process.stdout.write('\n'); resolve(); });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // Stream from OpenAI
  async function streamOpenAI(key, label, slot, model = 'gpt-4o-mini') {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model,
        max_tokens: 1024,
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      });
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + key,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      }, res => {
        process.stdout.write('\n  [' + label + '] ');
        res.on('data', chunk => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              const text = data.choices?.[0]?.delta?.content || '';
              if (text) { results[slot] += text; process.stdout.write(text); }
            } catch {}
          }
        });
        res.on('end', () => { process.stdout.write('\n'); resolve(); });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // Run both streams concurrently
  const streamA = toolA === 'claude' && process.env.ANTHROPIC_API_KEY
    ? streamAnthropic(process.env.ANTHROPIC_API_KEY, labels.a, 'a')
    : toolA === 'openai' && process.env.OPENAI_API_KEY
    ? streamOpenAI(process.env.OPENAI_API_KEY, labels.a, 'a')
    : Promise.resolve();

  const streamB = toolB === 'claude' && process.env.ANTHROPIC_API_KEY
    ? streamAnthropic(process.env.ANTHROPIC_API_KEY, labels.b, 'b')
    : toolB === 'openai' && process.env.OPENAI_API_KEY
    ? streamOpenAI(process.env.OPENAI_API_KEY, labels.b, 'b')
    : Promise.resolve();

  await Promise.all([streamA, streamB]);

  // Summary diff
  const aWords = results.a.split(/\s+/).length;
  const bWords = results.b.split(/\s+/).length;

  console.log('');
  console.log('  ┌─ COMPARISON SUMMARY ──────────────────────────────────');
  console.log('  │  [' + labels.a + '] ' + aWords + ' words');
  console.log('  │  [' + labels.b + '] ' + bWords + ' words');
  console.log('  │  Word delta: ' + (aWords - bWords > 0 ? '+' : '') + (aWords - bWords));
  console.log('  └────────────────────────────────────────────────────────');
  console.log('');

  return results;
}

export async function run(args) {
  const db = await getDb('diffs');
  await ensureSchema(db);

  // via diff --live "prompt" --tools claude,openai
  const doLive = args.includes('--live');
  if (doLive) {
    const toolsIdx = args.indexOf('--tools');
    const toolsStr = toolsIdx !== -1 ? args[toolsIdx + 1] : 'claude,openai';
    const [toolA, toolB] = toolsStr.split(',').map(t => t.trim().toLowerCase());
    const promptParts = args.filter(a => !a.startsWith('--') && a !== toolsStr);
    const livePrompt = promptParts.join(' ').trim();
    if (!livePrompt) {
      console.error('  Usage: via diff --live "your prompt" [--tools claude,openai]');
      process.exit(1);
    }
    const results = await liveCompare(livePrompt, toolA || 'claude', toolB || 'openai', {});
    // Save to DB
    const db = await getDb('diff');
    await ensureSchema(db);
    db.prepare(`INSERT INTO diffs (prompt, tool, response) VALUES (?,?,?)`).run(livePrompt, toolA, results.a);
    db.prepare(`INSERT INTO diffs (prompt, tool, response) VALUES (?,?,?)`).run(livePrompt, toolB, results.b);
    return;
  }

  const subcmd = args[0];
  const asJSON = args.includes('--json');

  // add
  if (subcmd === 'add') {
    const tool     = args[1];
    const response = args.slice(2).filter(a => !a.startsWith('--')).join(' ').trim();
    if (!tool || !response) {
      heading('DIFF ADD — USAGE');
      label('via diff add <tool> "<response>"', '');
      label('tools', 'claude | cursor | windsurf | chatgpt');
      headingEnd(); return;
    }
    const pending = db.prepare(
      `SELECT prompt FROM diffs WHERE tool != '_pending' GROUP BY prompt HAVING COUNT(DISTINCT tool) < 2 ORDER BY MAX(created_at) DESC LIMIT 1`
    ).get();
    const pendingPlaceholder = db.prepare(
      `SELECT prompt FROM diffs WHERE tool = '_pending' ORDER BY created_at DESC LIMIT 1`
    ).get();
    const prompt = pending?.prompt ?? pendingPlaceholder?.prompt ?? 'unknown';

    db.prepare(`INSERT INTO diffs (prompt, tool, response) VALUES (?,?,?)`).run(prompt, tool, response);
    const id    = lastId(db);
    const count = db.prepare(`SELECT COUNT(DISTINCT tool) as n FROM diffs WHERE prompt=? AND tool != '_pending'`).get(prompt)?.n ?? 0;

    heading('DIFF STORED');
    label('id',     green('#' + id));
    label('tool',   tool);
    label('prompt', prompt.slice(0, 50));
    label('words',  String(wordCount(response)));
    blank();
    if (count >= 2) console.log('  │  ' + green('Ready to compare. Run: via diff show'));
    else            console.log('  │  ' + dim('Add another tool response to compare.'));
    headingEnd(); return;
  }

  // show
  if (subcmd === 'show' || !subcmd) {
    const promptRow = db.prepare(
      `SELECT prompt FROM diffs WHERE tool != '_pending' GROUP BY prompt HAVING COUNT(DISTINCT tool) >= 2 ORDER BY MAX(created_at) DESC LIMIT 1`
    ).get();

    if (!promptRow) {
      heading('DIFF');
      blank();
      console.log('  │  No comparisons yet.');
      blank();
      console.log('  │  ' + dim('1. Register a prompt:'));
      console.log('  │    ' + steel('via diff "explain microservices"'));
      console.log('  │  ' + dim('2. Add responses:'));
      console.log('  │    ' + steel('via diff add claude "Claude response here"'));
      console.log('  │    ' + steel('via diff add cursor "Cursor response here"'));
      console.log('  │  ' + dim('3. Compare:'));
      console.log('  │    ' + steel('via diff show'));
      blank(); headingEnd(); return;
    }

    const prompt    = promptRow.prompt;
    const responses = db.prepare(`SELECT * FROM diffs WHERE prompt=? AND tool != '_pending' ORDER BY created_at ASC`).all(prompt);
    if (asJSON) { console.log(JSON.stringify({ prompt, responses }, null, 2)); return; }

    const [a, b] = responses;
    const sim    = similarity(a.response, b.response);

    heading('DIFF — ' + prompt.slice(0, 38));
    blank();
    label(a.tool,        dim(wordCount(a.response) + ' words'));
    label(b.tool,        dim(wordCount(b.response) + ' words'));
    label('similarity',  sim + '% word overlap');
    blank();

    const W = 42;
    console.log(`  │  ${green(a.tool.padEnd(W))}  ${dim('|')}  ${yellow(b.tool)}`);
    console.log(`  │  ${'─'.repeat(W)}  ${dim('|')}  ${'─'.repeat(W)}`);
    console.log(sideBySide(a.response, b.response, W));
    blank();

    const wa    = new Set(a.response.toLowerCase().split(/\s+/));
    const wb    = new Set(b.response.toLowerCase().split(/\s+/));
    const onlyA = [...wa].filter(w => !wb.has(w) && w.length > 4).slice(0, 6);
    const onlyB = [...wb].filter(w => !wa.has(w) && w.length > 4).slice(0, 6);
    if (onlyA.length) label(a.tool + ' only', onlyA.join(', '));
    if (onlyB.length) label(b.tool + ' only', onlyB.join(', '));

    headingEnd(); return;
  }

  // list
  if (subcmd === 'list') {
    const prompts = db.prepare(
      `SELECT prompt, COUNT(DISTINCT tool) as tools, GROUP_CONCAT(DISTINCT tool) as tool_list, MAX(created_at) as last
       FROM diffs WHERE tool != '_pending' GROUP BY prompt ORDER BY last DESC LIMIT 20`
    ).all();
    if (asJSON) { console.log(JSON.stringify(prompts, null, 2)); return; }
    if (!prompts.length) {
      heading('DIFFS'); blank(); console.log('  │  No diffs saved.'); blank(); headingEnd(); return;
    }
    heading('DIFFS — SAVED');
    console.log(table(prompts.map(p => ({
      prompt: p.prompt.slice(0, 38),
      tools:  p.tool_list,
      ready:  p.tools >= 2 ? green('yes') : yellow('pending'),
      date:   p.last.slice(0, 10),
    })), ['prompt', 'tools', 'ready', 'date']));
    headingEnd(); return;
  }

  // new prompt
  const prompt = args.filter(a => !a.startsWith('--')).join(' ').trim();
  if (prompt) {
    db.prepare(`INSERT INTO diffs (prompt, tool, response) VALUES (?,?,?)`).run(prompt, '_pending', '');
    heading('DIFF — NEW PROMPT');
    label('prompt', prompt);
    blank();
    console.log('  │  Now add responses from each tool:');
    console.log('  │    ' + steel('via diff add claude "paste Claude response"'));
    console.log('  │    ' + steel('via diff add cursor "paste Cursor response"'));
    console.log('  │    ' + steel('via diff show'));
    headingEnd(); return;
  }

  heading('DIFF — USAGE');
  label('via diff "<prompt>"',          'start a new comparison');
  label('via diff add <tool> "<resp>"', 'store a tool response');
  label('via diff show',                'show last comparison');
  label('via diff list',                'list all saved diffs');
  headingEnd();
}
