<script setup lang="ts">
import { useTheme } from '@renderer/composables/use-theme'
import { Button } from '@renderer/components/ui/button'
import { BeaconCard, Chip, MilestoneNode, MonoLabel, StatusDot } from '@renderer/components/journey'

// J0.2 — a gallery of the journey primitives, rendered in both themes.
const { theme, toggle } = useTheme()
</script>

<template>
  <div class="mx-auto flex max-w-4xl flex-col gap-8">
    <header class="flex items-start justify-between gap-4">
      <div class="flex flex-col gap-1">
        <MonoLabel class="text-primary">Primitives · Phase J0.2</MonoLabel>
        <h1 class="text-2xl font-bold tracking-tight">Journey component kit</h1>
        <p class="text-sm text-muted-foreground">The reusable pieces the journey screens are built from.</p>
      </div>
      <button
        type="button"
        class="mono-label rounded-full border border-border bg-surface px-4 py-2 text-ink-dim hover:border-border-strong hover:text-foreground"
        @click="toggle"
      >
        {{ theme === 'dark' ? '☾ Dark' : '☀ Light' }}
      </button>
    </header>

    <section class="flex flex-col gap-3">
      <MonoLabel>Chip</MonoLabel>
      <div class="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-5">
        <Chip tone="pass" led>you approved</Chip>
        <Chip tone="active" led>building</Chip>
        <Chip tone="pending">waiting</Chip>
        <Chip tone="beacon" led>needs you</Chip>
        <Chip tone="block" led>failed</Chip>
      </div>
    </section>

    <section class="flex flex-col gap-3">
      <MonoLabel>Status dot</MonoLabel>
      <div class="flex flex-wrap items-center gap-6 rounded-lg border border-border bg-card p-5">
        <span class="flex items-center gap-2 text-sm"><StatusDot tone="pass" /> done</span>
        <span class="flex items-center gap-2 text-sm"><StatusDot tone="active" pulse /> live</span>
        <span class="flex items-center gap-2 text-sm"><StatusDot tone="pending" /> pending</span>
        <span class="flex items-center gap-2 text-sm"><StatusDot tone="beacon" pulse /> needs you</span>
        <span class="flex items-center gap-2 text-sm"><StatusDot tone="block" /> blocked</span>
      </div>
    </section>

    <section class="flex flex-col gap-3">
      <MonoLabel>Milestone timeline</MonoLabel>
      <div class="rounded-lg border border-border bg-card p-5">
        <MilestoneNode state="done" line>
          <div class="flex items-center gap-2">
            <h4 class="font-semibold">Reviewed the brief</h4>
            <Chip tone="pass" led>you approved</Chip>
          </div>
          <p class="mt-1 text-sm text-muted-foreground">3 findings — 2 folded in, 1 dismissed.</p>
        </MilestoneNode>
        <MilestoneNode state="active" line pulse>
          <div class="flex items-center gap-2">
            <h4 class="font-semibold">Building — phase 2 of 4</h4>
            <Chip tone="active" led>live</Chip>
          </div>
          <p class="mt-1 text-sm text-muted-foreground">rook-impl is wiring the gateway middleware.</p>
        </MilestoneNode>
        <MilestoneNode state="pending">
          <div class="flex items-center gap-2">
            <h4 class="font-semibold text-ink-faint">Verify end-to-end</h4>
            <Chip tone="pending">waiting</Chip>
          </div>
        </MilestoneNode>
      </div>
    </section>

    <section class="flex flex-col gap-3">
      <MonoLabel>Beacon card</MonoLabel>
      <BeaconCard title="Rookery needs a decision" subtitle="flight paused · phase 3">
        <template #actions>
          <Chip tone="beacon" led>needs you</Chip>
        </template>
        <p class="text-sm">
          The implementer and reviewer disagree on whether to change the public response shape.
          <span class="text-beacon">That's a product call, not a code one</span> — so I'm handing it to you.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <Button>Add the header to all responses</Button>
          <Button variant="outline">Request changes…</Button>
          <Button variant="ghost">Send back to planning</Button>
        </div>
      </BeaconCard>
    </section>

    <section class="flex flex-col gap-3">
      <MonoLabel>Buttons (retuned shadcn)</MonoLabel>
      <div class="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-5">
        <Button>Begin the flight</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
      </div>
    </section>
  </div>
</template>
