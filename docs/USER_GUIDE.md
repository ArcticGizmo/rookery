# Rookery — User Guide

Rookery turns *"what do you want done?"* into a landed change. You commission work as a **brief**,
shape **how** it's tackled, mark where you want to hold the reins, and send it into flight. Agents
(the **rooks**) do the work inside an isolated copy of your repos; Rookery calls you only when a
decision is genuinely yours, and tells the whole story afterwards.

This guide walks the journey end to end:

> **[The Desk](#the-desk)** → **[Shape the approach](#shape-the-approach)** →
> **[Place your checkpoints](#place-your-checkpoints)** → **[Send it into isolation](#send-it-into-isolation)** →
> **[Watch the flight](#watch-the-flight)** → **[Moments that need you](#moments-that-need-you)** →
> **[The story](#the-story)** → **[Landing](#landing)**

---

## The vocabulary

A few words carry the whole model. They're worth learning once.

| Word | What it means |
|---|---|
| **Brief** | The work you're commissioning — the outcome, the constraints, and what *"done"* looks like, plus the repos it touches. |
| **Approach** | *How* the brief gets tackled: an ordered set of **steps**, each worked by one or more **roles** (Reviewer, Implementer, …), with a first-class **"Done means…"**. (In the flight, each step reads as a **milestone**.) |
| **Checkpoint** | A place you've asked the flight to **hold** for your decision. Held checkpoints wait indefinitely. |
| **Flight** | One run of an approach over a brief, inside an isolated workspace. |
| **Rook** | An agent doing the work during a flight. |
| **The story** | The flight's audit trail, told as a readable narrative. |

Nothing runs until you send it, and every meaningful thing that happens is recorded — the screens
you see are all views onto that same audit log.

---

## The Desk

The Desk is the front door. It opens on a single prompt — **"What do you want done?"** — and four
live lanes:

- **Needs you** — decisions that are genuinely yours (a held checkpoint, an escalation). These lead.
- **Heads up** — ambient warnings worth a glance but needing no action (e.g. an agent under high
  context pressure).
- **In flight** — briefs currently flying. A held flight reads as **"held for you"**; a running one
  shows its current step.
- **Past flights** — completed flights, searchable by title or outcome; each opens its **story**.

Press **＋ New brief** to begin.

### Writing a brief

A brief is where you say what you want in plain language — the outcome, any constraints, and how
you'll know it's done. Then **attach the repos** it touches: give each a name and its local path
(and an optional remote for opening PRs later). Paths are validated inline.

Your brief text is saved as a **content-hashed, audited spec version** — edit it later and a new
version is cut, with the full history preserved. When it reads right, continue with
**Shape the approach →**.

---

## Shape the approach

The approach is *how* the work gets done. You don't have to write it from a blank page:

- **◆ Draft from my brief** (recommended) — an agent reads your brief and proposes a tailored
  approach: a sequence of **steps**, the **roles** that work each one, and a starting **"Done
  means…"**. You'll see it think, then get an editable draft. If drafting can't complete, you're
  told plainly and can fall back to a template.
- **Saved templates** — start from a known-good approach instead, and edit from there.

### Editing the steps

Each step is a card: a title, a short description, and the roles assigned to it. You can add,
remove, reorder, and reword steps and their roles. Invalid combinations (an empty approach, a step
with no role) are flagged in plain language before you can continue.

### "Done means…"

This is the approach's verification block — what makes the work *actually* done, authored as
outcomes rather than jargon:

- **the tests pass**,
- **a reviewer approves each phase**,
- **you approve the result**.

One rule to keep in mind, surfaced as guidance on the screen: code can only be judged *after it
exists*, so verification that inspects the result belongs *after* the step that produces it.

The approach is saved against your brief; returning to it reopens exactly what you left.

---

## Place your checkpoints

This is where you hold the reins. Your approach is drawn as a vertical **rail**, with a
**Hold / Auto** toggle at every seam:

- **Hold** drops a **checkpoint** — the flight will stop there and wait for you.
- **Auto** lets the flight continue on its own.

Sensible holds ship by default (after a review, after the plan, and before anything lands), and the
final **"how it lands"** checkpoint is a hold by default. A held checkpoint **waits indefinitely** —
there's no timer, and nothing advances past a decision that's yours.

---

## Send it into isolation

Before a flight begins, Rookery shows you the safety guarantee made concrete: your real repos stay
**untouched** while the work happens in a **sealed copy** — an isolated workspace of worktrees (and
containers, when your workspace template needs them). The screen restates where your first
checkpoint sits.

Here you choose:

- the **isolated workspace** to fly in, and
- flight **options** with sensible defaults — how many iterations a step may take, how many
  verification cycles to allow, and whether to tear the workspace down when the flight ends.

If Rookery can't resolve your agent credentials, it explains how to log in first — **Begin** stays
disabled until it can. When you're ready, **◆ Begin the flight** commits the brief to flight and
drops you onto the live view.

---

## Watch the flight

The live view reads as a journey, not a log.

- **Header** — the brief's title, *phase X of N*, elapsed time, and the repo and checkpoint counts,
  with a status chip (*in flight*, *needs you*, *landed*, …).
- **Right now** — who's working this moment (roles), and a **context-pressure** meter with
  *healthy / warming / high* bands, so you can see when an agent is running low on room to think.
- **The journey** — each step is a **milestone** (done, active, pending, needs-you, or failed) with
  a one-line human summary. Open any milestone to **zoom into the granular transcript**: the agents'
  messages, tool calls, edits (with +/−), and reviewer notes.
- **Changes so far** — a running summary of files touched across the workspace, with additions and
  deletions.

While the rooks work, the view stays quiet and tails live. If you need to stop a flight, **Terminate**
is always available. When a flight is holding for you, it shows a calm **paused · waiting for you**
state — see next.

---

## Moments that need you

When a decision is genuinely yours, Rookery raises **one calm beacon** addressed to you — and
nothing interrupts you otherwise. The beacon explains, in plain language, *why this is yours to
decide*, offers a collapsible **"what I tried"** built from what the rooks attempted, and shows the
artifacts for your review.

You have three levers:

- **Approve a direction** — accept, and let the flight continue.
- **Request changes** — send it back with a note; optionally choose an earlier step to **route back**
  to and rework from there.
- **Reject** — stop the flight here.

A beacon appears for any of three reasons, all wearing the same calm card:

1. a **held checkpoint** you placed,
2. a **verification escalation** — the rooks couldn't get it to pass within their retry budget, or
3. a **max-iteration** stall.

**The patience guarantee.** A held flight **waits indefinitely** — nothing times out — while your
**other flights keep flying**. The **Needs you** lane on the Desk and the 🔔 bell both route straight
to the specific beacon; decisions are kept separate from ambient warnings, and OS notifications are
opt-in.

---

## The story

When a flight lands (or ends any other way), its audit trail becomes a readable **story** — the same
append-only events, told as a timeline that separates three voices:

- **you · decisions** — what you approved, requested, routed back, or landed,
- **rooks · actions** — what the agents produced,
- **system** — the flight's lifecycle, verification, and workspace events.

Every beat is timestamped, and any beat **zooms in** to its granular messages and the raw event
payload underneath — broad strokes down to a single message. Reach a story from a live flight's
header (**The story →**) or from the Desk's **Past flights** lane, which is searchable.

---

## Landing

Landing is the closing act, and it's yours to direct. On a flight that's passed, the **How it landed**
panel lists each impacted repo and lets you land it your way:

- **Open PR** — push the work and open a pull request (via `gh`), or
- **Merge** — merge the change directly (via `git`).

Each landing is audited and shows up as a beat in the story, and repos that have already landed are
marked. When you're done, **Tear down workspace** removes the isolated copy. Your original repos were
never touched — only the change you chose to land reaches them.

---

## In short

Commission a **brief** → shape an **approach** and say what **"done means…"** → drop **checkpoints**
where you want to hold → send it into an **isolated workspace** → **watch the flight** as milestones →
answer the **beacon** when a decision is yours → read **the story** → **land** it on your terms. You
hold the reins the whole way, and the audit log remembers everything.
