<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { GateDecision, RunDetail, StageStatus } from '@shared/domain'
import type { StoredEvent } from '@shared/events'
import Button from '@renderer/components/ui/button/Button.vue'
import { useEventsStore } from '@renderer/stores/events'
import { useRunsStore } from '@renderer/stores/runs'

const props = defineProps<{ id: string }>()
const runsStore = useRunsStore()
const eventsStore = useEventsStore()
const { events } = storeToRefs(eventsStore)

const detail = ref<RunDetail | null>(null)
const notFound = ref(false)
const by = ref('human')
const note = ref('')
const targetStageIndex = ref(0)
const acting = ref(false)
const error = ref<string | null>(null)

async function refresh(): Promise<void> {
  const d = await runsStore.get(props.id)
  if (!d) notFound.value = true
  else detail.value = d
}

const runEvents = computed<StoredEvent[]>(() => events.value.filter((e) => e.runId === props.id))

// Re-fetch the run projection whenever new events for this run arrive.
watch(
  () => runEvents.value.length,
  () => {
    void refresh()
  }
)
watch(
  () => props.id,
  () => {
    detail.value = null
    notFound.value = false
    void refresh()
  }
)

const STAGE_CLASS: Record<StageStatus, string> = {
  pending: 'border-border text-muted-foreground',
  running: 'border-blue-500 text-blue-700',
  awaiting_gate: 'border-amber-500 text-amber-700',
  passed: 'border-green-500 text-green-700',
  failed: 'border-red-500 text-red-600'
}

const awaitingGate = computed(() => detail.value?.run.status === 'awaiting_gate')

const currentGate = computed(() => {
  const d = detail.value
  if (!d) return null
  const stage = d.workflow.stages[d.run.currentStageIndex]
  return stage?.gates.find((g) => g.kind === 'human') ?? null
})

// Stages we can route back to on request-changes (0..current).
const backTargets = computed(() => {
  const d = detail.value
  if (!d) return []
  return d.stages.slice(0, d.run.currentStageIndex + 1)
})

function stageName(index: number): string {
  return detail.value?.workflow.stages[index]?.name ?? `Stage ${index + 1}`
}

function activityLine(event: StoredEvent): string {
  const p = event.payload as Record<string, unknown>
  switch (event.type) {
    case 'run.created':
      return 'Run created'
    case 'run.started':
      return 'Run started'
    case 'run.stage_entered':
      return `→ ${p.stageName} (iteration ${p.iteration})`
    case 'run.stage_passed':
      return `✓ Stage passed: ${stageName(Number(p.stageIndex))}`
    case 'run.stage_failed':
      return `✗ Stage failed: ${p.reason}`
    case 'run.criterion_evaluated':
      return `${p.passed ? '✓' : '✗'} criterion ${p.criterionType}: ${p.detail}`
    case 'run.gate_awaiting':
      return `⏸ Awaiting human gate: ${p.description}`
    case 'run.gate_resolved':
      return `Gate ${p.decision} by ${p.by}${p.note ? ` — ${p.note}` : ''}`
    case 'run.changes_requested':
      return `↩ Changes requested → ${stageName(Number(p.targetStageIndex))}: ${p.note}`
    case 'run.finished':
      return `■ Run ${p.status}`
    case 'agent.spawned':
      return `▶ ${p.personaName} (${p.model})`
    case 'agent.message':
      return String(p.text)
    case 'agent.tool_use':
      return `🔧 ${p.toolName}`
    case 'agent.error':
      return `✖ agent error: ${p.message}`
    default:
      return ''
  }
}

const activity = computed(() => runEvents.value.filter((e) => activityLine(e) !== ''))

function lineClass(type: string): string {
  if (type.endsWith('_failed') || type === 'agent.error') return 'text-red-600'
  if (type === 'run.gate_awaiting' || type === 'run.changes_requested') return 'text-amber-700'
  if (type === 'run.finished' || type === 'run.stage_passed') return 'text-green-700'
  if (type === 'agent.tool_use') return 'text-blue-700'
  if (type.startsWith('run.')) return 'text-muted-foreground'
  return ''
}

async function act(decision: GateDecision): Promise<void> {
  if (!detail.value) return
  error.value = null
  acting.value = true
  try {
    await runsStore.gate({
      runId: props.id,
      decision,
      by: by.value.trim() || 'human',
      note: note.value,
      targetStageIndex: decision === 'request_changes' ? targetStageIndex.value : undefined
    })
    note.value = ''
    await refresh()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    acting.value = false
  }
}

onMounted(() => {
  void eventsStore.init()
  void refresh()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex items-center justify-between">
      <h1 class="text-2xl font-bold tracking-tight">Run</h1>
      <RouterLink to="/runs" class="text-sm text-muted-foreground hover:underline"
        >← All runs</RouterLink
      >
    </header>

    <p v-if="notFound" class="rounded-md border border-border p-4 text-sm text-muted-foreground">
      Run not found.
    </p>

    <template v-else-if="detail">
      <div class="flex items-center gap-3">
        <span class="text-lg font-semibold">{{ detail.workflow.name }}</span>
        <span class="text-xs text-muted-foreground">status: {{ detail.run.status }}</span>
      </div>

      <!-- Stage progress -->
      <div class="flex flex-wrap gap-2">
        <div
          v-for="stage in detail.stages"
          :key="stage.id"
          class="flex flex-col gap-0.5 rounded-md border-l-4 bg-card px-3 py-2 text-sm"
          :class="[
            STAGE_CLASS[stage.status],
            stage.stageIndex === detail.run.currentStageIndex ? 'ring-1 ring-ring' : ''
          ]"
        >
          <span class="font-medium">{{ stageName(stage.stageIndex) }}</span>
          <span class="text-xs"
            >{{ stage.status
            }}<template v-if="stage.iteration > 1"> · iter {{ stage.iteration }}</template></span
          >
        </div>
      </div>

      <!-- Pending gate -->
      <section
        v-if="awaitingGate"
        class="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4"
      >
        <p class="text-sm font-medium text-amber-800">
          Human gate: {{ currentGate?.description || 'Approve to continue' }}
        </p>
        <div class="flex flex-wrap items-end gap-2">
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium" for="by">By</label>
            <input
              id="by"
              v-model="by"
              type="text"
              class="h-8 rounded-md border border-input bg-background px-2 text-sm"
            />
          </div>
          <div class="flex flex-1 flex-col gap-1">
            <label class="text-xs font-medium" for="note">Note</label>
            <input
              id="note"
              v-model="note"
              type="text"
              placeholder="Optional"
              class="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium" for="target">Back to</label>
            <select
              id="target"
              v-model.number="targetStageIndex"
              class="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option v-for="stage in backTargets" :key="stage.id" :value="stage.stageIndex">
                {{ stageName(stage.stageIndex) }}
              </option>
            </select>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Button :disabled="acting" @click="act('approve')">Approve</Button>
          <Button variant="outline" :disabled="acting" @click="act('request_changes')"
            >Request changes</Button
          >
          <Button variant="ghost" :disabled="acting" @click="act('reject')">Reject</Button>
          <span v-if="error" class="text-sm text-red-600">{{ error }}</span>
        </div>
      </section>

      <!-- Activity -->
      <section class="flex flex-col gap-2">
        <h2 class="text-sm font-semibold">Activity</h2>
        <div class="rounded-md border border-border">
          <p v-if="activity.length === 0" class="p-4 text-sm text-muted-foreground">
            No activity yet.
          </p>
          <ul v-else class="divide-y divide-border">
            <li
              v-for="event in activity"
              :key="event.id"
              class="whitespace-pre-wrap px-3 py-2 text-sm"
              :class="lineClass(event.type)"
            >
              {{ activityLine(event) }}
            </li>
          </ul>
        </div>
      </section>
    </template>
  </div>
</template>
