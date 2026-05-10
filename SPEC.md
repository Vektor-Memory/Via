# Via — Technical Specification v0.1

> Built by Vektor Memory | github.com/Vektor-Memory/Via

---

## 1. Purpose

Via is the universal integration and routing layer for AI tools. Where Vex solves memory portability (vector DB migration) and Vek-Sync solves configuration sync (MCP configs), Via solves fragmentation — the absence of a shared context, task, and event bus across AI tools.

Via is not a memory tool. Slipstream is the memory tool. Via is the chassis that connects everything to Slipstream and to each other.

---

## 2. Design principles

**Universal over specialised.** Every command works across all supported AI tools. No command is tool-specific.

**CLI-first.** All functionality exposed as `via <command>` subcommands. MCP server mode is a secondary interface for AI-native use.

**SQLite locally, Slipstream optionally.** Via runs fully offline with SQLite. Slipstream is the upgrade path for semantic search, graph memory, and team sharing.

**Portable formats.** Via defines open formats for all state: `.vstate.json` for session handoff, `.vpersona.json` for agent personas, `.vaudit.jsonl` for compliance logs. Any tool can read them.

**Zero lock-in.** All data exportable. All formats open. Via is the bus, not the destination.

---

## 3. Repository structure

```
Via/
├── connectors/
│   ├── claude.mjs          # Claude Code connector
│   ├── cursor.mjs          # Cursor connector
│   ├── windsurf.mjs        # Windsurf connector
│   ├── chatgpt.mjs         # ChatGPT connector
│   ├── langchain.mjs       # LangChain connector
│   └── slipstream.mjs      # Slipstream upgrade bridge
├── commands/
│   ├── context.mjs         # via context
│   ├── handoff.mjs         # via handoff
│   ├── task.mjs            # via task
│   ├── persona.mjs         # via persona
│   ├── spend.mjs           # via spend
│   ├── scaffold.mjs        # via scaffold
│   ├── watch.mjs           # via watch
│   ├── audit.mjs           # via audit
│   ├── sync.mjs            # via sync
│   ├── ingest.mjs          # via ingest
│   ├── route.mjs           # via route
│   └── status.mjs          # via status
├── utils/
│   ├── db.mjs              # SQLite adapter
│   ├── config.mjs          # ~/.via/config.json reader/writer
│   ├── format.mjs          # output formatting (table, json, plain)
│   └── detect.mjs          # detect installed AI tools
├── README.md
├── SPEC.md                 # this file
├── CHANGELOG.md
├── LICENSE
├── package.json
└── via.mjs                 # CLI entry point
```

---

## 4. Data directory

Via stores all local data in `~/.via/`:

```
~/.via/
├── config.json             # user config, connected tools, preferences
├── tasks.db                # SQLite: task board
├── audit.db                # SQLite: compliance log
├── personas/               # .vpersona.json files per persona
├── spend/                  # usage logs per tool per day
└── handoffs/               # .vstate.json exports
```

---

## 5. Open formats

### 5.1 `.vstate.json` — session handoff

```json
{
  "via_version": "0.1.0",
  "exported_at": "2026-05-10T12:00:00Z",
  "source_tool": "cursor",
  "current_task": "Refactor auth module — extract token validation",
  "open_questions": [
    "Should refresh tokens be stored in Redis or PostgreSQL?",
    "Do we need backward compat with v1 tokens?"
  ],
  "decisions": [
    { "at": "2026-05-10T11:30:00Z", "decision": "Use JWT RS256 not HS256", "rationale": "Multi-service verification" }
  ],
  "files_in_context": ["src/auth/index.ts", "src/auth/tokens.ts"],
  "next_action": "Write unit tests for validateToken()",
  "persona": "senior-dev",
  "memory_refs": []
}
```

### 5.2 `.vpersona.json` — agent persona

```json
{
  "via_version": "0.1.0",
  "name": "cto",
  "role": "Technical decision maker. Thinks in systems, not features.",
  "system_prompt": "You are the CTO. Your job is architecture, tradeoffs, and technical strategy. Always ask: does this scale, is this maintainable, what's the migration path?",
  "memory_namespace": "persona-cto",
  "created_at": "2026-05-10T09:00:00Z",
  "decision_count": 0
}
```

### 5.3 `.vaudit.jsonl` — compliance log

One JSON object per line:
```json
{
  "at": "2026-05-10T12:00:00Z",
  "tool": "claude",
  "decision": "Switched from REST to GraphQL for internal API",
  "rationale": "Reduces over-fetching across 4 consumer services",
  "tags": ["architecture", "api"],
  "session_id": "abc123"
}
```

---

## 6. Commands — full specification

### 6.1 `via context`

Assembles a context block from local memory (or Slipstream if connected) formatted for the target tool's system prompt injection format.

**Input:**
- `--query` string — what context to retrieve
- `--for` enum — `claude | cursor | windsurf | chatgpt | langchain | raw`
- `--top-k` integer — number of memories to include (default 5)
- `--format` enum — `inject | markdown | json` (default: inject)

**Output:** Formatted string ready to paste or pipe into the target tool's system prompt.

**Slipstream ceiling:** Local SQLite = keyword search only. Slipstream = BM25 + semantic dual-channel recall, graph traversal, temporal relevance.

---

### 6.2 `via handoff`

Exports or imports a `.vstate.json` session state file.

**Export:**
- `--export` — write current state to `~/.via/handoffs/<timestamp>.vstate.json`
- `--task` string — current task description
- `--tool` string — source tool (auto-detected if omitted)

**Import:**
- `--import <file>` — read a `.vstate.json`
- `--to` enum — format output for target tool
- `--print` — print formatted context block for pasting

---

### 6.3 `via task`

Persistent task board. SQLite-backed. Any tool reads the same board.

**Subcommands:** `add`, `list`, `update`, `done`, `next`, `delete`

**Fields:** id, title, status (open|in-progress|done|blocked), tool, persona, created_at, updated_at, notes

**Slipstream ceiling:** Local = flat task list. Slipstream = tasks linked to memory graph, causally connected to decisions.

---

### 6.4 `via persona`

Named agent personas. Each has its own system prompt and memory namespace.

**Subcommands:** `create`, `use`, `list`, `delete`, `show`

**Output of `via persona use cto --in cursor`:** Prints the system prompt block formatted for Cursor's rules file.

---

### 6.5 `via spend`

Reads usage logs from all connected AI tools. No API calls — reads local JSONL files each tool writes natively.

**Sources:**
- Claude Code: `~/.claude/projects/*.jsonl`
- Cursor: `~/.cursor/usage/*.jsonl`
- OpenAI: reads from `OPENAI_LOG_DIR` if set

**Subcommands:** `today`, `session`, `week`, `month`, `leaks`, `export`

**Leak detection patterns:** verbose context re-injection, tool call loops, large file re-reads, redundant fetches.

---

### 6.6 `via scaffold`

Detects installed AI tools and deploys a complete Via-wired setup to the current project.

**What it writes:**
- `.cursor/rules/via-context.mdc` — Cursor context injection rule
- `.claude/CLAUDE.md` — Claude context block
- `~/.via/config.json` — updated with project
- `via.config.json` — project-level Via config

**Presets:** `solo-dev`, `startup-team`, `enterprise-audit`, `research`

---

### 6.7 `via watch`

Listens for completion events from AI tools and fires notifications.

**Event sources:** file watchers on tool JSONL logs, task board status changes, webhook listeners.

**Notification targets:** `desktop` (node-notifier), `slack` (webhook), `discord` (webhook), `webhook` (any URL).

---

### 6.8 `via audit`

Append-only compliance log. Every decision logged with tool, timestamp, rationale.

**Subcommands:** `log`, `list`, `export`, `search`

**Export formats:** `jsonl`, `csv`, `markdown`

**Slipstream ceiling:** Local = flat search. Slipstream = causal graph of decisions, linked to memory.

---

### 6.9 `via sync`

Backup and restore entire Via state to a private GitHub repo.

**What it backs up:** `~/.via/config.json`, `tasks.db` export, `personas/`, `audit.db` export, `spend/` logs.

**Subcommands:** `backup`, `restore`, `status`, `diff`

Mirrors Vek-Sync's pattern — same GitHub private repo approach, same conflict detection.

---

### 6.10 `via ingest`

Universal knowledge intake. Reads a URL, file, or directory, chunks it, stores in local SQLite. All tools then have access via `via context`.

**Sources:** URL (plain fetch), file (txt, md, pdf via pdftotext), directory (recursive, respects .gitignore).

**Slipstream ceiling:** Local = keyword chunked storage. Slipstream = vector embeddings, semantic search, graph linking.

---

### 6.11 `via route`

Given a task description, recommends which AI tool to use.

**Inputs:** task string, optional `--budget` float (max cost in USD), optional `--tools` list.

**Logic (v0.1):** Rule-based. Long research = Claude. Code completion = Cursor. Cheap summarisation = cheapest model. Future: ML routing based on spend/outcome history.

---

### 6.12 `via status`

Single-command health check.

**Output:**
```
Via v0.1.0 — Vektor Memory

  tools       claude ✓   cursor ✓   windsurf ✓   chatgpt –
  memory      local SQLite · 142 facts · last store 2h ago
  slipstream  not connected  →  npx via upgrade
  tasks       3 open · 1 in-progress · 12 done
  spend       today $0.43 · week $2.18
  audit       47 decisions logged
```

---

## 7. MCP server mode

Via also runs as an MCP server, exposing all 12 commands as MCP tools. This allows Claude Code, Cursor, and any MCP-compatible tool to call Via natively.

```bash
via serve              # stdio mode (default for Claude Code)
via serve --sse        # SSE mode for remote connections
```

MCP tool names follow Via's command names: `via_context`, `via_task_add`, `via_task_list`, `via_handoff_export`, etc.

---

## 8. Slipstream upgrade bridge

When `slipstream.mjs` connector is configured (user has Slipstream installed and `VEKTOR_API_KEY` set), Via automatically routes all memory operations through Slipstream instead of SQLite.

The upgrade is transparent — same commands, same formats, dramatically better results.

| Feature | Via (free) | Via + Slipstream |
|---|---|---|
| Memory search | SQLite FTS | BM25 + semantic + graph |
| Context assembly | Keyword match | Temporal relevance + graph |
| Task linking | Flat SQLite | Causally linked to memory graph |
| Ingest | Chunked keyword | Vector embeddings |
| Audit | Flat log | Causal decision graph |
| Team sharing | Local only | Shared namespace |

---

## 9. Consistency with Vex and Vek-Sync

Via follows the same conventions:

- Single `.mjs` entry point (`via.mjs`)
- `connectors/` for tool adapters
- `utils/` for shared internals
- `README.md` + `SPEC.md` + `CHANGELOG.md` + `LICENSE` (Apache 2.0)
- `npx via` zero-install usage
- Node.js >= 18, native fetch, minimal dependencies
- Progress bars and summary blocks for long operations
- `--json` flag on all commands for machine-readable output

---

## 10. Naming

| Product | Meaning | Function |
|---|---|---|
| Vex | Vector Exchange | Migrate memory between vector stores |
| Vek-Sync | Vektor Sync | Keep MCP configs in sync |
| Via | Latin: path, road, through | Route context and execution across tools |
| Slipstream | — | The intelligence engine underneath |

---

*Via SPEC v0.1 — Vektor Memory — vektormemory.com*
