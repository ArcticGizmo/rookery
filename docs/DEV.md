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

## Notes

- `contextIsolation` is on and `nodeIntegration` is off. All main↔renderer traffic goes
  through the typed contract in `src/shared` (fleshed out in Phase 1).
- UI components live under `src/renderer/components/ui` and follow shadcn-vue conventions;
  add more with the shadcn-vue CLI (config in `components.json`).
