# Rookery — The Commissioning Journey (redesign plan)

> A redesign of Rookery's **journey and interactions**, not its engine. Today the app opens on
> an event log and asks you to assemble *work items → workflows → runs* across seven peer tabs.
> This plan reframes the front-of-house so it feels like **commissioning work and holding the
> reins** — while preserving the event-sourced core, spec versioning, isolated worktrees,
> personas/criteria/gates, and the full audit trail underneath.

**See also:** [`journey.html`](./journey.html) — the annotated visual walkthrough this plan
implements. [`idea.md`](./idea.md) — the original vision (still foundational). This document
**supersedes `plan.md`** (the original build plan, now complete) as the active plan.

---

## 1. The reframe

The current UI is a faithful projection of the architecture — and that engineering truth leaked
onto the front door. The redesign changes **what the user stands in front of**, following one
object (a **brief**) from *"what do you want done?"* to a landed change.

The five feelings every screen must earn (from the walkthrough):

| # | Feeling | Made concrete as |
|---|---------|------------------|
| 01 | **Defining work, not plumbing** | The app opens on one prompt — "What do you want done?" — not a dashboard of empty tables. |
| 02 | **Your method** | You shape *how* it's tackled as readable steps, and author what **"Done means…"** directly. |
| 03 | **You hold the reins** | You *drop* checkpoints where you want to gate; the tool never advances past a decision that's yours. |
| 04 | **Called only when needed** | Silence while it works; one calm **beacon** addressed to you when a human must decide. |
| 05 | **The whole journey** | Broad milestones that zoom down to a single agent's message; the audit log told as a story. |

---

## 2. What's preserved vs. what changes

**Preserved (do not touch the engine's *behavior* to do this work):**

- The append-only event log as source of truth (`AuditLog` / `EventStore`); every screen a projection.
- Domain model *shape*: brief + spec versions, an ordered approach of stages (personas / criteria / gates), flights + stage executions. (Names change — see §3 — the structure and semantics don't.)
- The run/flight state machine, iteration loop, verification loop, human-gate resume, request-changes routing.
- Agent engine (Claude Agent SDK wrapper), context-pressure metric, cancellation.
- Infra provider (worktrees + docker via sprig), landing (PR / merge), notifications, auto-update.

**Changes (front-of-house + a full vocabulary rename):**

- **Vocabulary, everywhere.** A full rename across UI **and** code/IPC/DB (see §3) — not just labels.
- **Navigation model** replaced **in place**: seven peer tabs → a single followed object (the brief) + two attention lanes ("In flight", "Needs you"). The nav swaps on day one; screens are rebuilt in place.
- **Entry point:** event-log home → **the Desk** with the commissioning prompt.
- **Approach authoring:** an agent **drafts the approach from the brief** (template as fallback); rendered as readable stage cards + a first-class "Done means…".
- **Gate placement** → **checkpoints** you drop on a rail.
- **Flight view:** run detail → a milestone timeline that expands to granular agent messages, with a "right now" strip.
- **Attention:** gate/failure surfacing → a human-addressed **"needs you"** beacon with "what I tried" and three levers.
- **History** → **the story**: a narrative timeline separating *your* decisions from the rooks', zoomable to raw payloads.
- **Visual system:** the "flight-deck" identity from `journey.html` (cool slate ground, verdigris accent, semantic beacons, monospace instrument labels).

---

## 3. Decisions taken (confirmed)

| Decision | Choice | Consequence in this plan |
|---|---|---|
| **First-run approach** | **AI-draft from the start.** | An approach-drafting agent is the primary path in **Phase J4**, with the saved-template picker as the fallback / editing base. Adds an agent call, a loading/streaming state, and a failure path to the approach screen. |
| **Vocabulary** | **Full rename, all at once.** | A dedicated **Phase J1 "great rename"** renames domain types, IPC contract, stores, event types, DB references, and existing views up front, so every later phase builds on the new names. No UI-only copy layer. |
| **Rollout** | **Replace nav, iterate in place.** | No feature flag / parallel shell. **Phase J2** swaps the nav on day one; screens are rebuilt in place, with temporary placeholders where a journey screen isn't built yet. The app is briefly half-migrated — accepted. |
| **Doc cleanup** | **Remove `plan.md` + both guides now.** | `plan.md`, `USER_GUIDE.md`, `WORKFLOW_AUTHORING.md` are removed. Fresh guides are **written from scratch** at the end (**Phase J10**), in the new vocabulary. ADRs + `idea.md` + `DEV.md` stay. |

### The vocabulary rename map (Phase J1)

| Today (code + UI) | Becomes | Notes |
|---|---|---|
| `WorkItem` | `Brief` | Types, IPC channels, stores, table/columns, events. |
| `WorkflowDef` / "workflow" | `Approach` | The recipe of stages. |
| `Run` | `Flight` | Types, `run_id` → `flight_id`, `run.*` events → `flight.*`, routes. |
| `Gate` (human) | `Checkpoint` | Engine + UI. |
| pass criteria | "Done means…" (UI) / `doneCriteria` (code) | Same evaluator types (`manual` / `reviewer_approves` / `tests_pass`). |
| persona | persona (type) surfaced as **role** in UI | Kept as a code type; UI shows recognizable roles (Reviewer, Implementer, …). |
| infra template | "isolated workspace" (UI) / infra (code) | Code-level infra naming stays; UI reframes it as safety. |
| event log / History | "the story" (UI) | Events remain events; only the surface is reframed. |

> **Pre-release makes this cheap.** The app is `v0.0.0` with resettable local data, so the DB
> rename can reshape the schema directly (a fresh forward-only migration) without a
> data-preserving migration of historical event rows.

---

## 4. Conventions (unchanged from the existing codebase)

- **Audit-first.** Every meaningful state change emits an immutable, timestamped event; the UI only shows what the log records.
- **Typed, centralized IPC.** All main↔renderer traffic goes through `src/shared/ipc-contract.ts`. No stringly-typed `invoke`.
- **No secrets in repo/DB.** Credentials resolve from the environment / Claude Code auth. No PII into agent prompts.
- **Small PRs.** One task below ≈ one PR. Legend: `∥` = parallel-safe once deps met · `→` = depends on.
- **Definition of done (per task):** compiles (`pnpm typecheck`), lint clean, unit tests cover new logic, new IPC is in the shared contract, new state changes emit audit events, and UI/engine changes get a Playwright/e2e or integration check.

**Key existing touch-points this plan builds on** (so tasks stay concrete):

- Views: `Home.vue`, `Runs.vue`, `RunDetail.vue`, `Workflows.vue`, `WorkflowBuilder.vue`, `WorkItems.vue`, `WorkItemEditor.vue`, `Dashboard.vue`, `History.vue`, `AgentRun.vue`, `App.vue`, `router/index.ts`.
- Stores: `work-items`, `workflows`, `runs`, `events`, `notifications`, `agent`.
- Shared: `domain.ts`, `events.ts`, `ipc-contract.ts`, `workflow-templates.ts`, `chain-of-thought.ts`, `notifications.ts`, `run-state-machine.ts`.
- Services: `work-item-service`, `workflow-service`, `run-engine`, `agent-runner`, `agent-service`, `infra-service`, `landing-service`, `criteria.ts`.

---

## 5. Phases

Phases run roughly in order. J0 and J1 are foundational (visual system, then the rename); J2
replaces the nav; J3–J9 build the journey screens in place; J10 polishes and writes fresh docs.

---

### Phase J0 — Foundations: the visual system
*Goal: the "flight-deck" look exists as reusable tokens + primitives, independent of any screen.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| J0.1 | Design tokens | Port the `journey.html` palette + type roles into the Tailwind v4 theme (`@theme` / CSS vars): slate grounds, verdigris accent, semantic beacon/pass/block, mono instrument-label utility. Both light + dark, driven by the existing theme mechanism. A token reference route renders every token. | — |
| J0.2 | Journey primitives | Reusable presentational components matching the mockups: `Chip` (pass/active/pending/beacon/block), `MilestoneNode`, `MonoLabel`, `BeaconCard`, status dots. A gallery route renders each in both themes. | J0.1 |
| J0.3 | Attention selectors | Pure selectors over the events/flights projections: `briefsInFlight()`, `needsYou()` (flights `awaiting_checkpoint` / escalations / high pressure). Unit-tested against fixture event streams. (Uses post-rename names once J1 lands; can be drafted against current names and renamed with J1.) | ∥ J0.1 |

**Exit:** the flight-deck tokens + primitives render in a gallery in both themes; no product screen changed yet.

---

### Phase J1 — The great rename
*Goal: code, IPC, DB, events, and existing views all speak the new vocabulary, so every later phase builds on the right names. Mechanical but coherent; split into small PRs per layer.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| J1.1 | Shared domain rename | `src/shared/domain.ts` (+ `events.ts`, validators): `WorkItem→Brief`, `WorkflowDef→Approach`, `Run→Flight`, `Gate→Checkpoint`, `passCriteria→doneCriteria`. Types + zod schemas + pure helpers updated; `pnpm typecheck` green across all three tsconfigs. | J0 (or ∥) |
| J1.2 | Event type rename | `run.*` → `flight.*` event types (and any `gate.*` → `checkpoint.*`); update the discriminated union and every emit site. Unit tests updated. | J1.1 |
| J1.3 | IPC contract rename | Rename channels/handlers in `ipc-contract.ts` and `main/ipc` (`workItems.*→briefs.*`, `runs.*→flights.*`, …). Preload + `window.rookery` client updated. | J1.1 |
| J1.4 | Services + engine rename | Rename services/vars (`work-item-service→brief-service`, `run-engine`/`run-store` → flight equivalents, `run-state-machine` states like `awaiting_gate→awaiting_checkpoint`). Behavior unchanged; existing engine tests pass after mechanical updates. | J1.1, J1.2 |
| J1.5 | DB schema rename | New forward-only migration renaming tables/columns (`work_items→briefs`, `runs→flights`, `run_id→flight_id`, …). Fresh-DB migrate clean; e2e boots. (Pre-release: no historical-data preservation required — §3.) | J1.4 |
| J1.6 | Stores + existing views rename | Rename Pinia stores and update the current views/router to the new names so the app still builds and runs (still the old 7-tab layout at this point — J2 replaces it). | J1.3, J1.5 |

**Exit:** the whole app compiles, runs, and passes tests using the new vocabulary end-to-end; UI still looks like today (rename only).

---

### Phase J2 — Replace the navigation & shell
*Goal: swap the seven-tab nav for the journey model on day one; unbuilt destinations show honest placeholders.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| J2.1 | Journey shell | Rework `App.vue`: flight-deck chrome (brand, theme toggle) and a nav of the two attention lanes — **In flight** and **Needs you** — plus **New brief**. Remove the old tab bar. | J0.2, J1.6 |
| J2.2 | Route map | Rework `router/index.ts` to the journey routes (`/` = Desk, `/brief/:id`, `/brief/:id/approach`, `/flight/:id`, `/story/:id`). Old paths redirect to their nearest new home. | J2.1 |
| J2.3 | Placeholders | Any journey screen not yet built renders a clear "coming here next" placeholder that still links to the (renamed) underlying data, so nothing is a dead end during the migration. | J2.2 |
| J2.4 | Live lane counts | The nav's "In flight / Needs you" counts are live from J0.3 selectors. | J2.1, J0.3 |

**Exit:** the app opens on the journey shell with working lanes; every old capability is still reachable (via a new screen or a placeholder).

---

### Phase J3 — The Desk (entry + brief composer)
*Goal: the first thing a user sees is "What do you want done?", and writing it creates a real (versioned) brief.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| J3.1 | Desk layout | `Desk.vue` at `/`: welcome/empty state, the "In flight" and "Needs you" lanes (live), and the primary prompt affordance (mockup step 00). | J2.1, J0.3 |
| J3.2 | Brief composer — prompt | A focused composer for the brief text (the spec), styled as the mockup's prompt field, backed by the spec editor + versioning (content-hashed, audited — unchanged behavior). | J3.1, spec/brief service |
| J3.3 | Brief composer — repos | Attach one or more repos (name + local path, optional remote), reusing the brief's repo model. Inline path validation. | J3.2 |
| J3.4 | Create → continue | "Shape the approach →" creates the brief + first spec version and routes into Phase J4. | J3.2, J3.3 |
| J3.5 | In-flight lane cards | Each in-flight brief renders as a glance card (current stage, status dot, "needs you" flag) linking to its flight (J7). | J3.1, J0.3 |

**Exit:** a first-time user opens the app, writes a brief, attaches repos, and continues — a versioned, audited brief created, no jargon on screen.

---

### Phase J4 — Shape the approach (AI-drafted)
*Goal: an agent proposes how the work is tackled from the brief; the user edits it and authors "Done means…". Template picker is the fallback.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| J4.1 | Approach view-model | A thin adapter over `Approach`/stages: stage → readable card (title, description, roles), criteria → "Done means…" items. Pure + unit-tested. | J1, approach service |
| J4.2 | Drafting agent | A backend "approach drafter" persona/prompt that reads the brief spec and returns a structured proposed approach (stages, roles, done-criteria) validated against the `Approach` schema. Runs via the agent engine; audited (`approach.drafted`). Graceful, typed failure. | J4.1, agent-service |
| J4.3 | Draft IPC + streaming | IPC to request a draft for a brief and stream progress/result to the renderer; loading + error states. | J4.2, ipc |
| J4.4 | Draft-from-brief UX | On entering the approach step, offer "**◆ Draft from my brief**" (primary) with progress, then render the proposal as editable stage cards; **saved templates** (`workflow-templates.ts`) are the explicit fallback / starting base. | J4.3, J0.2 |
| J4.5 | Stage cards (edit) | Add / remove / reorder / reword stages and roles, writing back to the `Approach` through the approach service (validated, audited). Validation surfaced humanely. | J4.4, approach validation |
| J4.6 | "Done means…" editor | First-class verification block: author `doneCriteria` as outcomes ("tests pass", "a reviewer approves each phase", "you approve the result"). Explains the "judge code only after it exists" rule as guidance, not jargon. | J4.5, criteria |
| J4.7 | Approach persistence | Save the approach against the brief; returning reopens the same approach. | J4.5 |

**Exit:** from a brief, one click drafts a tailored approach the user edits, with an explicit "Done means…", all persisted and audited — templates available when preferred.

---

### Phase J5 — Place your checkpoints
*Goal: the user drops human checkpoints where they want to hold the reins.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| J5.1 | Checkpoint rail | Render the approach as a vertical rail with a **Hold / Auto** toggle at each seam (mockup step 02). "Hold" = a checkpoint at that stage; "Auto" = none. | J4.7, J0.2 |
| J5.2 | Toggle → checkpoint mapping | Toggling writes/removes a `Checkpoint` on the stage via the approach service; validated + audited; round-trips with the card editor. | J5.1, approach validation |
| J5.3 | Landing checkpoint | The final "how it lands" checkpoint (PR vs merge) is a hold by default, wiring into landing (surfaced in J9). | J5.2 |
| J5.4 | Defaults + reassurance | The AI draft and templates ship sensible holds (after review, after plan, before landing); "a held checkpoint waits indefinitely" copy. | J5.1 |

**Exit:** the user can express exactly where the flight must stop for them, reflected in the approach's checkpoints.

---

### Phase J6 — Send it into isolation
*Goal: one confident act commits the brief to flight, with isolation made legible as safety.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| J6.1 | Isolation screen | The "ready to fly" view (mockup step 03): the sealed-copy diagram (main untouched → worktree + containers), restating where the first checkpoint is. Reads the selected workspace template + impacted repos. | J5.2, infra-service |
| J6.2 | Workspace + options, reframed | Choose the isolated-workspace template and flight options (max iterations, verification cycles, teardown) as plain choices with sensible defaults. | J6.1 |
| J6.3 | Begin the flight | "◆ Begin the flight" starts a flight over the brief + approach via the flight engine, then routes to the flight view (J7). | J6.2, flight-engine |
| J6.4 | Credential guard | If Agent SDK credentials don't resolve, the screen explains how to log in before "Begin" is enabled (reuse existing detection + banner). | J6.1, credentials |

**Exit:** pressing "Begin the flight" starts a real flight (unchanged engine), landing the user on the live view.

---

### Phase J7 — Watch the flight (live journey)
*Goal: the live view is a readable journey — broad milestones that zoom to granular agent messages — with a "right now" health strip.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| J7.1 | Flight header + status | `Flight.vue` header: brief title, phase X of N, elapsed, repo/checkpoint counts, status chip. Backed by the flight + stage-execution projection (reuse `useScopedEvents`). | J6.3, flights store |
| J7.2 | Milestone timeline | The stage timeline (mockup step 04): each stage a milestone node (done/active/pending/beacon) with a one-line human summary. | J7.1, J0.2 |
| J7.3 | Granular disclosure | Each milestone expands to the granular agent transcript — tool calls, edits (+/−), reviewer notes — reusing `chain-of-thought.ts` and the agent event stream. Broad → granular in one view. | J7.2, agent events |
| J7.4 | "Right now" strip | Live who's-working strip: active agents (role avatars) + a context-pressure meter with healthy/warn/high bands, from `agent.context_pressure` events. | J7.1, context-pressure |
| J7.5 | Broad changes summary | A running diff summary (files touched, +/−) for the flight's workspace. | J7.1 |
| J7.6 | Live updates | Everything tails live and coalesces per frame; verify it rehydrates one flight's full history after a restart. | J7.2–J7.5 |

**Exit:** a running flight reads as trustworthy milestones, each openable to raw activity, with live "who's doing what" and context pressure.

---

### Phase J8 — Moments that need you
*Goal: silence while it works; one calm, human-addressed beacon when a decision is genuinely yours.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| J8.1 | Beacon card | The escalation card (mockup step 05): amber beacon, plain-language context of *why this is yours to decide*, and a collapsible **"what I tried"** built from the iteration/criteria-failure events. | J7.2 |
| J8.2 | Three levers | Approve a direction · request changes with a note · route back to an earlier step — wired to the checkpoint actions (approve / reject / request-changes routing). Audited with who/when. | J8.1, checkpoint actions |
| J8.3 | Escalation sources | Surface as a beacon: `awaiting_checkpoint`, verification-budget escalation, and max-iteration failure — one consistent card for all three. | J8.2, flight-engine |
| J8.4 | "Needs you" lane + notifications | Reframe notifications around "Needs you": the Desk lane and the bell both route to the specific beacon. Keep OS-notification opt-in. Separate decisions-needed from ambient warnings. | J8.3, notifications store |
| J8.5 | Patience guarantee | A held flight waits indefinitely; other flights keep flying. A visible "paused, waiting for you" state. | J8.3 |

**Exit:** when agents can't resolve something, the user gets one clear, trustworthy prompt addressed to them — and nothing interrupts them otherwise.

---

### Phase J9 — The story of the change
*Goal: the audit trail becomes a readable narrative, zoomable from broad strokes to a single message, ending in a human-directed landing.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| J9.1 | Story timeline | The landed/retrospective view (mockup step 06): a timeline separating **you · decisions** from **rooks · actions** from **system**, each node timestamped. A projection over the same events. | J7.1, events |
| J9.2 | Zoom to detail | Every node expands to granular messages and the raw event payload (progressive disclosure), reusing the History drill-down. | J9.1 |
| J9.3 | Landing recap | Per-repo land actions (open PR via `gh` / merge via `git`) and audited outcomes, then workspace teardown — reusing `landing-service`; presented as the final checkpoint from J5.3. | J9.1, landing-service |
| J9.4 | Browse past flights | From the Desk, browse completed flights and open any story; searchable (reuse History filters under the new framing). | J9.1 |

**Exit:** a completed flight tells its whole story — every decision attributed and timestamped, zoomable to raw detail — with landing under human direction from inside the journey.

---

### Phase J10 — Polish, retire, document
*Goal: remove the migration scaffolding, and write the docs fresh in the new vocabulary.*

| # | Task | Deliverable / acceptance | Deps |
|---|---|---|---|
| J10.1 | Retire placeholders & dead views | Delete the J2.3 placeholders and any old view components fully replaced by journey screens (e.g. the old event-log `Home`, standalone tab views). Keep `AgentRun` (ad-hoc) if wanted, reachable from the Desk. | J3–J9 |
| J10.2 | Write USER_GUIDE (fresh) | New `docs/USER_GUIDE.md` around the journey: Desk → Approach → Checkpoints → Isolation → Flight → Needs-you → Story → Landing, in the new vocabulary. | J3–J9 |
| J10.3 | Write authoring guide (fresh) | New `docs/AUTHORING.md` ("authoring an Approach": stages, roles, Done-means, checkpoints, AI-draft), keeping engine-rule accuracy. | J4, J5 |
| J10.4 | ADR for the redesign | `docs/adr/0004-journey-redesign.md` recording the reframe, the in-place nav replacement, the full rename, and AI-drafted approaches. | J1, J2 |
| J10.5 | README + DEV touch-up | Update `README.md` blurb/links and any `DEV.md` references to renamed layout. | J10.1 |

**Exit:** the journey is the app; no migration scaffolding or old surface remains; docs describe the new experience accurately.

---

## 6. Carried-forward open questions

Still-live decisions inherited from the original build plan (they survive the redesign):

1. **Configurable agent permission mode.** The engine currently fixes the mode (read-only `plan`
   outside a worktree, `acceptEdits` inside one) with a hard deny backstop and no inheritance of
   the user's global `~/.claude` grants. Whether to let users choose the mode per persona/flight,
   and whether to add an interactive `canUseTool` permission gate surfaced to a human (reusing the
   beacon UI from J8), remains open.
2. **PR host abstraction.** Landing opens PRs via the GitHub `gh` CLI (direct `merge` is
   host-agnostic). Whether to abstract the PR host (GitLab `glab`, Bitbucket, Azure DevOps, or a
   generic "push + compare URL" fallback) behind `LandingProvider` is open — not needed while
   every target repo is on GitHub.

Redesign-specific open question:

3. **Context-pressure placement.** Per-flight only (J7.4), or also a cross-flight "airfield"
   overview for when several flights are airborne at once? Deferrable; not on the critical path.

---

## 7. Suggested execution order

- **Wave 1:** J0 (tokens + primitives; J0.3 parallel-safe).
- **Wave 2:** J1 the great rename, in small per-layer PRs (J1.1 → J1.2/J1.3 → J1.4 → J1.5 → J1.6).
- **Wave 3:** J2 nav replacement (fast once J1 lands).
- **Wave 4:** J3, then J4 (J4 is the meatiest — the drafting agent; J4.1 can start during J3).
- **Wave 5:** J5 → J6 (small).
- **Wave 6:** J7 (largest journey screen; J7.2–J7.5 parallel-safe after J7.1), then J8, then J9.
- **Wave 7:** J10 polish + fresh docs once the journey reaches parity.
