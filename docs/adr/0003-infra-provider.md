# ADR 0003 — Infrastructure via an `InfraProvider` port (sprig v1)

**Status:** Accepted · **Date:** 2026-07-02 · Implements Phase 5 of [plan.md](../plan.md)

## Context

A run may touch multiple repos and needs an isolated place to work so concurrent runs don't
collide on branches, files, or ports. The plan (§1) locked the approach: an `InfraProvider`
interface with a `SprigProvider` that shells out to the `sprig` CLI as the v1 implementation,
keeping a native backend possible later without touching the engine (open question #1).

Two things were decided during implementation:

1. **Copy sprig's functionality, or depend on it?** sprig is a separate .NET/Velopack app
   (`npm i -g @ArcticGizmo/sprig`), not a library — "copying" it would mean reimplementing git
   worktrees, `.sprig` parsing, slot/port allocation, and docker-compose lifecycle in TS. That
   is a project in itself and re-litigates edge cases sprig already handles. Since sprig is our
   own tool, dependency risk is low. **Decision: depend on the sprig CLI behind the port.**
2. **Where does a run get its template + teardown flag?** On the **run start form**
   (`StartRunInput.infraTemplate` / `teardownOnComplete`) — run-scoped and flexible, with no
   workflow-builder or work-item schema changes.

## Decision

- **`InfraProvider`** (`src/main/services/infra/infra-provider.ts`) is the port the engine
  talks to: `available`, `create`, `up`, `down`, `info`, `status`, `remove`. `info`/`status`
  return absence (`null` / `'absent'`) rather than throwing for a missing instance.
- **`SprigProvider`** shells out to `sprig instance …`, always non-interactively (`--yes`), and
  parses `instance info --json`. The CLI runner is injected so the provider is unit-testable
  without sprig installed. Missing binary → `InfraToolingMissingError`.
- **`StubProvider`** is an in-memory fake for tests and infra-free dev.
- Provider is chosen by **`ROOKERY_INFRA_PROVIDER`** (`sprig` default · `stub` · `none`) via
  `createInfraProvider()`.
- **`InfraService`** wraps the provider, turning provisioning/teardown into audited operations
  (`infra.provisioning` / `infra.up` / `infra.down` / `infra.failed`) and centralizing the
  "no provider / not available" degradation.
- The engine provisions on a **`setup`** stage: it derives a deterministic instance name from
  the run id (`instanceNameForRun`), points later-stage agents at the worktree cwd (and lets
  them edit autonomously — `bypassPermissions` — since the worktree is isolated), and tears the
  instance down when the run reaches a terminal state (if `teardownOnComplete`). The worktree
  cwd is recovered from live provider state after a human-gate pause.

## Consequences

- The app depends on the `sprig` CLI being on PATH **only when a run requests a template**.
  A run with no template provisions nothing and runs agents against the work item's checkout.
- If sprig is missing/unavailable, the setup stage fails with an audited `infra.failed` — the
  run fails cleanly rather than silently skipping isolation.
- A native `InfraProvider` can be added later (open question #1) with zero engine changes.
- The run view (Phase 5.5) reads live status via `runs:infra`, falling back to the last
  `infra.up` event so worktree paths stay visible after teardown.
