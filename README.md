# Via — by Vektor Memory

> Route anything. Remember everything. Works everywhere.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/badge/npx-via-black)](https://npmjs.com/package/via)

Via is the universal integration layer for AI tools. It connects Claude, Cursor, Windsurf, ChatGPT, LangChain, and every other AI tool to a shared context, task, and memory bus — so your work follows you across every tool, every session, every machine.

Part of the Vektor ecosystem alongside [Vex](https://github.com/Vektor-Memory/Vex) and [Vek-Sync](https://github.com/Vektor-Memory/Vek-Sync).

---

## The problem

Every AI tool remembers inside its own walls. Claude forgets what you did in Cursor. Cursor forgets what you built in Windsurf. The moment you switch tools — or open a new session — context starts from zero. There is no bus between them.

Via is that bus.

---

## Install

```bash
npm install -g via
# or run without installing
npx via --help
```

**Requirements:** Node.js >= 18. Zero runtime dependencies for core commands.

---

## Commands

### `via context`
Inject the right memory into any AI tool's system prompt.
```bash
via context --query "current project" --for cursor
via context --query "what am I building" --for claude
via context --query "open decisions" --for chatgpt
```

### `via handoff`
Transfer your full working state between tools.
```bash
via handoff --export                        # save current state to .vstate.json
via handoff --import .vstate.json --to cursor
```

### `via task`
Shared persistent task board any AI tool can read and write.
```bash
via task add "refactor auth module"
via task list
via task update <id> --status done
via task next                               # what should the next AI pick up
```

### `via persona`
Named agent personas with role memory and system prompts.
```bash
via persona create cto --role "technical decision maker"
via persona use cto --in cursor
via persona list
```

### `via spend`
Unified token and cost tracking across all AI tools.
```bash
via spend today
via spend session
via spend leaks                             # detect wasteful patterns
via spend export --format csv
```

### `via scaffold`
Deploy a complete AI working setup to any project in one command.
```bash
via scaffold init                           # detect installed tools, wire everything
via scaffold --preset solo-dev
via scaffold --preset startup-team
via scaffold --preset enterprise-audit
```

### `via watch`
Event routing when any AI tool completes a task.
```bash
via watch --on task-complete --notify desktop
via watch --on task-complete --webhook https://hooks.slack.com/...
via watch --on session-end --notify discord
```

### `via audit`
Compliance memory. Log every significant AI decision.
```bash
via audit log "decided to use PostgreSQL over MySQL"
via audit list --last 7d
via audit export --format jsonl
```

### `via sync`
Backup and restore your entire AI setup across machines.
```bash
via sync backup --to github
via sync restore --from github
via sync status
```

### `via ingest`
Universal knowledge intake. Point at anything.
```bash
via ingest https://docs.example.com
via ingest ./architecture.md
via ingest ./src/                           # whole directory
```

### `via route`
Which AI tool should handle this task?
```bash
via route "write unit tests for auth module"
via route "research competitor pricing"
via route "refactor this file" --budget 0.10
```

### `via status`
Full ecosystem health in one command.
```bash
via status
# → tools connected, memory live, token spend today, open tasks
```

---

## Connectors

| Tool | context | handoff | task | spend | status |
|---|---|---|---|---|---|
| Claude Code | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cursor | ✅ | ✅ | ✅ | ✅ | ✅ |
| Windsurf | ✅ | 🔜 | ✅ | ✅ | ✅ |
| ChatGPT | ✅ | 🔜 | 🔜 | ✅ | 🔜 |
| LangChain | ✅ | ✅ | ✅ | 🔜 | 🔜 |
| Slipstream | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## Vektor ecosystem

| Tool | What it does |
|---|---|
| [Vex](https://github.com/Vektor-Memory/Vex) | Migrate agent memory between vector stores |
| [Vek-Sync](https://github.com/Vektor-Memory/Vek-Sync) | Keep MCP configs in sync across AI editors |
| **Via** | Route context and execution across all AI tools |
| [Slipstream](https://vektormemory.com) | The intelligence engine underneath — graph memory, vector search, stealth fetch, multimodal |

Via uses SQLite locally. When you need semantic search, graph traversal, temporal memory, or team-shared context — upgrade to [Vektor Slipstream](https://vektormemory.com).

---

## Roadmap

**v0.1 — core**
- `via context`, `via task`, `via status`
- Claude Code + Cursor connectors
- SQLite local store

**v0.2 — execution**
- `via handoff`, `via persona`, `via watch`
- Windsurf + LangChain connectors
- `.vstate.json` spec v1.0

**v0.3 — intelligence**
- `via spend`, `via audit`, `via ingest`
- ChatGPT connector
- Slipstream upgrade bridge

**v0.4 — teams**
- `via scaffold`, `via route`, `via sync`
- Team-shared task board
- Enterprise audit export

---

## License

Apache 2.0 — free forever. Built by [Vektor Memory](https://vektormemory.com).
