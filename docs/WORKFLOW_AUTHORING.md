# Workflow Authoring Guide

A **workflow** defines *how* a work item gets done: an ordered list of **stages**, each with
agent **personas**, **pass criteria**, and **gates**. This guide explains each building block,
how the engine executes them, and the rules a workflow must satisfy to run. For the end-to-end
app walkthrough, see the [User Guide](./USER_GUIDE.md).

Build workflows in **Workflows → New workflow**. The builder validates as you go and blocks
running an invalid workflow; the same rules run in the engine before a run starts.

---

## The execution model in one paragraph

A run walks the stages in order. For each stage it runs the stage's personas (as agents),
then evaluates the stage's **pass criteria**. If the criteria pass and the stage has a **human
gate**, the run pauses for approval; otherwise it advances. If criteria fail, the stage loops —
feeding the failures back to the agents — up to **max iterations**, then fails the run. A
**verification** stage is special: on failure it routes the whole run back to the start with the
issues as feedback, up to a budget, then escalates to a human. Every transition is audited.

---

## Stages

A stage has a **name**, a **type**, and lists of personas, pass criteria, and gates. Order is
just the position in the list.

### Stage types

| Type | Intended role | Personas required? |
|---|---|---|
| `review` | Review the spec or prior output. | Yes |
| `plan` | Produce a plan of work. | Yes |
| `setup` | Provision isolated infra (worktrees + docker) for the run. See [Setup & infra](#setup-stages--infrastructure). | No |
| `implementation` | Do the actual work (write code). | Yes |
| `verification` | Check the finished feature end-to-end. See [Verification](#verification-stages). | Yes |
| `custom` | Anything else. | No |

Stage type drives two things: whether personas are **required** (agent-driven types must have at
least one), and special engine behavior for `setup` and `verification`.

### Read-only vs. editing agents

Stage agents run **read-only** (`plan` permission mode — no file edits, no shell) **until** a
`setup` stage provisions an isolated worktree. After that, implementer agents run with
`acceptEdits` **inside the worktree**: file edits auto-apply, but shell/network stay gated by
the persona's allow-list and a hard security deny backstop. Agents never run with
`bypassPermissions` by default.

**Implication:** if you want agents to actually change code, put a `setup` stage (with an infra
template chosen at run start) *before* your implementation stages. Without it, everything is
read-only.

---

## Personas

A **persona** is an agent configuration:

| Field | Meaning |
|---|---|
| **name** | Display name. |
| **role** | Short role label (e.g. "Tech Lead", "Implementer"). |
| **systemPrompt** | The agent's instructions. **Required** for the persona to be usable. |
| **model** | Optional model id; omit to use the SDK default. |
| **effort** | Optional reasoning effort: `low` / `medium` / `high` / `xhigh` / `max`. |
| **allowedTools** | Optional allow-list of tool names the agent may use (e.g. `Read`, `Grep`, `Bash`). |
| **disallowedTools** | Optional deny-list. |
| **mcpServers** | Optional BYO MCP server config, passed to the SDK verbatim. |

The tooling fields are all optional and degrade gracefully when absent. Keep allow-lists tight:
a reviewer usually only needs `Read`, `Grep`, `Glob`; only an implementer or tester needs `Bash`.

> Multiple personas in one stage all run, and their combined output feeds the stage's criteria —
> useful for "N reviewers must agree" patterns (see `personas_agree`).

---

## Pass criteria

Pass criteria decide whether a stage succeeds. **A stage with no criteria passes vacuously.**
All of a stage's criteria must pass for the stage to pass. There are four types:

| Type | How it's evaluated |
|---|---|
| `manual` | Always "passes" automatically — it defers the real decision to a **human gate** on the stage. Use it for stages whose outcome only a person can judge. |
| `reviewer_approves` | A built-in reviewer agent judges this stage's agent output against the spec and replies `APPROVE` or `REJECT` (+ required changes). Requires ≥1 persona in the stage. |
| `personas_agree` | A reviewer judges whether the stage's personas **agree** no further changes are needed (`AGREE` / `DISAGREE`). Requires ≥1 persona. |
| `tests_pass` | A built-in tester agent runs the project's test suite in the working directory and replies `PASS` or `FAIL`. Runs with `acceptEdits` (still under the deny backstop) so it can execute the suite. |

Verdicts are read **conservatively**: an errored checker or an unclear reply counts as a
**fail**, and the detail is recorded. Failure detail is fed back to the stage's agents on the
next iteration.

---

## Gates

A **gate** halts a stage until it's satisfied.

- **human** — the run pauses in `awaiting_gate` and waits for a person to **approve**,
  **reject**, or **request changes** (routing back to an earlier stage). Approvals/rejections
  are audited with who and when.
- **automated** — satisfied by the stage's pass criteria. A stage with an automated gate
  **must have at least one pass criterion** (otherwise there's nothing to satisfy it).

A stage can have both: criteria run first, then a human gate for the final sign-off. That's the
canonical "agents propose, criteria check, human approves" pattern.

---

## The iteration loop

Within a stage:

1. All personas run (as agents).
2. The stage's pass criteria are evaluated.
3. If **all pass** → the stage passes (pausing at a human gate if present).
4. If **any fail** → if the iteration count is below **max iterations** (a run option, default
   3), the stage re-runs with the failure details as feedback; otherwise the stage — and the
   run — fails.

Set max iterations per run when you start it.

---

## Verification stages

A `verification` stage validates the finished feature end-to-end (typically with a `tests_pass`
criterion). Its failure behavior is special:

- On failure it records the issues and **routes the run back to the first stage**, carrying
  those issues as feedback — rather than failing outright.
- This is bounded by **max verification cycles** (a run option, default 2). Once the budget is
  spent, instead of looping forever it **escalates to a human gate**: approve to accept as-is,
  reject to fail the run, or request changes to loop back with a **fresh** budget.

This prevents a silent verify→fix death cycle that burns tokens with no human in the loop.

---

## Setup stages & infrastructure

A `setup` stage provisions the run's isolated environment so concurrent runs don't collide and
so agents can safely edit code:

- At run start you pick an **infra template** (e.g. a `sprig` template). The setup stage uses it
  to create per-repo git worktrees and bring up docker infra.
- After setup, stage agents run **inside the worktree** (and can edit files).
- If you start a run with **no** infra template, the setup stage is a no-op and agents run
  read-only against the work item's own checkout.

Infra provisioning, up/down, and failures are all audited, and the run view shows live infra
status. See [DEV.md → Infrastructure](./DEV.md#infrastructure-worktrees--docker) for provider
details (`sprig` / `stub` / `none`).

---

## Validation rules

A workflow must satisfy all of these before it can run (the builder shows violations inline):

- At least **one stage**.
- **Unique** stage ids and stage names.
- Agent-driven stage types (`review`, `plan`, `implementation`, `verification`) have **at least
  one persona**.
- Every persona has a **non-empty system prompt**, and unique ids within a stage.
- Unique gate ids and pass-criterion ids within a stage.
- A stage with an **automated gate** has **at least one pass criterion**.
- `reviewer_approves` / `personas_agree` criteria are only used in stages that **have personas**
  (they judge agent output).

---

## A worked example

A typical "spec → build → verify → ship" workflow:

1. **Review spec** (`review`) — a Tech Lead persona reviews the spec.
   - Criterion: `reviewer_approves`. Gate: `human` (you sign off the plan).
2. **Setup** (`setup`) — provisions worktrees from the chosen infra template. No personas.
3. **Implement** (`implementation`) — an Implementer persona (with `Bash`, `Read`, `Edit`, …)
   writes the code inside the worktree.
   - Criterion: `reviewer_approves` (a reviewer checks the diff against the spec).
4. **Verify** (`verification`) — a Tester persona.
   - Criterion: `tests_pass`. On failure, routes back to stage 1 with the issues (up to the
     verification budget), then escalates to a human.

Start this run with an infra template selected (so stages 3–4 can edit and test), `max
iterations` and `max verification cycles` tuned to taste, and land the change per-repo once the
run passes.

---

## Authoring tips

- **Gate early, automate later.** Begin with `manual` criteria + human gates to see the flow,
  then replace them with `reviewer_approves` / `tests_pass` as you trust the loop.
- **Right-size stages.** A stage that asks for too much bloats agent context (watch the
  pressure indicator) and makes the reviewer's job vague. Prefer several focused stages.
- **Tight tool allow-lists.** Give each persona only the tools its job needs; the deny backstop
  and worktree isolation are safety nets, not a substitute for least privilege.
- **Put `setup` before anything that writes.** No worktree ⇒ read-only agents.
