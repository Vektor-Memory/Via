# Changelog

All notable changes to Via are documented here.

## [0.1.0] - 2026-05-10

### Added
- Initial release
- `via ingest` — URL, file, folder, and inline text ingestion
- `via context` — multi-tool context formatting (Claude, Cursor, Windsurf, ChatGPT)
- `via task` — shared task board backed by SQLite
- `via audit` — AI decision compliance log with export
- `via scaffold` — one-command project setup for all connected tools
- `via serve` — MCP server over stdio and HTTP+SSE
- `via watch` — desktop and webhook event routing
- `via handoff` — cross-tool working state export/import
- `via status` — ecosystem health dashboard
- `via persona` — named AI persona management
- `via spend` — AI cost tracking
- `via sync` — multi-machine state sync
- `via upgrade` — Slipstream upgrade bridge

### Fixed
- ESM compatibility: replaced `require()` with top-level imports in all connectors
- `via ingest <file>`: target detection bug when `--text` not present
- Native fetch used throughout (Node 18+); removed `node-fetch` dependency
- SSE server: broadcast removed from POST handler (responses scoped to caller)
- Windows desktop notification: replaced blocking `MessageBox` with non-blocking `BalloonTip`
- Cursor scaffold: writes `.cursor/rules/via-context.mdc` per Cursor >=0.45 spec
- Audit export: success log now fires inside `finish` event (after flush)
- Context command: removed unused `execSync` dead import
