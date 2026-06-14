# Via Changelog

All notable changes to Via are documented here.

---

## [0.4.2] - 2026-06-15

### Added: Interactive TUI — full arrow-key command palette

Running `via` with no arguments now launches an Ink-powered terminal UI instead
of showing plain-text help. Every command has a guided wizard that builds the
correct flags from step-by-step prompts — no flag memorisation required.

```bash
via          # launches interactive TUI (real TTY only)
via --help   # plain-text help unchanged
via prompt "add auth to the API"   # direct CLI unchanged
```

**Palette** — arrow keys to navigate, enter to select, `q` to quit.

**Per-command wizards:**

| Command | Wizard flow |
|---|---|
| `init` | action picker (auto / dry-run / force) → confirm |
| `prompt` | type goal → outcome picker (none / success / fail / avoid) → confirm |
| `memory` | action picker (add / search / list / graph / ingest file / remove) → input |
| `task` | action picker (list / add / mark done) → input |
| `handoff` | export / import / list picker → file path if import |
| `log` | show / add / today / search / watch / scan picker |
| `ask` | type question → tool picker (auto / Claude / Cursor / Windsurf / ChatGPT) |
| `diff` | type prompt → tool pair picker |
| `convert` | file path input → format picker (11 formats) |
| `serve` | stdio / SSE / custom port picker |
| `research` | session count picker with live progress dashboard |

**Research live dashboard** — intercepts `process.stdout.write` to parse
iteration dots and `best:` scores as they stream. Shows two progress bars
(session progress + current-session iteration) and a scrolling score history.

**TTY guard** — TUI only launches when `process.stdout.isTTY && !process.env.CI`.
Falls back to plain `--help` output in CI, pipes, and Docker. All existing CLI
flags and subcommands work identically — zero breaking changes.

### Fixed
- `prompt --export yaml` — `writeFileSync` now calls `mkdirSync` on the output
  directory before writing. Previously crashed with `ENOENT` if `.via/` did not
  exist in the current working directory.
- `via convert` tool detection on Windows — `spawnSync` now passes
  `shell: process.platform === 'win32'` so MSI-installed tools (Pandoc, FFmpeg)
  are resolved through PATH correctly. Previously reported "not installed" even
  when the tool was present.
- `via convert` plain-text adapter — `cmdConvert` was calling
  `adapter.convert(flags)` passing the flags object where the records array
  should go. Corrected to read the file with `readJsonl()` then call
  `adapter.convert(records, flags)`. Fixes `Cannot read properties of undefined
  (reading 'separator')`.
- `via convert` txt→md route — added `.txt`, `.html`, `.rst`, `.docx` as valid
  Pandoc source formats. Previously only `.pdf→.md` was registered.
- Banner in TUI — the ASCII banner now prints via `console.log` before Ink
  renders, using the same ANSI colour codes as `via --help`. Avoids unicode
  box-drawing rendering issues in Windows Terminal / PowerShell.

### Changed
- `via research` — default wizard option is "5 sessions ← recommended" with
  quick (2) and thorough (10) presets. Sessions and apply flag are set via the
  wizard rather than requiring `--sessions` and `--apply` flags.
- `via.mjs` — grows from 121 lines (entry point only) to 781 lines with the
  full Ink TUI embedded. No separate files added; single-file architecture
  preserved.

### Testing
- Added `test_via.py` — 60 tests across 14 sections covering all commands,
  subcommands, flags, module resolution, DB initialisation, and global flags.
  Runs in CI with `NO_COLOR=1` and `CI=1` to suppress TUI.
- Fixed Windows encoding — all `subprocess.run` calls use
  `encoding='utf-8', errors='replace'` to handle ANSI box-drawing characters
  that Windows cp1252 cannot decode.

### Dependencies added
```json
"ink": "^5.0.0",
"react": "^18.0.0",
"ink-select-input": "^5.0.0",
"ink-text-input": "^6.0.0"
```

Install before first use: `npm install ink react ink-select-input ink-text-input`

---

## [0.4.0] - 2026-06-14

### New: `via prompt` — Self-Improving Prompt Engine

Generates historically-informed, memory-enriched prompts. Every correction teaches
the system. Every success becomes a reusable template. Compounds over time.

```bash
via prompt "add authentication to the API"        # generate
via prompt --learn success                         # record outcome
via prompt --learn correction --note "needed JWT"  # record correction
via prompt --learn revert                          # record revert
via prompt --avoid "never use Passport.js" --scope global
via prompt --avoid-list
via prompt --history
via prompt --export claude    # write CLAUDE.md block
via prompt --export yaml      # write .via/prompt-patterns.yaml
via prompt --export codex     # write .codex/via-memory.md
via prompt --export gemini    # write Gemini TOML skill
```

Architecture:
- Storage: JSON (default) → SQLite (>500 records) → VEKTOR (if installed)
- Retrieval: Pure-JS BM25 + Porter stemming (zero native deps) → VEKTOR semantic
- Assembly: Template fill → LLM refinement (auto-detects Anthropic / OpenAI / Groq / Ollama)
- AVOID store: scoped (global / directory / file), decays after 30 inactive tasks
- Token budgets: task-type-aware (debug / implement / review / test / commit / refactor)
- JIT abstraction: ephemeral rules from past patterns, promoted to generic on success
- Confidence UI: past task count, success rate, injected context printed before prompt
- Git hooks: `node utils/git-hooks.mjs install` for implicit feedback capture

Progressive enhancement:
- Tier 1: zero deps, BM25, template assembly
- Tier 2: + LLM API key → refined prompts + JIT abstraction
- Tier 3: + VEKTOR → semantic retrieval, 79% LongMemEval benchmark-backed recall

### Upgraded: `via memory` — Semantic Search via VEKTOR Slipstream

```bash
via memory search "query" --hybrid     # BM25 + VEKTOR semantic fusion (RRF)
via memory search "query" --semantic   # pure VEKTOR semantic, graceful fallback
via memory sync                        # push all facts to VEKTOR
via memory stats                       # show counts + VEKTOR connection status
```

### Upgraded: `via task` — Team-Shared Task Board

```bash
via task board                         # kanban: OPEN / IN PROGRESS / DONE
via task assign <id> <name>            # assign to team member
via task share                         # export to .via-board.json (commit to Git)
via task sync                          # import from .via-board.json in project root
via task import <file>                 # import any board file
```

Team sharing is file-based, zero infrastructure. Commit `.via-board.json` to Git.
Teammates run `via task sync` to pull the latest board into their local SQLite.

### Upgraded: `via diff` — Live Streaming Comparison

```bash
via diff --live "explain async/await" --tools claude,openai
```

Streams both responses simultaneously in the terminal. Saves to DB for history.
Auto-detects API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY).

### Upgraded: `via convert` — Batch Folder Conversion

```bash
via convert --batch ./docs --to md
via convert --batch ./audio --to mp3 --out ./converted
via convert --batch ./images --to jpg --dry-run
via convert --batch ./folder --to pdf --no-skip
```

Recursive folder walk, progress bar, skip-existing by default, parallel-safe.
Routes to ImageMagick, FFmpeg, Pandoc, or LibreOffice based on file type.

---

## [0.3.1] - 2026-06-06

### Fixed
- `via research`: cross-session memory persistence via Slipstream
- Connector stability improvements across Claude, ChatGPT, Cursor, Windsurf

---

## [0.3.0] - 2026-06-05

### Added
- `via research` — autonomous parameter tuning with cross-session memory
- `via diff` — side-by-side AI tool response comparison with DB history
- `via convert` — local file conversion (image, audio, video, document)
- `via log` — unified activity log (decisions, spend, events)
- `via ask` — route a question to the right tool and open it
- LangChain connector
- Slipstream connector for VEKTOR memory integration

---

## [0.1.0] - 2026-05-10

### Added
- Initial release
- `via init` — wire Via into Claude Desktop, Cursor, Windsurf automatically
- `via memory` — fact storage with symbol extraction and import graph
- `via task` — shared task board backed by SQLite
- `via handoff` — cross-tool working state export/import
- `via serve` — MCP server over stdio and HTTP+SSE
- `via audit` — AI decision compliance log with export
- `via scaffold` — one-command project setup for all connected tools
- Claude, ChatGPT, Cursor, Windsurf connectors
- ESM throughout, Node >= 18, zero native dependencies
