/**
 * commands/serve.mjs — via serve
 * MCP server — stdio or --sse.
 * Tools: task, memory, log, context, status
 */
import { createServer } from 'http';
import { getDb }        from '../utils/db.mjs';
import { readConfig, hasSlipstream } from '../utils/config.mjs';

const VERSION = '0.2.0';

// ── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'via_task_list',
    description: 'List tasks from the Via shared task board.',
    inputSchema: { type: 'object', properties: { all: { type: 'boolean', description: 'Include completed tasks' } } },
  },
  {
    name: 'via_task_add',
    description: 'Add a task to the Via shared task board.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, priority: { type: 'string', default: 'normal' }, tags: { type: 'string' } }, required: ['title'] },
  },
  {
    name: 'via_task_done',
    description: 'Mark a Via task as done.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
  },
  {
    name: 'via_memory_add',
    description: 'Store a fact in Via memory.',
    inputSchema: { type: 'object', properties: { content: { type: 'string', description: 'The fact to store' }, tags: { type: 'string', description: 'Comma-separated tags' } }, required: ['content'] },
  },
  {
    name: 'via_memory_search',
    description: 'Search stored facts in Via memory.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search term' }, limit: { type: 'number', default: 10 } }, required: ['query'] },
  },
  {
    name: 'via_log',
    description: 'Log a decision, event, or activity to the Via log.',
    inputSchema: { type: 'object', properties: { entry: { type: 'string', description: 'What happened or was decided' }, tool: { type: 'string', description: 'Which AI tool' }, cost_usd: { type: 'number' }, tokens: { type: 'number' } }, required: ['entry'] },
  },
  {
    name: 'via_context',
    description: 'Pull memory context formatted for an AI tool.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, target: { type: 'string', description: 'claude | cursor | windsurf | raw' } }, required: ['query'] },
  },
  {
    name: 'via_status',
    description: 'Get Via ecosystem health: tools, memory, tasks, log.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────────
async function handle(name, input) {
  const db = (n) => getDb(n);

  // ── tasks ──
  if (name === 'via_task_list') {
    const d = await db('tasks');
    d.exec(`CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT DEFAULT 'open', priority TEXT DEFAULT 'normal', tags TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
    const where = input.all ? '' : `WHERE status != 'done'`;
    const rows  = d.prepare(`SELECT * FROM tasks ${where} ORDER BY updated_at DESC`).all();
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  }

  if (name === 'via_task_add') {
    const d = await db('tasks');
    d.exec(`CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT DEFAULT 'open', priority TEXT DEFAULT 'normal', tags TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
    d.prepare(`INSERT INTO tasks (title, priority, tags) VALUES (?,?,?)`).run(input.title, input.priority ?? 'normal', input.tags ?? '');
    const id = d.prepare(`SELECT MAX(id) as id FROM tasks`).get()?.id ?? 0;
    return { content: [{ type: 'text', text: `Task #${id} added: ${input.title}` }] };
  }

  if (name === 'via_task_done') {
    const d = await db('tasks');
    d.prepare(`UPDATE tasks SET status='done', updated_at=datetime('now') WHERE id=?`).run(input.id);
    return { content: [{ type: 'text', text: `Task #${input.id} marked done.` }] };
  }

  // ── memory ──
  if (name === 'via_memory_add') {
    const d = await db('memory');
    d.exec(`CREATE TABLE IF NOT EXISTS memory (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, source TEXT DEFAULT 'mcp', tags TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`);
    try { d.exec(`ALTER TABLE memory ADD COLUMN source TEXT DEFAULT 'mcp'`); } catch {}
    try { d.exec(`ALTER TABLE memory ADD COLUMN tags TEXT DEFAULT ''`); } catch {}
    d.prepare(`INSERT INTO memory (content, source, tags) VALUES (?,?,?)`).run(input.content, 'mcp', input.tags ?? '');
    const id = d.prepare(`SELECT MAX(id) as id FROM memory`).get()?.id ?? 0;
    return { content: [{ type: 'text', text: `Memory #${id} stored: ${input.content.slice(0, 60)}` }] };
  }

  if (name === 'via_memory_search') {
    const d     = await db('memory');
    d.exec(`CREATE TABLE IF NOT EXISTS memory (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, source TEXT DEFAULT 'mcp', tags TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`);
    try { d.exec(`ALTER TABLE memory ADD COLUMN source TEXT DEFAULT 'mcp'`); } catch {}
    const limit = input.limit ?? 10;
    const rows  = d.prepare(`SELECT id, content, source, created_at FROM memory WHERE content LIKE ? ORDER BY id DESC LIMIT ?`).all(`%${input.query}%`, limit);
    if (!rows.length) return { content: [{ type: 'text', text: `No memory found for: "${input.query}"` }] };
    const text = rows.map(r => `[#${r.id}] ${r.content}`).join('\n\n');
    return { content: [{ type: 'text', text }] };
  }

  // ── log ──
  if (name === 'via_log') {
    const d = await db('log');
    d.exec(`CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, entry TEXT NOT NULL, tool TEXT DEFAULT 'unknown', cost_usd REAL DEFAULT 0, tokens INTEGER DEFAULT 0, type TEXT DEFAULT 'mcp', logged_at TEXT DEFAULT (datetime('now')))`);
    d.prepare(`INSERT INTO log (entry, tool, cost_usd, tokens, type) VALUES (?,?,?,?,?)`).run(input.entry, input.tool ?? 'unknown', input.cost_usd ?? 0, input.tokens ?? 0, 'mcp');
    const id = d.prepare(`SELECT MAX(id) as id FROM log`).get()?.id ?? 0;
    return { content: [{ type: 'text', text: `Log #${id}: ${input.entry}` }] };
  }

  // ── context ──
  if (name === 'via_context') {
    const target = (input.target ?? 'raw').toLowerCase();
    const FORMATS = {
      claude:   b => `<memory>\n${b}\n</memory>`,
      cursor:   b => b.split('\n').map(l => `// ${l}`).join('\n'),
      windsurf: b => `<!-- CONTEXT\n${b}\n-->`,
      raw:      b => b,
    };
    let recall = '';
    try {
      const d    = await db('memory');
      const rows = d.prepare(`SELECT content FROM memory WHERE content LIKE ? ORDER BY id DESC LIMIT 10`).all(`%${input.query}%`);
      recall     = rows.map(r => r.content).join('\n\n');
    } catch {}
    const block = recall || `No memory found for: "${input.query}". Use via_memory_add to store facts.`;
    const fmt   = (FORMATS[target] ?? FORMATS.raw)(block);
    return { content: [{ type: 'text', text: fmt }] };
  }

  // ── status ──
  if (name === 'via_status') {
    const count = async (dbName, sql) => { try { const d = await db(dbName); return d.prepare(sql).get()?.n ?? 0; } catch { return 0; } };
    const [tasksOpen, tasksDone, memTotal, logTotal] = await Promise.all([
      count('tasks',  `SELECT COUNT(*) as n FROM tasks WHERE status='open'`),
      count('tasks',  `SELECT COUNT(*) as n FROM tasks WHERE status='done'`),
      count('memory', `SELECT COUNT(*) as n FROM memory`),
      count('log',    `SELECT COUNT(*) as n FROM log`),
    ]);
    return { content: [{ type: 'text', text: JSON.stringify({ tasks_open: tasksOpen, tasks_done: tasksDone, memory_facts: memTotal, log_entries: logTotal, slipstream: hasSlipstream() }, null, 2) }] };
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
}

// ── stdio ────────────────────────────────────────────────────────────────────
function sendStdio(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

async function handleMessage(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    sendStdio({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'via', version: VERSION }, capabilities: { tools: {} } } });
    return;
  }
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') { sendStdio({ jsonrpc: '2.0', id, result: { tools: TOOLS } }); return; }
  if (method === 'tools/call') {
    const { name, arguments: input = {} } = params;
    try {
      const result = await handle(name, input);
      sendStdio({ jsonrpc: '2.0', id, result });
    } catch (err) {
      sendStdio({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true } });
    }
    return;
  }
  sendStdio({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
}

async function runStdio() {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async chunk => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      await handleMessage(msg);
    }
  });
  process.stderr.write(`[via] MCP server v${VERSION} ready — ${TOOLS.length} tools\n`);
}

// ── SSE ──────────────────────────────────────────────────────────────────────
async function runSSE(port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/sse') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write(`data: ${JSON.stringify({ type: 'connected', server: 'via', version: VERSION })}\n\n`);
      req.on('close', () => {});
      return;
    }
    if (url.pathname === '/message' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', async () => {
        const msg = JSON.parse(body);
        let result;
        if (msg.method === 'tools/list') result = { tools: TOOLS };
        else if (msg.method === 'tools/call') result = await handle(msg.params.name, msg.params.arguments ?? {});
        else result = { error: 'unknown method' };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ server: 'via', version: VERSION, tools: TOOLS.length }));
  });
  server.listen(port, () => process.stderr.write(`[via] MCP SSE server → http://localhost:${port}/sse\n`));
}

export async function run(args) {
  const sse  = args.includes('--sse');
  const port = parseInt(args[args.indexOf('--port') + 1] ?? '3456') || 3456;
  if (sse) await runSSE(port);
  else     await runStdio();
}
