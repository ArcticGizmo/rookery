# Rookery — Phased Implementation Plan

> An agent orchestrator + workflow desktop app. Define the work (spec + repos), define
> *how* it gets done (stages, agent personas, pass criteria, human gates), hit run, and
> watch it execute — with a complete audit trail of everything meaningful that happens.

This plan is built for **parallel execution across many agents**. Work is decomposed into
small, independently deliverable chunks. Every task lists its **dependencies** and whether
it is **parallel-safe** (`∥`) so multiple agents can pick up unblocked work simultaneously.

---

## 1. Locked technical decisions

These are settled. Do not relitigate them in implementation without raising it explicitly.

| Area | Decision | Rationale |
|---|---|---|
| Shell | **Electron** via **electron-vite** | Rich, long-running UI; leverage web ecosystem. |
| Renderer | **Vue 3** (`<script setup>`, TS) + **Pinia** | Chosen. |
| Styling / components | **Tailwind CSS** + **shadcn-vue** (built on reka-ui) | Modern, headless, accessible; low lock-in. |
| Main process | Node (Electron main) — orchestration engine, persistence, agent SDK | Node runtime available in-process. |
| Agent engine | **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), in-process in main | Native session control, per-turn token/context usage, BYO MCP/skills/subagents map to SDK config. Reuses local Claude Code credentials. |
| Persistence | **SQLite** via **libsql** (`@libsql/client`), **Drizzle ORM** + drizzle-kit migrations | Embedded, typed queries, append-only audit + spec versioning. Driver revised from better-sqlite3 (no Electron-43 prebuilt + corporate proxy blocks source builds; libsql is N-API/ABI-stable) — see ADR 0002. |
| IPC | Hand-rolled **typed IPC contract** shared across main/preload/renderer (contextBridge, `contextIsolation: true`, `nodeIntegration: false`) | Type safety without a heavy dependency early. `electron-trpc` is a possible later upgrade. |
| Worktree + docker infra | **`InfraProvider` interface**; `SprigProvider` (shells out to the `sprig` CLI, parses JSON) is the v1 implementation | Reuse proven tooling now; keep a native backend possible later without touching the engine. |
| Testing | **Vitest** (unit), **Playwright** (Electron e2e) | |
| Packaging | **electron-builder** | |
| Language | TypeScript everywhere, `strict: true` | |

### First milestone (walking skeleton)
**Phase 1: App boots → SQLite migrations run → an append-only audit/event log is written and
visible live in a basic UI.** No agents yet. This proves the foundation everything else records into.

---

## 2. Target repository structure

```
rookery/
├─ docs/                      # idea.md, plan.md, ADRs
├─ electron.vite.config.ts
├─ package.json
├─ tsconfig.json              # base
├─ tsconfig.node.json         # main + preload
├─ tsconfig.web.json          # renderer
├─ drizzle.config.ts
├─ src/
│  ├─ main/                   # Electron main (Node)
│  │  ├─ index.ts             # app bootstrap, window lifecycle
│  │  ├─ db/                  # drizzle client, schema, migrations
│  │  ├─ ipc/                 # IPC handler registration
│  │  ├─ services/            # audit log, workflow, run engine, agent engine, infra
│  │  └─ agent/               # Claude Agent SDK wrapper
│  ├─ preload/
│  │  └─ index.ts             # contextBridge — exposes typed IPC client
│  ├─ renderer/               # Vue 3 app
│  │  ├─ index.html
│  │  ├─ main.ts
│  │  ├─ App.vue
│  │  ├─ router/
│  │  ├─ stores/              # Pinia
│  │  ├─ components/
│  │  ├─ views/
│  │  └─ styles/
│  └─ shared/                 # types shared across processes (IPC contract, domain types, event union)
│     ├─ ipc-contract.ts
│     ├─ domain.ts
│     └─ events.ts
└─ tests/
   ├─ unit/
   └─ e2e/
```

`src/shared/` is imported by all three processes and must have **no runtime deps on Electron/Node/DOM** — types and pure functions only.

---

## 3. Cross-cutting conventions (read before starting any task)

- **Audit-first.** Every meaningful state change (spec edited, agent spawned, agent result,
  review outcome, gate passed, stage transition) is written to the append-only event log
  *as the source of truth*. UI reads projections of events; it never invents state the log
  doesn't record. Events are immutable and timestamped (store UTC ISO-8601 + monotonic seq).
- **IPC is typed and centralized.** All main↔renderer traffic goes through the contract in
  `src/shared/ipc-contract.ts`. No `ipcRenderer.invoke('some-string')` scattered in components.
- **No secrets in the repo or DB.** API credentials come from the environment / local Claude
  Code auth. The app never stores raw tokens. (See org data-handling note: no PII into agents.)
- **Deterministic serialization** for anything hashed/versioned (sorted keys) — matters for
  spec versioning diffs.
- **Small PRs.** One task = one PR where practical. Each task below is sized for that.

---

## 4. Phases

Legend: `∥` = parallel-safe once dependencies met · `→` = depends on.

---

### Phase 0 — Repo & tooling scaffolding
*Goal: an empty but fully wired dev environment. Maximize parallelism; these are deliberately tiny.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| 0.1 | Init project | `package.json`, `.gitignore`, `.editorconfig`, Node engine pinned, license. `npm install` succeeds. | — |
| 0.2 | electron-vite scaffold | `electron.vite.config.ts` with main/preload/renderer entries; `npm run dev` opens a blank window; `npm run build` produces output. | 0.1 |
| 0.3 | TypeScript configs | `tsconfig.json` base + `tsconfig.node.json` + `tsconfig.web.json`, path alias `@shared/*`. `tsc --noEmit` passes across all three. | 0.1 ∥0.2 |
| 0.4 | Lint + format | ESLint (flat config, TS + Vue) + Prettier; `npm run lint` clean on scaffold. | 0.3 |
| 0.5 | Vue + Pinia + router | Vue 3 mounts in renderer, Pinia installed, vue-router with a placeholder route. Blank app renders "Rookery". | 0.2 →0.3 |
| 0.6 | Tailwind + shadcn-vue | Tailwind configured for renderer; shadcn-vue + reka-ui initialized; one sample `Button` renders styled. | 0.5 |
| 0.7 | Test harness | Vitest configured (unit, runs a trivial `shared/` test); Playwright-electron smoke test launches the app and asserts the window title. `npm run test` + `npm run test:e2e` green. | 0.2 ∥0.3 |
| 0.8 | CI pipeline | GitHub Actions: install → typecheck → lint → unit test → build on push/PR (Windows runner at minimum). | 0.4,0.7 |
| 0.9 | Packaging config | electron-builder config; `npm run package` produces an unsigned local build. (Signing deferred.) | 0.2 |
| 0.10 | Contributor docs | `docs/DEV.md`: how to run/build/test; `docs/adr/0001-stack.md` recording §1 decisions. | 0.2 ∥ |

**Phase 0 exit criteria:** `dev`, `build`, `lint`, `test`, `test:e2e`, `package` all run; CI green.

---

### Phase 1 — Persistence & audit foundation (WALKING SKELETON)
*Goal: prove boot → migrations → append-only event log → live in UI. This is the first demoable milestone.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| 1.1 | libsql in main | DB opens at a resolved userData path; connection singleton; graceful close on quit. libsql is N-API (no per-runtime rebuild). | 0.2 |
| 1.2 | Drizzle + migration runner | drizzle-kit configured; migrations run automatically on boot before the window loads; a no-op baseline migration applies cleanly on a fresh DB. | 1.1 |
| 1.3 | Event log schema | `events` table: `id` (seq PK), `ts` (UTC ISO), `type`, `actor` (system/human/agent), `run_id?`, `stage_id?`, `payload` (JSON), plus supporting indexes. Migration + Drizzle model. | 1.2 |
| 1.4 | Event type union | `src/shared/events.ts`: discriminated union of event types (start with `app.booted`, `app.shutdown`; extend later). Typed payloads. | 0.3 ∥ |
| 1.5 | AuditLog service | `append(event)` (immutable insert, assigns seq+ts), `list({after?, filter?})`. Unit tests: append then list; ordering by seq; append is insert-only. | 1.3,1.4 |
| 1.6 | IPC contract skeleton | `src/shared/ipc-contract.ts`: typed channel registry (request/response + main→renderer push). Preload exposes a typed `window.rookery` client via contextBridge. | 0.3 →0.5 |
| 1.7 | Event IPC | `events.list` (query) and `events.stream` (push new events to renderer as they're appended). AuditLog emits → main forwards to renderer. | 1.5,1.6 |
| 1.8 | Live event view | Renderer view + Pinia store subscribing to `events.stream`; renders a scrolling, filterable event list (type, actor, time). | 1.7,0.6 |
| 1.9 | Skeleton wiring | On boot: run migrations → append `app.booted` → open window → event appears live in the UI. Playwright e2e asserts the booted event is visible. | 1.8 |

**Phase 1 exit criteria:** Fresh install boots, migrates, logs a boot event, and shows it live. e2e proves the round-trip.

---

### Phase 2 — Domain model: work items, workflows, spec versioning
*Goal: define the work and the process, persisted and editable. No execution yet.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| 2.1 | Domain types | `src/shared/domain.ts`: `WorkItem` (spec + repos), `WorkflowDef` (ordered `Stage[]`), `Stage` (type, agent personas, pass criteria, gates), `AgentPersona`, `Gate` (human/automated). Pure types + zod-style validators. | 1.4 ∥ |
| 2.2 | Schema: work items | `work_items` table + repos association; migration + Drizzle model + repo-service CRUD. | 1.2,2.1 |
| 2.3 | Schema: workflow defs | `workflow_defs` (+ versioned JSON body) table; CRUD service. Every create/edit emits an audit event. | 1.2,2.1,1.5 |
| 2.4 | Spec versioning | `spec_versions` table: content-hashed, append-only, per work item. `saveSpec` creates a new version only when content changes; expose `history` + `diff(a,b)`. Emits audit events. | 2.2,1.5 |
| 2.5 | Workflow validation | Validate a `WorkflowDef` (stage ordering, gate references, persona completeness); surfaced errors before a run can start. Unit-tested. | 2.1 ∥ |
| 2.6 | IPC: work items | Contract + handlers for work-item CRUD; Pinia store. | 2.2,1.6 |
| 2.7 | IPC: workflows | Contract + handlers for workflow CRUD; Pinia store. | 2.3,1.6 |
| 2.8 | UI: work item editor | Create/edit a work item: spec (markdown editor) + attach repos. Saving creates a spec version; version history + diff viewer visible. | 2.6,2.4,0.6 |
| 2.9 | UI: workflow builder (v1) | Build a workflow: ordered stages, per-stage personas, pass criteria, gate placement. Validation errors shown inline. | 2.7,2.5,0.6 |

**Phase 2 exit criteria:** A user can define a work item (with versioned spec) and a validated workflow, all persisted and audited.

---

### Phase 3 — Agent engine (Claude Agent SDK)
*Goal: run a single configurable agent against a repo/spec, stream its work into the audit log + UI, and observe context pressure.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| 3.1 | Credential detection | On startup (and on demand) detect whether Agent SDK credentials resolve (env key or Claude Code OAuth profile). If none, surface a clear in-app banner pointing to `ant auth login` / `/login`. No tokens stored by us. | 1.6 |
| 3.2 | Agent SDK wrapper | `src/main/agent/`: wrap `@anthropic-ai/claude-agent-sdk` `query()`; accept a persona config (system prompt, model, allowed tools, MCP servers, skills, cwd/worktree, effort). Returns an async event stream. | 0.2 ∥3.1 |
| 3.3 | Persona → SDK config mapping | Map `AgentPersona` (BYO MCP/tools/skills) to SDK options. Unit-tested mapping; unknown/empty configs degrade gracefully. | 3.2,2.1 |
| 3.4 | Agent event capture | Translate SDK stream events (assistant text, tool use, tool result, usage, result) into audit events (`agent.spawned`, `agent.message`, `agent.tool_use`, `agent.usage`, `agent.finished`). Persisted via AuditLog. | 3.2,1.5,1.4 |
| 3.5 | Context-pressure metric | From per-turn `usage` (input + cache + output vs. model context window), compute a context-usage %. Emit `agent.context_pressure` events; define thresholds (warn/high). Unit-tested computation. | 3.4 |
| 3.6 | Cancellation | Ability to abort a running agent cleanly; emits `agent.cancelled`; releases resources. | 3.2 |
| 3.7 | IPC: run one agent | Contract + handlers to start/cancel a single agent run and stream its events to the renderer. | 3.4,3.6,1.6 |
| 3.8 | UI: single agent run | Pick a work item + persona + repo → run one agent; live-stream its transcript/tool calls; show token usage and a context-pressure indicator with warning state. | 3.7,0.6 |

**Phase 3 exit criteria:** A single agent runs end-to-end against a repo, its activity streams live into the UI and audit log, and context pressure is visible with a warning when high.

---

### Phase 4 — Orchestration engine (stages, gates, transitions)
*Goal: execute a workflow over a work item as a run, driving stages/gates/transitions and recording everything.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| 4.1 | Run schema | `runs`, `stage_executions` tables (status, timestamps, current stage, links to work item + workflow version). Migration + models. | 1.2,2.2,2.3 |
| 4.2 | Run state machine | Pure, testable state machine: run/stage lifecycle (`pending→running→awaiting_gate→passed/failed→next/back`). No side effects in the core; exhaustively unit-tested. | 4.1,2.1 |
| 4.3 | Engine runtime | Drives the state machine: executes a stage, invokes its agents (via Phase 3), evaluates pass criteria, halts at gates, transitions. Every transition → audit event. | 4.2,3.4 |
| 4.4 | Human gates | Gate becomes `awaiting_human`; run pauses; a human approve/reject/request-changes action resumes or routes back to a prior stage. Audited with who/when. | 4.3,1.5 |
| 4.5 | Automated criteria | Evaluate configured pass criteria (e.g. "reviewer agent approves", "personas agree no changes"). Pluggable criterion evaluators. Unit-tested. | 4.3 |
| 4.6 | Iterative impl loop | Stage pattern: implementer agent → reviewer agent → (fail ⇒ loop back with feedback) → human check. Bounded retries; each iteration audited. | 4.3,4.5 |
| 4.7 | Request-changes to spec | From a stage, allow "request changes" that routes back to spec review (Stage 1) without auto-editing the spec — records the requested change as an event. | 4.4,2.4 |
| 4.8 | IPC: runs | Contract + handlers: start run, list runs, gate actions, subscribe to run state. | 4.3,4.4,1.6 |
| 4.9 | UI: run view | Start a run; visualize stage progress, current activity, pending gates with action buttons; show per-stage agent streams. | 4.8,3.8,0.6 |

**Phase 4 exit criteria:** A defined workflow runs end-to-end over a work item, honoring human gates and automated criteria, with iterative loops and a full audit trail — matching the Example 1 flow in `idea.md` (minus real infra provisioning, stubbed in Phase 5).

---

### Phase 5 — Infrastructure: worktrees + docker (InfraProvider / sprig)
*Goal: provision isolated worktrees + docker infra per feature so multiple runs don't collide.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| 5.1 | `InfraProvider` interface | `create(instance)`, `up`, `down`, `info`, `status`, `remove`; typed result shapes; provider selected via config. Documented contract. | 2.1 ∥ |
| 5.2 | SprigProvider | Shell out to the `sprig` CLI; parse JSON output; map to `InfraProvider`. Detect sprig on PATH; clear error if missing. Integration-tested behind a flag. | 5.1 |
| 5.3 | Infra audit events | `infra.provisioning`, `infra.up`, `infra.down`, `infra.failed` events with instance/worktree/port details. | 5.2,1.5 |
| 5.4 | Setup stage wiring | The workflow "setup" stage calls the provider to create worktrees + bring infra up for impacted repos; agents in later stages run with the worktree cwd. Teardown on run completion (configurable). | 5.3,4.3,3.2 |
| 5.5 | IPC + UI: infra status | Surface per-run infra status (instances, worktree paths, container health) in the run view. | 5.4,4.9 |
| 5.6 | Permission & audit hardening | Isolated-worktree agents default to `acceptEdits` (not `bypassPermissions`); a hard deny backstop (`SECURITY_DENY_RULES`: curl/wget/ssh/scp/sudo/nc/docker/`git push`/WebFetch) applies to every agent via `settings.permissions.deny`; `settingSources: []` stops inheriting the user's global `~/.claude` grants; `forwardSubagentText: true` + new `agent.tool_result`/`agent.permission_denied`/`agent.task` events (with `parentToolUseId`/`subagentType`) put **all** sub-agent and background-agent activity in the audit log. | 5.4,3.4 |

**Phase 5 exit criteria:** A run's setup stage provisions isolated worktrees + docker infra via sprig, agents operate inside them, status is visible, and teardown works. Multiple runs coexist without collision. Agents run least-privilege by default (worktree isolation + deny backstop, no `bypassPermissions`), and every action — including inside sub/background agents — is audited.

> **Circle back (see §6 Q8):** the permission mode is currently fixed by the engine
> (`plan` → `acceptEdits`). Letting users *choose* per persona/run (`acceptEdits` /
> `auto` / `bypassPermissions`), and surfacing tool-permission prompts to a human via
> `canUseTool` instead of auto-denying, is a deferred Phase 6 decision.

---

### Phase 6 — Observability, history & completion
*Goal: make it clear "who is doing what and why" at any moment, browse full history, and land changes.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| 6.1 | Activity dashboard | Cross-run view: active agents, their stage/purpose, live status, and aggregate context-pressure. Global warning surfacing when pressure is high. | 4.9,3.5 |
| 6.2 | Audit history browser | Filter/search the full event log by run, stage, actor, type, time; drill into any event. Spec version diffs linked from spec events. | 1.8,2.4 |
| 6.3 | Feature verification stage | Support the final workflow stage: run automated tests / verifying agents end-to-end; record issues; route back to phase 1 with knowledge of fixes if any. | 4.6,5.4 |
| 6.4 | Landing changes | On success, a human chooses how the change reaches main: open a PR or merge directly (per impacted repo). Actions audited. | 6.3,4.4 |
| 6.5 | Notifications | In-app (and optionally OS) notifications when a run needs a human gate or hits high context pressure. | 4.4,3.5 |

**Phase 6 exit criteria:** Full visibility into concurrent work, complete searchable history, end-to-end feature verification, and human-directed landing to main.

---

### Phase 7 — Hardening & release
*Goal: ship-ready.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| 7.1 | Error handling & recovery | Graceful handling of agent/infra/DB failures; runs recover or fail cleanly with audited reasons; DB integrity on crash. | Phases 1–6 |
| 7.2 | Migration/versioning strategy | Forward-only migration policy; app-version ↔ schema-version guardrails. | 1.2 |
| 7.3 | Code signing & auto-update | Signed builds; auto-update channel (electron-updater). | 0.9 |
| 7.4 | Perf pass | Large event logs paginate/virtualize; long-running runs stay responsive. | 6.1,6.2 |
| 7.5 | Docs | User guide + workflow authoring guide. | Phases 1–6 |

---

## 5. Suggested parallelization waves

- **Wave A (day 1, many agents):** Phase 0 tasks 0.1→0.3 first, then 0.4–0.10 in parallel.
- **Wave B:** Phase 1 in order (skeleton is sequential-ish), while `1.4` and `1.6` can start alongside `1.1`–`1.3`.
- **Wave C:** Phase 2 and Phase 3 are largely independent and can run in parallel (Phase 2 = domain/UI, Phase 3 = agent engine), both depending only on Phase 1.
- **Wave D:** Phase 4 needs 2+3. Phase 5's `5.1` interface can be built during Phase 2/3 and slotted in.
- **Wave E:** Phases 6–7 after the engine + infra land.

---

## 6. Open questions / deferred decisions

These do **not** block the plan; resolve when the relevant phase is reached.

1. **sprig commitment (Phase 5).** We're building behind `InfraProvider` precisely so this stays deferrable. Decide whether a native provider is ever needed once sprig integration is proven.
2. **Component library depth.** shadcn-vue chosen; revisit if a richer set (e.g. PrimeVue) is wanted for complex data grids in Phase 6.
3. **IPC upgrade.** Start hand-rolled; consider `electron-trpc` if the contract grows unwieldy.
4. **Multi-repo spec attachment model.** Confirm how repos are referenced (local path vs. remote URL vs. both) at 2.2.
5. **Model/provider config surface.** Which models to expose in persona config, and whether to allow non-default effort/thinking settings, decided at 3.3.
6. **Concurrency limits.** Max simultaneous runs/agents/infra instances — a Phase 6 tuning concern.
7. **Cross-platform.** Plan targets Windows first (per environment). Confirm whether macOS/Linux are release targets before 7.3.
8. **Configurable agent permission mode (deferred from Phase 5.6).** Today the engine fixes the
   mode (read-only `plan` outside a worktree, `acceptEdits` inside one) with a hard deny
   backstop and no inheritance of the user's global settings. Decide whether to let users
   choose the mode per persona/run — `acceptEdits`, `auto` (model-classifier gating), or
   `bypassPermissions` (explicit "dangerous" opt-in) — and whether to add an interactive
   permission gate: wire the SDK `canUseTool` callback to a human prompt (reuse the Phase 4
   gate UI) that emits `agent.permission_requested`/`_resolved` events and can persist
   "always allow" rules per run, instead of auto-denying un-allow-listed tools. Also revisit
   whether to relax specific deny-backstop entries (e.g. `docker`, `WebFetch`) per persona,
   and whether to enable the SDK OS `sandbox` layer (verify Windows support first).
9. **PR host abstraction (deferred from Phase 6.4).** The v1 `GitLandingProvider` opens PRs via
   the GitHub `gh` CLI, so PR creation assumes GitHub + an installed/authenticated `gh` (direct
   `merge` uses only `git` and is host-agnostic). Landing already sits behind the
   `LandingProvider` port, so revisit whether to abstract the PR host — GitLab (`glab`),
   Bitbucket, Azure DevOps, or a generic "push branch + print compare URL" fallback — either as
   alternate providers or a pluggable PR backend within `GitLandingProvider`, selected per repo
   (e.g. from the remote URL). Not needed while every target repo is on GitHub.

---

## 7. Definition of done (per task)

A task is done when: code + types compile (`tsc --noEmit`), lint passes, unit tests cover the
logic it introduces, any new IPC is in the shared contract, any new meaningful state change
emits an audit event, and — where it touches the UI or engine — a Playwright/e2e or integration
check demonstrates the behavior. Small PR, one task.
