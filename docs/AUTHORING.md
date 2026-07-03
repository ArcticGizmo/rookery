# Authoring an Approach

An **approach** is *how* a brief gets tackled: an ordered set of **steps**, each worked by one or
more **roles**, with a first-class **"Done means…"** and the **checkpoints** where you hold the
reins. This guide is for shaping a good one — whether you start from an AI draft, a template, or a
blank canvas — and it stays honest about the rules the engine actually enforces, so what you author
is what runs.

> New to the product first? Read the **[User Guide](./USER_GUIDE.md)** for the journey end to end.
> This document goes a level deeper into the approach itself.

---

## Start from a draft

You rarely author an approach from scratch:

- **◆ Draft from my brief** — an agent reads the brief's spec and proposes a tailored approach:
  steps, the roles on each, and a starting "Done means…". The proposal is **validated against the
  approach schema** before you see it, and it's fully **editable** — the draft is a starting point,
  not a contract. If drafting fails, you're told plainly and can fall back to a template.
- **Templates** — start from a known-good approach and edit from there.

Everything below applies however you started: the AI draft, a template, and hand-authoring all
produce the same structure and obey the same rules.

---

## Anatomy of an approach

| Part | What it is |
|---|---|
| **Name / description** | Identify the approach. The name is required. |
| **Steps** (`stages`) | The ordered work. Order is just their position in the list. |
| **Roles** (`personas`) | The agents that work a step — a name, a role label, and instructions. |
| **"Done means…"** (`doneCriteria`) | What makes a step *actually* done — evaluated automatically. |
| **Checkpoints** | Where a step **holds**: for a person (*human*) or for its criteria (*automated*). |
| **Landing** | The final "how it lands" checkpoint — held by default. |

---

## Steps and their types

Each step has a **type** that signals its intent. Four of them are agent-driven and **must** have at
least one role assigned; the other two don't require one:

| Type | Purpose | Needs a role? |
|---|---|---|
| `review` | Read and critique the brief or prior work. | **Yes** |
| `plan` | Produce a plan of attack. | **Yes** |
| `implementation` | Do the work — write the code/change. | **Yes** |
| `verification` | Check the result end to end (see the route-back rule below). | **Yes** |
| `setup` | Prepare the workspace (e.g. unlock edits on a branch). | No |
| `custom` | Anything else. | No |

**Ordering matters, because the engine runs steps in list order.** Code can only be judged *after it
exists*, so a `verification` step (or any "Done means…" that inspects the result) belongs **after**
the `implementation` step that produces it — never before. The authoring screen surfaces this as
guidance; the engine honours the order you give.

---

## Roles (personas)

A role is one agent's brief. It carries:

- **name** and **role** label (e.g. *Reviewer*, *Implementer*, *Architect*) — both required; the role
  label is what shows up in the flight's "right now" strip and the story.
- **instructions** (`systemPrompt`) — **required** for any role on a `review` / `plan` /
  `implementation` / `verification` step; a role with no instructions is a validation error.
- optional **model** and reasoning **effort**, and optional **tool** allow/deny lists and BYO MCP
  servers — all degrade gracefully to sensible defaults when unset.

### What every agent gets, no matter the role

A hard **security backstop** is applied to *every* orchestrated agent and cannot be widened by a
role's allow-list:

- network egress and host-escape primitives are denied — `curl`, `wget`, `ssh`, `scp`, `sftp`,
  `sudo`, `nc`, `telnet`, `docker`, `git push`, and `WebFetch`;
- agents **do not** inherit your personal `~/.claude` permission grants or MCP servers;
- all subagent activity is captured in the audit log.

Agents also run **read-only (plan mode) outside a worktree** and gain edit permission only **inside**
the isolated workspace — so nothing touches your real repos regardless of how a role is configured.

---

## "Done means…" — the pass criteria

A step's "Done means…" is a list of criteria the engine evaluates automatically when the step's
agents finish. A step with **no** criteria **passes vacuously** — fine for a step you gate with a
human checkpoint instead. The four kinds:

| Criterion | How it's judged |
|---|---|
| `tests_pass` | A tester agent runs the project's suite in the workspace and reports **PASS / FAIL**. |
| `reviewer_approves` | A reviewer agent judges the work against the spec — **APPROVE / REJECT** with the changes needed. |
| `personas_agree` | Several personas' outputs are checked for agreement that nothing further is needed — **AGREE / DISAGREE**. |
| `manual` | Always "passes" the automated check — it **defers the decision to a human checkpoint**. |

Verdicts are read conservatively: an ambiguous or missing verdict fails, and a reject/fail token
anywhere on the deciding line wins over an approve/pass. `reviewer_approves` and `personas_agree`
**require at least one role** in the step (there must be output to judge) — the validator enforces
this.

---

## Checkpoints — where you hold the reins

A checkpoint halts a step until it's satisfied. Two kinds:

- **Human** — the flight **stops and waits for a person**. This is the *Hold* you drop on the rail.
  It waits **indefinitely**; nothing times out, and your other flights keep flying.
- **Automated** — satisfied by the step's "Done means…". An automated checkpoint therefore
  **requires at least one criterion** to evaluate (validation blocks an automated checkpoint with no
  criteria).

On the rail, **Hold** adds a human checkpoint to a step and **Auto** removes it. Good defaults hold
after a review, after the plan, and before anything lands. The final **landing** checkpoint holds by
default (`landing.hold = true`) so a human always directs how the change reaches `main`.

---

## How the engine runs your approach

Understanding the run loop is what makes an approach *good* rather than merely valid:

1. **In order, one step at a time.** The engine enters each step and runs its roles.
2. **Iteration.** A step may retry up to the flight's **max iterations** before it's considered
   failed.
3. **On pass** → if the step has a **human checkpoint**, the flight **pauses** for your decision;
   otherwise it advances to the next step.
4. **Verification steps are special.** When a `verification` step fails, the engine doesn't fail the
   flight — it **routes back to the first step**, carrying the issues as feedback, and tries again.
   This auto-loop is bounded by the flight's **max verification cycles**; once that budget is spent,
   it **escalates to a human checkpoint** instead of burning tokens in a fix→verify death spiral.
5. **A non-verification step that fails** ends the flight as *failed*.
6. **Your checkpoint decision** resumes the flight:
   - **Approve** → advance,
   - **Reject** → the flight stops here (failed),
   - **Request changes** → route back to an earlier step you choose; that step and everything after
     it reset and re-run (a fresh iteration).

Max iterations and max verification cycles are chosen per-flight on the launch screen, not in the
approach — but you author *around* them: keep steps focused so an iteration is meaningful, and put a
single `verification` step late so the route-back loop has a clear target.

---

## What the validator checks

Saving or running an approach requires it to be structurally sound. The validator reports **all**
issues at once, in plain language:

- at least **one step**; **unique** step ids and names;
- every agent-driven step (`review` / `plan` / `implementation` / `verification`) has **at least one
  role**, and every role has **instructions**;
- unique role ids, checkpoint ids, and criterion ids within a step;
- an **automated checkpoint** has at least one criterion to evaluate;
- `reviewer_approves` / `personas_agree` criteria have **at least one role** in their step.

---

## A worked example

The classic shape, and a good starting draft:

| # | Step | Type | Roles | "Done means…" | Checkpoint |
|---|---|---|---|---|---|
| 1 | Review the brief | `review` | Reviewer(s) | `reviewer_approves` | **Hold** — approve the reviewed brief |
| 2 | Plan the work | `plan` | Architect | `manual` | **Hold** — approve the plan |
| 3 | Implement | `implementation` | Implementer | *(none — gated by verify)* | Auto |
| 4 | Verify end to end | `verification` | Tester / Reviewer | `tests_pass`, `reviewer_approves` | Auto → escalates if it can't pass |
| — | Landing | — | — | — | **Hold** — open a PR or merge |

Read it as a sentence: *review and approve → plan and approve → build → verify (looping back with
feedback until it passes or asks for you) → you land it.* Verification sits **after**
implementation, the holds fall where a human judgement genuinely matters, and everything between
runs unattended.

---

## Tips

- **Fewer, clearer steps** beat many tiny ones — each step is an iteration boundary and a place the
  story tells a beat.
- **Hold sparingly.** A checkpoint at every seam defeats "silence while it works." Hold where a
  decision is genuinely yours; let the rest run on Auto.
- **Put verification last** (or late), as a single step, so the route-back loop has one clear target.
- **Give roles real instructions.** The `systemPrompt` is the whole brief for that agent; vague
  instructions produce vague work.
- **Let the draft do the first pass**, then prune and sharpen. Editing a tailored proposal is faster
  than authoring from empty.
