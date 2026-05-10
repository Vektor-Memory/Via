/**
 * commands/serve.mjs — via serve
 * Runs Via as an MCP server over stdio (or --sse for HTTP+SSE).
 * Exposes via_task, via_context, via_audit, via_persona, via_handoff as MCP tools.
 *
 * Usage:
 *   via serve                    # stdio (for Claude Desktop, Cursor, Windsurf)
 *   via serve --sse --port 3456  # HTTP+SSE mode
 *
 * Claude Desktop config:
 *   {
 *     "mcpServers": {
 *       "via": { "command": "via", "args": ["serve"] }
 *     }
 *   }
 */

import { createServer } from 'http';
import { getDb }        from '../utils/db.mjs';
import { readConfig, hasSlipstream } from '../utils/config.mjs';

const VERSION = '0.1.0';

// ── Tool definitions ────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'via_task_list',
    description: 'List open tasks from the Via shared task board.',
    inputSchema: {
      type: 'object',
      properties: {
        all: { type: 'boolean', description: 'Include completed tasks' },
      },
    },
  },
  {
    name: 'via_task_add',
    description: 'Add a task to the Via shared task board.',
    inputSchema: {
      type: 'object',
      properties: {
        title:    { type: 'string',  description: 'Task title' },
        priority: { type: 'string',  description: 'low | normal | high', default: 'normal' },
        tags:     { type: 'string',  description: 'Comma-separated tags' },
      },
      required: ['title'],
    },
  },
  {
    name: 'via_task_done',
    description: 'Mark a Via task as done.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Task ID' } },
      required: ['id'],
    },
  },
  {
    name: 'via_audit_log',
    description: 'Log an AI decision to the Via compliance audit trail.',
    inputSchema: {
      type: 'object',
      properties: {
        decision:  { type: 'string', description: 'What was decided' },
        rationale: { type: 'string', description: 'Why' },
        tool:      { type: 'string', description: 'Which AI tool made the decision' },
      },
      required: ['decision'],
    },
  },
  {
    name: 'via_context',
    description: 'Pull memory context formatted for an AI tool.',
    inputSchema: {
      type: 'object',
      properties: {
        query:  { type: 'string', description: 'Topic to recall' },
        target: { type: 'string', description: 'claude | cursor | windsurf | chatgpt | raw' },
      },
      required: ['query'],
    },
  },
  {
    name: 'via_status',
    description: 'Get Via ecosystem health: tools connected, task counts, spend, audit totals.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ── Tool handlers ────────────────────────────────────────────────────────────
async function handle(name, input) {
  const db = (n) => getDb(n);

  if (name === 'via_task_list') {
    const d     = await db('tasks');
    d.exec(`CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT DEFAULT 'open', priority TEXT DEFAULT 'normal', tags TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
    const where = input.all ? '' : `WHERE status != 'done'`;
    const rows  = d.prepare(`SELECT * FROM tasks ${where} ORDER BY updated_at DESC`).all();
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  }

  if (name === 'via_task_add') {
    const d = await db('tasks');
    d.exec(`CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT DEFAULT 'open', priority TEXT DEFAULT 'normal', tags TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
    const r = d.prepare(`INSERT INTO tasks (title, priority, tags) VALUES (?,?,?)`).run(input.title, input.priority ?? 'normal', input.tags ?? '');
    return { content: [{ type: 'text', text: `Task #${r.lastInsertRowid} added: ${input.title}` }] };
  }

  if (name === 'via_task_done') {
    const d = await db('tasks');
    d.prepare(`UPDATE tasks SET status='done', updated_at=datetime('now') WHERE id=?`).run(input.id);
    return { content: [{ type: 'text', text: `Task #${input.id} marked done.` }] };
  }

  if (name === 'via_audit_log') {
    const d = await db('audit');
    d.exec(`CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, decision TEXT NOT NULL, rationale TEXT DEFAULT '', tool TEXT DEFAULT 'unknown', model TEXT DEFAULT '', tags TEXT DEFAULT '', logged_at TEXT DEFAULT (datetime('now')))`);
    const r = d.prepare(`INSERT INTO audit (decision, rationale, tool) VALUES (?,?,?)`).run(input.decision, input.rationale ?? '', input.tool ?? 'unknown');
    return { content: [{ type: 'text', text: `Decision #${r.lastInsertRowid} logged.` }] };
  }

  if (name === 'via_context') {
    const target = (input.target ?? 'raw').toLowerCase();
    const FORMATS = {
      claude:   (b) => `<memory>\n${b}\n</memory>`,
      cursor:   (b) => b.split('\n').map(l => `// ${l}`).join('\n'),
      windsurf: (b) => `<!-- CONTEXT\n${b}\n-->`,
      chatgpt:  (b) => `[MEMORY CONTEXT]\n${b}\n[END CONTEXT]`,
      raw:      (b) => b,
    };
    let recall = '';
    try {
      const d = await db('memory');
      const rows = d.prepare(`SELECT content FROM memory WHERE content LIKE ? ORDER BY id DESC LIMIT 10`).all(`%${input.query}%`);
      recall = rows.map(r => r.content).join('\n\n');
    } catch {}
    const block = recall || `No memory found for: "${input.query}"\nRun 'via ingest' to add knowledge.`;
    const fmt   = (FORMATS[target] ?? FORMATS.raw)(block);
    return { content: [{ type: 'text', text: fmt }] };
  }

  if (name === 'via_status') {
    const count = async (dbName, sql) => {
      try { const d = await db(dbName); return d.prepare(sql).get()?.n ?? 0; } catch { return 0; }
    };
    const [open, done, spend, audit] = await Promise.all([
      count('tasks', `SELECT COUNT(*) as n FROM tasks WHERE status='open'`),
      count('tasks', `SELECT COUNT(*) as n FROM tasks WHERE status='done'`),
      count('spend', `SELECT ROUND(SUM(cost_usd),4) as n FROM spend WHERE date(logged_at)=date('now')`),
      count('audit', `SELECT COUNT(*) as n FROM audit`),
    ]);
    return { content: [{ type: 'text', text: JSON.stringify({ tasks_open: open, tasks_done: done, spend_today: spend, audit_decisions: audit, slipstream: hasSlipstream() }, null, 2) }] };
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
}

// ── MCP stdio transport ──────────────────────────────────────────────────────
function sendStdio(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function runStdio() {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
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
  process.stderr.write(`[via] MCP stdio server ready (v${VERSION})\n`);
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    sendStdio({ jsonrpc: '2.0', id, result: {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'via', version: VERSION },
      capabilities: { tools: {} },
    }});
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    sendStdio({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: input = {} } = params;
    try {
      const result = await handle(name, input);
      sendStdio({ jsonrpc: '2.0', id, result });
    } catch (err) {
      sendStdio({ jsonrpc: '2.0', id, result: {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      }});
    }
    return;
  }

  // Unknown method
  sendStdio({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
}

// ── HTTP+SSE transport ───────────────────────────────────────────────────────
async function runSSE(port) {
  const clients = new Set();

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    if (url.pathname === '/sse') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(`data: ${JSON.stringify({ type: 'connected', server: 'via', version: VERSION })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (url.pathname === '/message' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', async () => {
        const msg = JSON.parse(body);
        const { id, method, params } = msg;
        let result;
        if (method === 'tools/list')  result = { tools: TOOLS };
        else if (method === 'tools/call') result = await handle(params.name, params.arguments ?? {});
        else result = { error: 'unknown method' };
        const payload = JSON.stringify({ jsonrpc: '2.0', id, result });
        // SSE broadcast removed: POST response already returns payload directly
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(payload);
      });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ server: 'via', version: VERSION, tools: TOOLS.length }));
  });

  server.listen(port, () => {
    process.stderr.write(`[via] MCP SSE server → http://localhost:${port}/sse\n`);
  });
}

// ── Entry ────────────────────────────────────────────────────────────────────
export async function run(args) {
  const sse  = args.includes('--sse');
  const port = parseInt(args[args.indexOf('--port') + 1] ?? '3456') || 3456;

  if (sse) {
    await runSSE(port);
  } else {
    await runStdio();
  }
}

