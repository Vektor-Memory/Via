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

export async function run(args) {
  const db = await getDb('diffs');
  await ensureSchema(db);

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
