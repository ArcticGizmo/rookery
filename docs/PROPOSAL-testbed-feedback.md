# Proposal — addressing the smoke-test feedback

**Status:** Draft for review · **Date:** 2026-07-02 · **Source:** `docs/TODO.md`
(notes from the read-only run in `../rookery-testbed/ROOKERY-SMOKE-TEST.md`)

This proposal turns the TODO notes into concrete, sequenced work. Each item lists **what**,
**where** (the actual files), **how**, and rough **effort** (S ≤ half-day, M ≈ 1–2 days,
L ≈ 3+ days). Nothing here relitigates the locked decisions in `docs/plan.md §1`.

At the end there's a **recommended sequencing** and a short list of **decisions to confirm**.

---

## Themes at a glance

| # | Theme | Items | Effort |
|---|---|---|---|
| A | Work-item authoring | folder picker, path handling, git probe, remote inference, markdown | M |
| B | Workflow authoring | built-in templates, model autocomplete | M |
| C | Run experience | activity redesign, review-what-I-approve, terminate a run | L |
| D | Activity dashboard | fix "active agents always blank" | S |
| E | Run without sprig | local-branch execution mode | M |

The highest-value, lowest-cost wins are **D** (a real bug, ~S) and the **terminate** part of
**C**. The most impactful for perceived quality are the **run experience** (C) and **E**.

---

## A. Work-item authoring

*(TODO §"Creating a work item")*

Today the repo rows in `src/renderer/views/WorkItemEditor.vue:166-190` are three bare text
inputs; the domain already models `localPath` + optional `remoteUrl`
(`src/shared/domain.ts:18-27`).

### A1 — Folder-select with autocomplete for `localPath` (M)
- Add a main-process IPC `dialog:pickDirectory` that calls Electron
  `dialog.showOpenDialog({ properties: ['openDirectory'] })` and returns the chosen path.
  Wire it into `src/shared/ipc-contract.ts` (`IPC`, `IpcInvokeMap`), the handler in
  `src/main/ipc/index.ts`, and the preload bridge.
- In the repo row, put a **"Browse…"** button next to the path input that fills it in.
- Type-ahead autocomplete: add IPC `fs:listDirs(prefix)` returning child directory names for
  the typed prefix, surfaced via a `<datalist>` on the input. Keeps typing fast without a
  heavyweight file tree.

### A2 — Windows `\` vs `/` handling (S)
- Normalize on input and before persisting. Store canonical forward-slash paths (works for
  Node `fs`/`git` on Windows) and display the OS-native separator. A small helper in
  `src/shared` (`normalizeRepoPath`) keeps main + renderer consistent; call it in
  `reposPayload()` (`WorkItemEditor.vue:69`).

### A3 — Inline git warning, non-blocking (S–M)
- New IPC `repo:probe(localPath)` in main that checks for a `.git` directory (or file, for
  worktrees/submodules) and returns `{ isGitRepo, defaultBranch, remoteUrl }`.
- Run it on path blur/change; if `!isGitRepo`, show an inline amber hint on that row — **does
  not block Save** (matches the TODO: "flag an issue inline… though not block").

### A4 — Infer remote URL from the checkout (S)
- The `.git/config` `[remote "origin"] url` is where that lives. `repo:probe` (A3) reads it
  via `git config --get remote.origin.url` (or parses `.git/config`). If `remoteUrl` is empty
  and probe finds one, pre-fill it (leave user-entered values untouched). This directly
  answers the TODO's "I am not sure where that information actually lives."

### A5 — Rich markdown for the spec/review (M, deferrable)
- The TODO explicitly defers this ("until everything is working"). When we do it:
  - Add a small, sanitizing markdown renderer. **Decision to confirm:** `marked` +
    `dompurify` vs a lighter `markdown-it`. Given Electron + `contextIsolation`, we must
    sanitize; I lean `markdown-it` (built-in escaping, no `eval`).
  - Reuse it in the spec preview here and in the run's gate artifact view (see **C2**) — one
    `<MarkdownView>` component in `src/renderer/components`.

---

## B. Workflow authoring

*(TODO §"Creating a workflow")*

### B1 — Built-in workflow templates (M)
- Add `src/shared/workflow-templates.ts` exporting named, versioned `WorkflowDefBody`
  templates: **Blank**, **Vue app**, **.NET service** (per the TODO's focus). Each prefills
  stages/personas/criteria/gates that already validate against
  `src/shared/workflow-validation.ts`.
- Flow change in `src/renderer/views/WorkflowBuilder.vue`: when arriving via **"+ New
  workflow"**, show a template chooser first (Blank = current empty behaviour). Selecting a
  template seeds `name`/`description`/`stages` with fresh `crypto.randomUUID()` ids (reuse the
  existing `uid()` at `WorkflowBuilder.vue:55`), then drops the user into the normal editor to
  tweak.
- Templates are seeds, not links — editing a seeded workflow never mutates the template. This
  keeps them "just built into the system" as requested.

*Illustrative "Vue app" template:* `review` (Tech Lead persona, `reviewer_approves`, human
gate) → `plan` (Architect, `manual`, human gate) → `setup` → `implementation` (Engineer,
`tests_pass`) → `verification` (`tests_pass`, human gate). The ".NET service" variant differs
in persona prompts and test commands.

### B2 — Model autocomplete, free-text allowed (S)
- The persona model field is free text today (`WorkflowBuilder.vue:303-308`). Add a shared
  `KNOWN_MODELS` list (Opus 4.8, Sonnet 5, Haiku 4.5, Fable 5 — the ids in the SDK docs) and
  bind the input to a `<datalist>`. Free typing still works, so newer models aren't blocked —
  exactly the TODO's ask. `mapPersonaToOptions` already passes `persona.model` through
  verbatim (`src/main/agent/persona-mapping.ts:46`), so no engine change is needed.

---

## C. Run experience

*(TODO §"Actual runs")* — the biggest area. Three sub-parts.

### C1 — Activity panel → "chain of thought" (M)
Today `RunDetail.vue:528-546` renders **every** event as a flat list — the "too long and
unimportant" panel the TODO calls out. The data model is fine; the projection is the problem.

- **Keep recording everything** (append-only log is untouched) but change the *view*:
  - Show the **last 5 meaningful messages** (agent messages + stage transitions + gate
    events) as a compact chain, most-recent last.
  - Each entry with tool detail (`agent.tool_use`/`agent.tool_result`) is **collapsed by
    default**, expandable on click to reveal tool name, input, and result. Group child events
    under their `agentRunId`/`toolUseId` (the payloads already carry `toolUseId` /
    `parentToolUseId` — see `agent-service.ts:135-205`).
  - Replace the inline full list with a **"View all activity"** button that routes to
    `History` pre-filtered by this run id (History already supports run-id + type-prefix
    filtering per the smoke test §6). No new backend — it's a link with query params.
- Mechanically: extract the current `activityLine`/`lineClass` logic into a small
  `ChainOfThought.vue` component so `RunDetail` stays readable.

### C2 — Show *what* I'm approving at a gate (M) — most important correctness gap
The TODO: *"in the review phase… I was not shown what the spec had become… no way I could
actually review it."* Right now the gate banner (`RunDetail.vue:351-405`) shows only the
gate description — the produced artifact (the review write-up, the plan) is buried in the
activity stream, if visible at all.

- **Capture stage artifacts explicitly.** The engine already collects each agent's final text
  (`AgentService.run` → `AgentResult.resultText`, `agent-service.ts:54-77`) but only the
  streamed `agent.message` chunks are logged. Add a `run.stage_output` event emitted when a
  stage's agents finish, carrying `{ stageId, personaName, artifact }`. This makes the
  artifact a first-class, audited object (consistent with idea.md's "audit everything").
- **Render it at the gate.** In the pending-gate section, list the current stage's artifacts
  and render them with the `<MarkdownView>` from **A5**. Now "Approve / Request changes /
  Reject" act on something visible.
- This dovetails with **A5**; if we do C2 we should do the markdown component first.

### C3 — Terminate a running run (S–M)
There is genuinely no cancel path today, even though the state machine already supports it:
`reduceRun` handles a `CANCEL` action → `cancelled` (`src/shared/run-state-machine.ts:72-80`),
and `AgentService.cancel(agentRunId)` exists (`agent-service.ts:127-133`). The missing pieces:

1. **Track live agents per run.** `AgentService` keeps an `active` map but not keyed by run.
   Add `cancelByRun(runId)` that cancels every active agent whose `scope.runId === runId`.
2. **`RunEngine.cancel(runId)`**: stop the in-memory `drive` loop (a `cancelled` set checked
   in the `while` at `run-engine.ts:399`), call `agents.cancelByRun`, `apply(CANCEL)`, emit
   `run.finished` `cancelled`, and `finalize` (which already tears down infra for non-passed
   runs, `run-engine.ts:364-378`).
3. **IPC + UI**: add `runs:cancel` to the contract and a **"Terminate run"** button in
   `RunDetail.vue` shown while `status ∈ {running, awaiting_gate}`, with a confirm.

---

## D. Activity dashboard — "active agents always blank" (S) — real bug

*(TODO §"Activity nav item")*

**Root cause found.** The dashboard reads the shared events store, which initializes with
`events.list({ limit: 500 })` (`src/renderer/stores/events.ts:48`). `list()` defaults to
**ascending id order** (`sqlite-event-store.ts:46`) — i.e. the *oldest* 500 events. Once the
DB has more than 500 events, a currently-running agent's `agent.spawned` (recent) is **not**
in the loaded window, and the live `onAppend` tail only delivers events that arrive *after*
the page mounts. So `computeActivity` (`src/shared/activity.ts:85`) never sees the spawn and
the agent list is empty — even though perch shows the session running.

**Fix (pick one):**
- *Minimal:* load the **most recent** window — `events.list({ limit: 500, order: 'desc' })`
  then reverse to chronological before storing, so `computeActivity`'s reducer still sees
  events in order. ~S.
- *Better (recommended):* add a main-process `activity:summary` projection that runs
  `computeActivity` over the **full** recent log server-side and returns the summary, with a
  lightweight live refresh. This is O(1) for the renderer and correct regardless of log size —
  the dashboard shouldn't depend on how much history happens to be buffered.

I recommend the minimal fix now (unblocks the smoke test) and the projection as a fast-follow.

---

## E. Run without sprig — local-branch execution mode (M)

*(TODO §"It should work without sprig")*

Today, with no infra template the engine runs agents **read-only** (`plan` mode) against the
repo checkout; write access (`acceptEdits`) is unlocked only when a `setup` stage provisions a
worktree via the provider (`run-engine.ts:576-578`, `ensureInfra` at `:333-355`). The TODO
wants to exercise the *write* path on the main repo with a chosen branch, before wiring sprig.

**Proposal: a third execution mode that needs neither sprig nor Docker.**

- Extend `StartRunInput` (`src/shared/domain.ts:271-296`) with an explicit mode, e.g.
  `executionMode: 'read_only' | 'local_branch' | 'infra'` (default `read_only`), plus an
  optional `workBranch` for `local_branch`.
- For `local_branch`, at the `setup` stage the engine (instead of `ensureInfra`) runs git in
  the repo's own `localPath`: verify the working tree is clean, create/checkout `workBranch`
  from current HEAD, set `ctx.isolated = true` and keep `ctx.cwd` on the real checkout. From
  there the existing loop grants `acceptEdits` and commits per stage exactly as it does for
  worktrees.
- **Safety** (this operates on the user's actual checkout, so be honest about it):
  - Refuse to start if the working tree is dirty (surface a clear error); offer stash as an
    opt-in later.
  - The security backstop already blocks `git push`, `docker`, and network egress
    (`persona-mapping.ts:16-29`), so changes stay local until the user lands them.
  - Landing already supports `merge`/`pr` per-repo (`RunDetail.vue` landing section), so the
    "see the quality, then decide" loop closes without sprig.
- **Start-run UI**: add the mode + branch to the Runs start form (currently infra template is
  the only lever). `local_branch` reveals a branch field.

This is deliberately a stepping stone; the `InfraProvider` seam (`docs/adr/0003`) is untouched,
so moving a proven flow onto sprig later is still just selecting the provider.

---

## Recommended sequencing

1. ~~**D** (blank active-agents)~~ — ✅ **done**. Minimal reverse-order load in the events store.
2. ~~**C3** (terminate a run)~~ — ✅ **done**. `RunEngine.cancel` + `run.cancelled` event + UI.
3. ~~**E** (local-branch mode)~~ — ✅ **done**. `executionMode` (`read_only`/`local_branch`/`infra`),
   `LocalBranchService`, setup-stage branch prep, Runs start-form selector.
4. **A1–A4** (work-item authoring quality) — mostly small, independent, parallel-safe. ← next
5. **B1–B2** (templates + model autocomplete) — cuts workflow setup time.
6. **A5 + C2** (markdown + review-what-I-approve) — do together; C2 is the biggest quality
   lift but depends on the markdown component and a new artifact event.
7. **C1** (chain-of-thought activity) — polish once the above land.

## Decisions

- **Local-branch safety** (E): **resolved → hard-refuse on a dirty working tree.** `prepare()`
  aborts the run's setup stage if `git status --porcelain` is non-empty when switching branches;
  it's idempotent (no clean-check) once already on the run's branch, so fix-loops don't trip.
- **Activity fix depth** (D): shipped the minimal reverse-order load; the server-side projection
  remains a possible fast-follow if log size ever makes the 500-event window too small.

## Decisions still to confirm

- **Markdown library** for A5/C2: `markdown-it` (my lean) vs `marked` + `dompurify`.
- **Template set** (B1): Blank + Vue + .NET to start — any others you want seeded now?

## Notes / follow-ups surfaced while building E

- Local-branch mode unlocks edits only once a **`setup` stage** runs (isolation triggers there,
  same as infra). A workflow that's purely `review`/`plan` stays read-only even in this mode —
  the Runs form hints at this.
- It operates on `repos[0]` (single-repo), matching the existing infra path. Multi-repo
  local-branch is future work.
- Changes are left in the working tree on the branch; there's no auto-commit and the landing
  panel (PR/merge) still keys off infra worktrees, so landing a local-branch run is manual for
  now. Worth revisiting if you want one-click landing for this mode.
