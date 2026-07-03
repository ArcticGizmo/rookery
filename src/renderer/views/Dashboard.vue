<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterLink } from 'vue-router'
import { type ActiveAgent, computeActivity } from '@shared/activity'
import type { PressureLevel } from '@shared/context-pressure'
import { useEventsStore } from '@renderer/stores/events'

const eventsStore = useEventsStore()
const { events, loaded } = storeToRefs(eventsStore)

const activity = computed(() => computeActivity(events.value))

const PRESSURE_TEXT: Record<PressureLevel, string> = {
  ok: 'text-green-700',
  warn: 'text-amber-700',
  high: 'text-red-600'
}
const PRESSURE_BAR: Record<PressureLevel, string> = {
  ok: 'bg-green-500',
  warn: 'bg-amber-500',
  high: 'bg-red-500'
}
const RUN_STATUS_CLASS: Record<string, string> = {
  running: 'bg-blue-500/15 text-blue-700',
  awaiting_checkpoint: 'bg-amber-500/15 text-amber-700'
}

function barWidth(agent: ActiveAgent): string {
  return `${Math.min(100, Math.max(2, agent.contextPercent))}%`
}

function runLabel(flightId: string | null): string {
  return flightId ? flightId.slice(0, 8) : 'standalone'
}

onMounted(() => {
  void eventsStore.init()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold tracking-tight">Activity</h1>
      <p class="text-sm text-muted-foreground">Who is doing what, right now — across every run.</p>
    </header>

    <!-- Global context-pressure warning -->
    <div
      v-if="activity.pressureLevel !== 'ok'"
      class="rounded-md border px-4 py-3 text-sm"
      :class="
        activity.pressureLevel === 'high'
          ? 'border-red-500/40 bg-red-500/10 text-red-700'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-800'
      "
    >
      <span class="font-medium">
        {{
          activity.pressureLevel === 'high' ? 'High context pressure' : 'Elevated context pressure'
        }}
      </span>
      — peak {{ activity.maxContextPercent }}% of context window
      <template v-if="activity.highCount"> · {{ activity.highCount }} agent(s) high</template>
      <template v-if="activity.warnCount"> · {{ activity.warnCount }} warning</template>.
    </div>

    <!-- Active flights -->
    <section class="flex flex-col gap-2">
      <h2 class="text-sm font-semibold">Active flights ({{ activity.flights.length }})</h2>
      <div class="rounded-md border border-border">
        <p v-if="!loaded" class="p-4 text-sm text-muted-foreground">Loading…</p>
        <p v-else-if="activity.flights.length === 0" class="p-4 text-sm text-muted-foreground">
          No active flights.
        </p>
        <ul v-else class="divide-y divide-border">
          <li v-for="run in activity.flights" :key="run.flightId">
            <RouterLink
              :to="`/flights/${run.flightId}`"
              class="flex items-center justify-between px-4 py-3 hover:bg-accent"
            >
              <span class="flex items-center gap-3">
                <span class="font-mono text-sm">{{ runLabel(run.flightId) }}</span>
                <span v-if="run.currentStageName" class="text-xs text-muted-foreground">
                  {{ run.currentStageName }}
                </span>
              </span>
              <span class="flex items-center gap-3">
                <span class="text-xs text-muted-foreground">{{ run.agentCount }} agent(s)</span>
                <span class="rounded px-2 py-0.5 text-xs" :class="RUN_STATUS_CLASS[run.status]">
                  {{ run.status }}
                </span>
              </span>
            </RouterLink>
          </li>
        </ul>
      </div>
    </section>

    <!-- Active agents -->
    <section class="flex flex-col gap-2">
      <h2 class="text-sm font-semibold">Active agents ({{ activity.agents.length }})</h2>
      <div class="rounded-md border border-border">
        <p v-if="loaded && activity.agents.length === 0" class="p-4 text-sm text-muted-foreground">
          No agents running.
        </p>
        <ul v-else class="divide-y divide-border">
          <li
            v-for="agent in activity.agents"
            :key="agent.agentRunId"
            class="flex flex-col gap-2 px-4 py-3"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="flex items-center gap-2">
                <span class="font-medium">{{ agent.personaName }}</span>
                <span class="text-xs text-muted-foreground">{{ agent.model }}</span>
                <RouterLink
                  v-if="agent.flightId"
                  :to="`/flights/${agent.flightId}`"
                  class="text-xs text-muted-foreground hover:underline"
                >
                  · run {{ runLabel(agent.flightId) }}
                </RouterLink>
              </span>
              <span class="text-xs text-muted-foreground">{{ agent.lastActivity }}</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                <div
                  class="h-full rounded-full"
                  :class="PRESSURE_BAR[agent.contextLevel]"
                  :style="{ width: barWidth(agent) }"
                />
              </div>
              <span
                class="w-16 text-right text-xs tabular-nums"
                :class="PRESSURE_TEXT[agent.contextLevel]"
              >
                {{ agent.contextPercent }}%
              </span>
            </div>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
