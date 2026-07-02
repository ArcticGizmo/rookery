# Rookery — User Guide

Rookery is a desktop app for orchestrating AI coding agents through a workflow you define.
You describe **the work** (a spec plus the repos it touches) and **how it gets done** (an
ordered set of stages, each with agent personas, pass criteria, and human gates), press run,
and watch it execute — with a complete, append-only audit trail of everything meaningful that
happens.

This guide covers using the app. To *author* workflows in depth, see
[Workflow authoring](./WORKFLOW_AUTHORING.md). To build or hack on Rookery itself, see
[DEV.md](./DEV.md).

---

## Before you start: agent credentials

Rookery runs agents through the Claude Agent SDK, which resolves credentials from your
environment — either an `ANTHROPIC_API_KEY` or a logged-in Claude Code / `ant auth login`
profile. **Rookery never stores credentials itself.**

If no credentials resolve, the Agent run screen shows a banner telling you how to log in. You
can still define work items and workflows without credentials; you just can't run agents until
they're available.

> **Data handling:** treat agent prompts and specs like any outbound data. Don't paste
> secrets, tokens, or personal data into a spec or persona prompt — it will be sent to the
> model.

---

## The main screens

The top navigation gives you:

| Screen | What it's for |
|---|---|
| **Activity** | A live cross-run dashboard: which agents are working, on what stage, and overall context pressure. Your at-a-glance "what's happening right now". |
| **Runs** | Start a new run and browse existing ones; open any run for its live detail view. |
| **Work items** | Create and edit work items (spec + repos), with spec version history and diffs. |
| **Workflows** | Build and edit workflow definitions (the stages/personas/criteria/gates). |
| **Agent run** | Run a single agent ad-hoc against a repo — useful for trying a persona or a prompt without a full workflow. |
| **History** | Search and filter the full audit log; expand any event for its raw payload. |
| **Events** | The raw live event feed as it's appended. |

A 🔔 in the top-right surfaces notifications that need your attention (see
[Notifications](#notifications)).

---

## 1. Define a work item

A **work item** is the thing you want done: a spec and the repositories it touches.

1. Go to **Work items → New work item**.
2. Give it a **title**.
3. Write the **spec** in the markdown editor — this is what agents are briefed against, so be
   as clear as you'd be with a human engineer.
4. Attach one or more **repos**. Each needs a **name** (an alias, e.g. `api`) and a **local
   path** (the checkout on your machine — worktrees are created locally). A **remote URL** is
   optional and only used later when landing changes.

### Spec versioning

Every time you save a changed spec, Rookery cuts a new **immutable, content-hashed version** —
saving without changes creates nothing new. The editor shows the **version history**, and you
can **diff** any two versions line-by-line. Spec changes are audited, so you always know what
an agent was briefed against for a given run.

---

## 2. Build (or pick) a workflow

A **workflow** is the recipe: an ordered list of **stages**, each with agent **personas**,
**pass criteria**, and **gates**. Rookery validates a workflow (stage/persona/gate coherence)
before you can run it, and shows any problems inline in the builder.

Building good workflows is its own topic — see [Workflow authoring](./WORKFLOW_AUTHORING.md).
For your first run, a simple two-stage workflow (a **review** stage with a human gate, then a
**setup** stage) is enough to see the machinery work.

---

## 3. Start a run

A **run** is one execution of a workflow over a work item.

1. Go to **Runs**, find **Start a run**.
2. Pick a **work item** and a **workflow**.
3. Set the run options:

| Option | Meaning | Default |
|---|---|---|
| **Max iterations** | How many implementer→reviewer loops a stage may take before it fails. | 3 |
| **Max verification cycles** | How many times a failed **verification** stage may auto-route back to the start (carrying the issues as feedback) before escalating to a human. | 2 |
| **Infra template** | The template (e.g. a `sprig` template) the **setup** stage provisions isolated worktrees + docker from. Leave empty to run agents against the work item's own checkout with no isolation. | (none) |
| **Tear down on complete** | Whether to tear the run's infra down when it finishes. Note: a *successful* run defers teardown so you can land changes first (see [Landing](#5-land-the-changes)). | on |

4. Press start. The run appears in the list and its detail view goes live.

---

## 4. Watch the run and handle gates

Open a run to see its **stage progress**, the **live agent streams** (each agent's messages,
tool calls, and results), token usage, and a **context-pressure indicator** that warns when an
agent is filling its context window (output quality degrades near the top).

### Human gates

When a stage reaches a **human gate**, the run pauses in `awaiting_gate` and you get a
notification. In the run view you can:

- **Approve** — the stage passes and the run advances.
- **Reject** — the stage fails and the run fails.
- **Request changes** — the run routes back to an earlier stage (you choose which) to redo the
  work, carrying your note as feedback. This does **not** auto-edit the spec; the request is
  recorded as an event.

Every gate decision is audited with who acted and when.

### The iteration loop

Within a stage, implementer agents run, then the stage's pass criteria are evaluated (often by
a reviewer agent). If criteria fail, the stage loops — feeding the failure back to the agents —
up to **Max iterations**, then fails.

### The verification loop

A **verification** stage checks the finished feature end-to-end (e.g. runs the tests). If it
fails, instead of failing the run outright it records the issues and routes back to the first
stage with that feedback — up to **Max verification cycles**, after which it escalates to a
human gate rather than looping forever. A human "request changes" at that gate grants a fresh
verification budget.

---

## 5. Land the changes

When a run **passes**, its worktrees and branches are kept so you can land the change. In the
run view, for each impacted repo you can:

- **Open a PR** — creates a pull request (via the GitHub `gh` CLI; the repo must be on GitHub
  with `gh` installed and authenticated).
- **Merge directly** — merges the branch into its base (uses `git`, host-agnostic).

Landing is per-repo and human-directed, and every action is audited. Once you've landed (or
dismissed) the changes, you can **tear down** the run's infra from the same view.

---

## Notifications

The 🔔 menu lists things that need you:

- **Human gate awaiting** — a run is paused for your decision. Clicking it opens the run.
- **High context pressure** — an agent has crossed into the high band of its context window.
- **Update ready** — a new version of Rookery has downloaded; clicking it restarts into the
  update (see below).

Tick **Also show OS notifications** to get desktop toasts for these (asks the OS for
permission the first time). Toasts fire only for notifications that arrive *live*, not for the
backlog loaded at startup.

---

## History & audit trail

Everything meaningful is recorded in an append-only event log — it's the source of truth, and
every screen is a projection of it. The **History** browser lets you filter by actor
(system / human / agent), event-type prefix (e.g. `agent.` or `run.stage_`), run id, a free-text
search across payloads, and a time range. Expand any event for its full JSON payload. Spec
events link straight to that spec's version history and diff.

---

## Updates

Rookery updates itself from GitHub Releases. A packaged app checks on launch (and periodically),
downloads a new version in the background, and — when it's ready — shows an **"Update ready"**
notification. Click it to quit and relaunch into the new version.

> Builds are currently **unsigned**, so on Windows the first install may trigger a SmartScreen
> warning.

---

## Tips

- **Start small.** A one- or two-stage workflow with a human gate teaches you the flow before
  you invest in elaborate criteria and personas.
- **Use isolation for anything that writes.** Only provision an infra template (worktrees) when
  you want agents to actually edit code — outside a worktree, stage agents run read-only.
- **Watch context pressure.** If an agent is consistently near the top of its window, the stage
  is probably too big; split the work or tighten the spec.
- **The log doesn't lie.** If a screen looks wrong, check History — the UI only ever shows what
  the event log records.
