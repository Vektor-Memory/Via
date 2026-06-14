# Via — by Vektor Memory - v0.4.2

> Route anything. Remember everything. Works everywhere.
>
<img width="926" height="458" alt="image" src="https://github.com/user-attachments/assets/297b1e7f-0940-42c3-9808-81bd01698414" />



[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@vektormemory/via)](https://npmjs.com/package/@vektormemory/via)

Via is the universal integration layer for AI tools. One CLI that connects Claude, Cursor, Windsurf, and ChatGPT to a shared memory, task board, and context bus — so your work follows you across every tool, every session, every machine.

Part of the Vektor ecosystem alongside [Vex](https://github.com/Vektor-Memory/Vex) and [Slipstream](https://vektormemory.com).

---

## The problem

Every AI tool remembers inside its own walls. Claude forgets what you did in Cursor. Cursor forgets what you built in Windsurf. The moment you switch tools — or open a new session — context resets to zero.

Via is the bus between them.

---

## Install

```bash
npm install -g @vektormemory/via
via --help
```

**Requirements:** Node.js >= 18. No native dependencies.

---

## What makes Via different

### `via diff` — Compare AI tools side by side

The feature no other tool has. Ask the same question to Claude and Cursor, then see exactly where they agree, diverge, and what unique concepts each one brought.

```bash
via diff "explain microservices"
via diff add claude "Microservices split apps into small independent services..."
via diff add cursor "Microservices are small focused services that communicate via APIs..."
via diff show
```

```
┌─ DIFF — explain microservices ────────────────
│ claude          12 words
│ cursor          14 words
│ similarity      21% word overlap
│
│  claude                          |  cursor
│  ──────────────────────────────  |  ──────────────────────────────
│  Microservices split apps into   |  Microservices are small focused
│  small independent services...   |  services that communicate via...
│
│ claude unique terms  independent, database
│ cursor unique terms  focused, communicate, deployed
└───────────────────────────────────────────────
```

### `via memory` — Relationship-aware code indexing

Point at any folder and Via extracts symbols, imports, and function definitions from 10+ languages — then builds an import graph in SQLite. Search traverses relationships, not just text.

```bash
via memory add --file ./src/
# → extracts symbols + import edges from JS/TS/Python/Go/Rust
# → via memory search "auth" returns auth.js + every file that imports it
```

```
┌─ MEMORY — SEARCH: auth ───────────────────────
│
│  Direct matches (2 files)
│    ● auth.js       ./src/auth.js
│    ● config.js     ./src/config.js
│
│  Related via imports (3 files)
│    ○ server.js     ./src/server.js
│    ○ middleware.js ./src/middleware.js
│    ○ routes.js     ./src/routes/auth.js
└───────────────────────────────────────────────
```

No embeddings. No API calls. Pure local SQLite graph.

### `via convert` — Local file conversion pipeline

Convert any file locally — audio, video, images, documents, archives — powered by FFmpeg, ImageMagick, Pandoc, and LibreOffice. Nothing uploaded anywhere. Pipe output directly into via memory with `--ingest`.

```bash
via convert ./report.pdf --to md                  # pdf → markdown
via convert ./recording.mp3 --to txt              # audio → transcript
via convert ./video.mp4 --to gif                  # video → gif
via convert ./doc.docx --to pdf                   # office → pdf
via convert ./report.pdf --to md --ingest         # convert + store in memory
via convert --check                               # check installed tools
via convert --formats                             # all supported formats
```

```
┌─ CONVERT — TOOL CHECK ────────────────────────
│ FFmpeg          installed  audio/video
│ ImageMagick     installed  images
│ Pandoc          installed  documents
│ LibreOffice     installed  office docs
│ Poppler         installed  pdf→txt
│ Zip             installed  archives
│ 7-Zip           installed  7z archives
└───────────────────────────────────────────────
```

---

## Commands

### `via init`
Wire via into every AI tool detected — one command, fully configured.
```bash
via init           # writes MCP config for Claude Desktop, Cursor, Windsurf
via init --dry-run # preview what would be written
```

### `via memory`
Fact storage + relationship-aware codebase indexing.
```bash
via memory add "JWT tokens expire in 1h"          # store a fact
via memory add --file ./src/                      # index a codebase
via memory search "auth"                          # search + related files
via memory graph                                  # show import relationships
via memory list                                   # list indexed files + facts
```

### `via convert`
Local file conversion. No uploads. Optional memory pipeline.
```bash
via convert <file> --to <format>                  # convert a file
via convert <file> --to md --ingest               # convert + store in memory
via convert --check                               # check installed tools
via convert --formats                             # show all supported formats
```

Supported formats:

```
Images     png jpg webp gif bmp tiff ico svg  →  png jpg webp gif bmp tiff ico pdf
Audio      mp3 wav ogg m4a aac flac aiff wma  →  mp3 wav ogg m4a aac flac aiff
Video      mp4 mkv mov avi webm flv wmv       →  mp4 mkv mov avi webm gif mp3
Documents  md rst html txt tex org epub       →  md html txt pdf epub docx odt
Office     docx doc odt rtf xlsx pptx         →  pdf txt html odt docx
PDF        pdf                                →  txt md html docx
Archives   any file or folder                 →  zip tar.gz 7z
```

External tools required: FFmpeg, ImageMagick, Pandoc, LibreOffice, Poppler, 7-Zip.

### `via task`
Shared persistent task board any AI tool can read and write via MCP.
```bash
via task add "refactor auth module" --high
via task
via task done <id>
via task start <id>
```

### `via log`
Unified activity log. Auto-captures Claude Code sessions.
```bash
via log "decided to use postgres" --tool claude
via log --scan     # one-shot capture of all Claude Code sessions
via log --watch    # live capture as sessions complete
via log --today
via log search "postgres"
```

### `via ask`
Route a question to the right AI tool — and open it.
```bash
via ask "should I use postgres or sqlite?"        # opens recommended tool
via ask "refactor auth module" --tool cursor      # force a specific tool
via ask "explain this architecture" --no-open     # recommend only
```

### `via diff`
Compare what two AI tools said about the same prompt.
```bash
via diff "your prompt"          # register a new prompt
via diff add claude "..."       # store Claude's response
via diff add cursor "..."       # store Cursor's response
via diff show                   # side-by-side + unique terms
via diff list                   # all saved comparisons
```

### `via handoff`
Export your full working state before switching tools.
```bash
via handoff --export                        # saves .vstate.json
via handoff --import ./sprint3.vstate.json  # restore on any machine
via handoff --list
```

### `via serve`
Run Via as an MCP server. Claude Desktop, Cursor, and Windsurf can call via tools natively.
```bash
via serve           # stdio (Claude Desktop, Cursor)
via serve --sse     # HTTP+SSE mode
```

Claude Desktop config:
```json
{
  "mcpServers": {
    "via": { "command": "via", "args": ["serve"] }
  }
}
```

Or just run `via init` — it writes this automatically.

---

## MCP Tools (via serve)

When running as an MCP server, Claude Desktop and Cursor can call:

```
via_task_list      List open tasks
via_task_add       Add a task
via_task_done      Mark task done
via_memory_add     Store a fact
via_memory_search  Search stored facts (relationship-aware)
via_log            Log a decision or event
via_context        Pull formatted memory context
via_status         Ecosystem health check
```

---

## Vektor ecosystem

```
Via          Route context and execution across all AI tools
Vex          Migrate agent memory between vector stores
Slipstream   Graph memory, vector search, multimodal
```

Via uses SQLite locally. No embeddings, no API calls for indexing. When you need semantic search, graph traversal, or team-shared context — upgrade to [Vektor Slipstream](https://vektormemory.com).

---

## Roadmap

**v0.4 - current**
- `via prompt` - self-improving historically-informed prompt engine (BM25, AVOID store, JIT abstraction, confidence UI)
- `via memory` semantic search - BM25 + VEKTOR hybrid fusion, sync, stats
- Team-shared task board - kanban view, assign, share via Git JSON
- `via diff --live` - real-time streaming side-by-side comparison
- `via convert --batch` - recursive folder conversion with progress bar
- Git hook integration - implicit prompt feedback capture on commit/revert
- Export to CLAUDE.md, YAML, Codex, Gemini TOML

**v0.5 - coming**
- `via prompt` workflow evolution - improve task sequences not just single prompts
- `via memory` multimodal ingestion - images, PDFs, audio transcripts
- Cross-team prompt pattern sharing via Git
- `via skills` - install VEKTOR memory skills into Claude Code, Codex, Gemini CLI
- Sovereign sync providers - Codeberg and Gitea
---

## License

Apache 2.0 — free forever. Built by [Vektor Memory](https://vektormemory.com).
