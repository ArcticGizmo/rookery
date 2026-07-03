# ADR 0004 — The journey redesign

**Status:** Accepted · **Date:** 2026-07-03 · Implements Phases J0–J10 of [journey.md](../journey.md)

## Context

The original build plan (now complete) produced a faithful projection of the architecture: the app
opened on an event log and asked the user to assemble *work items → workflows → runs* across seven
peer tabs. That engineering truth leaked onto the front door — the UI made you navigate tables, not
commission work.

The redesign (see [journey.md](../journey.md)) reframes the **front-of-house and the interaction
model**, while preserving the event-sourced engine underneath: the append-only audit log as source
of truth, the domain shape (brief + spec versions → an ordered approach of stages → flights), the
run/verification/human-gate state machine, the agent engine and context-pressure metric, isolated
worktrees, and PR/merge landing. The user now follows **one object — a brief — from *"what do you
want done?"* to a landed change**, holding the reins where they choose.

Four decisions shaped how we got there, and are recorded here.

## Decisions

### 1. Reframe the journey, not the engine

The redesign changes **what the user stands in front of**, not how the engine behaves. Every screen
is still a projection over the same events; the new screens (Desk → Approach → Checkpoints →
Isolation → Flight → Needs-you → Story → Landing) each earn one of five feelings — *defining work
not plumbing · your method · you hold the reins · called only when needed · the whole journey*. No
engine behaviour was changed to achieve the new front-of-house.

### 2. Full vocabulary rename, all at once

Rather than a UI-only copy layer over the old names, we renamed the domain end to end — types, IPC
channels, Pinia stores, event types, DB tables/columns, and existing views — in a dedicated phase
(J1), so every later phase built on the right names:

| Old | New |
|---|---|
| `WorkItem` | `Brief` |
| `WorkflowDef` / "workflow" | `Approach` (a recipe of **stages**, surfaced as **steps**) |
| `Run` | `Flight` (`run_id` → `flight_id`, `run.*` events → `flight.*`) |
| `Gate` (human) | `Checkpoint` |
| pass criteria | "Done means…" (UI) / `doneCriteria` (code) |
| persona | persona (code type), surfaced as **role** in the UI |

Being **pre-release** (`v0.0.0`, resettable local data) made this cheap: the DB rename is a fresh,
forward-only migration that reshapes the schema directly, with no data-preserving migration of
historical event rows.

### 3. Replace the navigation in place — no parallel shell

No feature flag and no second app shell. **J2 swapped the seven-tab nav for the journey model on day
one** (a single followed brief plus two attention lanes — *In flight* and *Needs you*), and each
screen was rebuilt in place. During the migration, unbuilt destinations showed honest
"coming here next" **placeholders** rather than dead ends. The app was briefly half-migrated — an
accepted, temporary state. The placeholders and the fully-replaced old views (the event-log home,
the standalone tab views) were **retired in J10.1** once the journey reached parity.

### 4. Approaches are AI-drafted from the brief

The primary path to an approach is an **agent that drafts it from the brief's spec** — proposing
steps, roles, and a starting "Done means…", validated against the approach schema and fully
editable. Saved **templates** remain the explicit fallback / starting base. This adds an agent call,
a streaming/loading state, and a typed failure path to the approach screen, in exchange for a
tailored starting point over a blank canvas.

## Consequences

- **One vocabulary, everywhere.** Code, IPC, DB, events, and UI all speak brief / approach / flight /
  checkpoint / "Done means…", so there's no translation layer to keep in sync — but the rename was a
  hard cut, only affordable pre-release.
- **A clean journey surface.** The Desk, approach authoring, checkpoint rail, isolation screen, live
  flight, the beacon, the story, and landing are the app; the migration scaffolding is gone (J10.1).
- **The engine is unchanged.** Everything above is presentation and vocabulary over the existing
  event-sourced core — the run/verification/checkpoint state machine, agent engine, infra, and
  landing behave exactly as before. Their ADRs ([0001](./0001-stack.md)–[0003](./0003-infra-provider.md))
  still stand.
- **Fresh docs.** The user guide and approach-authoring guide were rewritten around the journey
  ([USER_GUIDE.md](../USER_GUIDE.md), [AUTHORING.md](../AUTHORING.md)); `plan.md` and the previous
  UX guides were removed.
- **Carried-forward open questions remain open** (journey.md §6): a configurable agent permission
  mode + interactive permission gate, a PR-host abstraction beyond GitHub `gh`, and whether
  context-pressure gets a cross-flight overview.
