# Developing Rookery

## Prerequisites

- **Node.js >= 22**
- **pnpm >= 11** (`corepack enable pnpm` if you don't have it)
- For running agents later: Claude Code / the Claude Agent SDK resolve credentials from
  your environment (`ANTHROPIC_API_KEY`) or a Claude Code / `ant auth login` OAuth profile.
  No credentials are stored by the app.

## Install

```sh
pnpm install
```

This also runs a `postinstall` step that downloads the Electron runtime binary.

> **pnpm build scripts:** pnpm blocks dependency lifecycle scripts by default. The ones we
> trust are listed under `allowBuilds` in `pnpm-workspace.yaml`. If you add a dependency that
> needs a build step (e.g. a native module), add it there.

## Common scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run the app in development with HMR. |
| `pnpm build` | Type-agnostic production build into `out/`. |
| `pnpm start` | Preview a production build. |
| `pnpm typecheck` | Type-check main/preload (`tsc`) and renderer (`vue-tsc`). |
| `pnpm lint` / `pnpm lint:fix` | ESLint over the repo. |
| `pnpm format` / `pnpm format:check` | Prettier. |
| `pnpm test` / `pnpm test:watch` | Vitest unit tests. |
| `pnpm test:e2e` | Build, then run the Playwright + Electron smoke test. |
| `pnpm package` | Build and produce an unpacked app in `release/` (electron-builder `--dir`). |
| `pnpm db:generate` | Generate SQL migrations from the Drizzle schema into `drizzle/`. |

## Project layout

```
src/
  main/      Electron main process (Node) — window lifecycle, and later the orchestration engine, DB, agent SDK.
  preload/   contextBridge — exposes the typed API on window.rookery.
  renderer/  Vue 3 app (Pinia, vue-router, Tailwind, shadcn-vue).
  shared/    Types/pure functions shared across processes. No Electron/Node/DOM runtime deps.
tests/
  unit/      Vitest.
  e2e/       Playwright (launches the built Electron app).
```

Path aliases: `@shared/*` (all processes), `@renderer/*` (renderer).

## Persistence

- **SQLite via libsql** (`@libsql/client`) with **Drizzle ORM**. libsql is N-API, so one
  prebuilt binary works in both Electron and Node (see [ADR 0002](./adr/0002-sqlite-driver.md)).
- The database lives at `app.getPath('userData')/rookery.db` (outside the repo).
- **Migrations** are authored by editing `src/main/db/schema.ts` then running
  `pnpm db:generate`, which writes SQL into `drizzle/` (committed). They are applied
  automatically on boot, before the window loads. In a packaged app the `drizzle/` folder is
  bundled under resources (electron-builder `extraResources`).
- The event log is the append-only source of truth (`src/main/services`): `AuditLog` over an
  `EventStore` port — `SqliteEventStore` (libsql) in the app, `InMemoryEventStore` in tests.

## Infrastructure (worktrees + docker)

- A run's **setup stage** provisions isolated git worktrees + docker infra so concurrent runs
  don't collide. This sits behind the **`InfraProvider`** port
  (`src/main/services/infra/`); see [ADR 0003](./adr/0003-infra-provider.md).
- Provider is selected by **`ROOKERY_INFRA_PROVIDER`**:
  - `sprig` (default) — shells out to the [`sprig`](https://www.npmjs.com/package/@ArcticGizmo/sprig)
    CLI (`npm i -g @ArcticGizmo/sprig`). Requires sprig on PATH **only when a run requests a
    template**; docker/compose is needed for infra to come up.
  - `stub` — in-memory fake; no git/docker. Use for UI/engine dev without sprig installed.
  - `none` — infra disabled; a run that requests a template fails its setup stage.
- A run gets its template + teardown flag from the **Runs start form**
  (`StartRunInput.infraTemplate` / `teardownOnComplete`). No template ⇒ no infra; agents run
  against the work item's own checkout.
- Every infra step is audited (`infra.provisioning` / `infra.up` / `infra.down` / `infra.failed`)
  and the run view shows live status (`runs:infra`), falling back to the last `infra.up` event.

## Notes

- `contextIsolation` is on and `nodeIntegration` is off. All main↔renderer traffic goes
  through the typed contract in `src/shared/ipc-contract.ts`; the preload exposes it on
  `window.rookery`.
- UI components live under `src/renderer/components/ui` and follow shadcn-vue conventions;
  add more with the shadcn-vue CLI (config in `components.json`).
