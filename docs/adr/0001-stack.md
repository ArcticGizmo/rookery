# ADR 0001 — Technology stack

**Status:** Accepted · **Date:** 2026-07-01

## Context

Rookery is a rich, long-running agent orchestrator + workflow desktop app (see
`docs/idea.md`). It needs: a capable desktop UI, an in-process agent runtime with
visibility into token/context usage, embedded persistence with an append-only audit log,
and isolated per-feature infrastructure (worktrees + docker).

## Decisions

| Area | Choice |
|---|---|
| Shell | Electron via **electron-vite** |
| Renderer | **Vue 3** (`<script setup>`, TS) + **Pinia** + **vue-router** |
| Styling / UI | **Tailwind CSS v4** + **shadcn-vue** (reka-ui) |
| Agent engine | **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), in-process in the main process |
| Persistence | **SQLite** via **better-sqlite3**, **Drizzle ORM** + drizzle-kit migrations *(added in Phase 1)* |
| IPC | Hand-rolled typed contract in `src/shared`; `contextIsolation: true`, `nodeIntegration: false` |
| Worktree + docker infra | `InfraProvider` interface; **sprig** CLI-backed provider is the v1 implementation *(Phase 5)* |
| Package manager | **pnpm** (hoisted node-linker for Electron/native-module compatibility) |
| Testing | **Vitest** (unit), **Playwright** (Electron e2e) |
| Packaging | **electron-builder** |
| Language | TypeScript everywhere, `strict: true` |

## Rationale

- **Electron + Vue**: rich interaction and a large ecosystem; Vue chosen per preference.
- **Claude Agent SDK in-process**: native session control and per-turn token/context usage
  (needed for the context-pressure warnings), and BYO MCP/skills/subagents map to SDK config.
  Reuses local Claude Code credentials — no separate auth setup in the common case.
- **SQLite + Drizzle**: embedded, synchronous, fast; typed queries suit an append-only audit
  log and content-hashed spec versioning.
- **InfraProvider behind sprig**: reuse proven worktree + docker-compose tooling now, without
  committing the workflow engine to it — a native backend can replace the provider later.
- **pnpm with `node-linker=hoisted`**: efficient installs while keeping the flat `node_modules`
  layout Electron, electron-builder, and native modules expect.

## Consequences

- The main process runs Node; the agent SDK and DB live there, reached from the renderer only
  through the typed IPC contract.
- Electron 43 ships no `postinstall`; a root `postinstall` runs its installer for reproducible
  installs, and trusted dependency build scripts are enumerated in `pnpm-workspace.yaml`.
