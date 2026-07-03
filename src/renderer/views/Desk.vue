<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterLink } from 'vue-router'
import { briefsInFlight, isDecision, needsYou } from '@shared/attention'
import type { InFlightStatus } from '@shared/attention'
import { useEventsStore } from '@renderer/stores/events'
import { useBriefsStore } from '@renderer/stores/briefs'
import { Button } from '@renderer/components/ui/button'
import { Chip, MonoLabel, StatusDot } from '@renderer/components/journey'

// The Desk — the journey's front door. Two live lanes (In flight, Needs you)
// derived from the event log, and the entry point for new work. The brief
// composer proper arrives in Phase J3; for now "New brief" opens the editor.
const eventsStore = useEventsStore()
const briefsStore = useBriefsStore()
const { events } = storeToRefs(eventsStore)
const { items: briefs } = storeToRefs(briefsStore)

onMounted(() => {
  void eventsStore.init()
  void briefsStore.load()
})

const inFlight = computed(() => briefsInFlight(events.value))
// Decisions that are genuinely yours lead; ambient warnings stay quieter (J8.4).
const decisions = computed(() => needsYou(events.value).filter((n) => isDecision(n.kind)))
const warnings = computed(() => needsYou(events.value).filter((n) => !isDecision(n.kind)))

function briefTitle(briefId: string | null): string {
  if (!briefId) return 'Untitled brief'
  return briefs.value.find((b) => b.id === briefId)?.title ?? 'Untitled brief'
}

const statusTone: Record<InFlightStatus, 'pending' | 'active' | 'beacon'> = {
  pending: 'pending',
  running: 'active',
  awaiting_checkpoint: 'beacon'
}
const statusLabel: Record<InFlightStatus, string> = {
  pending: 'queued',
  running: 'in flight',
  awaiting_checkpoint: 'needs you'
}

// A held flight reads as calmly paused on its glance card — patiently waiting,
// not stalled (J8.5). The "Needs you" lane above is where the decision is made.
function laneLabel(f: { status: InFlightStatus; needsYou: boolean }): string {
  return f.needsYou ? 'held for you' : statusLabel[f.status]
}
</script>

<template>
  <div class="mx-auto flex max-w-4xl flex-col gap-10">
    <!-- Commissioning prompt (composer lands in J3) -->
    <section class="flex flex-col gap-4">
      <div class="flex items-end justify-between gap-4">
        <div class="flex flex-col gap-1">
          <MonoLabel class="text-primary">Your desk</MonoLabel>
          <h1 class="text-3xl font-bold tracking-tight text-balance">What do you want done?</h1>
        </div>
        <RouterLink to="/brief/new"><Button size="lg">＋ New brief</Button></RouterLink>
      </div>
      <p class="max-w-prose text-sm text-muted-foreground">
        Commission work as a <strong class="font-semibold text-foreground">brief</strong> — the
        outcome, the constraints, what “done” looks like — then shape how it's tackled and hold
        the reins where you want. Nothing runs until you send it.
      </p>
    </section>

    <!-- Needs you: decisions that are genuinely yours (J8.4) -->
    <section v-if="decisions.length" class="flex flex-col gap-3">
      <MonoLabel class="text-beacon">◆ Needs you · {{ decisions.length }}</MonoLabel>
      <ul class="flex flex-col gap-2">
        <li v-for="item in decisions" :key="`${item.flightId}-${item.kind}-${item.ts}`">
          <RouterLink
            :to="`/flight/${item.flightId}`"
            class="flex items-center gap-3 rounded-xl border border-beacon bg-beacon-wash/60 px-4 py-3 transition-colors hover:bg-beacon-wash"
          >
            <StatusDot tone="beacon" pulse />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-semibold">{{ item.title }}</span>
              <span class="block truncate text-xs text-ink-dim">{{ item.detail }}</span>
            </span>
            <span class="mono-label shrink-0 text-beacon">resolve →</span>
          </RouterLink>
        </li>
      </ul>
    </section>

    <!-- Heads up: ambient warnings — worth a glance, no action required (J8.4) -->
    <section v-if="warnings.length" class="flex flex-col gap-2">
      <MonoLabel class="text-ink-faint">Heads up · {{ warnings.length }}</MonoLabel>
      <ul class="flex flex-col gap-2">
        <li v-for="item in warnings" :key="`${item.flightId}-${item.kind}-${item.ts}`">
          <RouterLink
            :to="`/flight/${item.flightId}`"
            class="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 transition-colors hover:border-border-strong"
          >
            <span class="text-ink-faint" aria-hidden="true">⚠</span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm">{{ item.title }}</span>
              <span class="block truncate text-xs text-muted-foreground">{{ item.detail }}</span>
            </span>
          </RouterLink>
        </li>
      </ul>
    </section>

    <!-- In flight -->
    <section class="flex flex-col gap-3">
      <MonoLabel>In flight · {{ inFlight.length }}</MonoLabel>
      <ul v-if="inFlight.length" class="grid gap-3 sm:grid-cols-2">
        <li v-for="f in inFlight" :key="f.flightId">
          <RouterLink
            :to="`/flight/${f.flightId}`"
            class="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-border-strong"
          >
            <span class="flex items-center justify-between gap-2">
              <span class="truncate text-sm font-semibold">{{ briefTitle(f.briefId) }}</span>
              <StatusDot :tone="statusTone[f.status]" :pulse="f.status === 'running'" />
            </span>
            <span class="flex items-center gap-2">
              <Chip :tone="f.needsYou ? 'beacon' : statusTone[f.status]" :led="f.status === 'running'">
                {{ laneLabel(f) }}
              </Chip>
              <span v-if="f.currentStageName" class="truncate text-xs text-ink-dim">
                {{ f.currentStageName }}
              </span>
            </span>
          </RouterLink>
        </li>
      </ul>
      <div
        v-else
        class="rounded-xl border border-dashed border-border-strong bg-surface-2 px-5 py-10 text-center"
      >
        <p class="text-sm font-medium">Nothing in flight yet.</p>
        <p class="mt-1 text-sm text-muted-foreground">
          Write a brief and send it to watch a flight take off here.
        </p>
        <RouterLink to="/brief/new" class="mt-4 inline-block"
          ><Button variant="outline">＋ New brief</Button></RouterLink
        >
      </div>
    </section>
  </div>
</template>
