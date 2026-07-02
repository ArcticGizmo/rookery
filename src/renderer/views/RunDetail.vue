<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { GateDecision, RunDetail, StageStatus } from '@shared/domain'
import type { StoredEvent } from '@shared/events'
import type { InfraInstance, RunInfra } from '@shared/infra'
import Button from '@renderer/components/ui/button/Button.vue'
import { useEventsStore } from '@renderer/stores/events'
import { useRunsStore } from '@renderer/stores/runs'

const props = defineProps<{ id: string }>()
const runsStore = useRunsStore()
const eventsStore = useEventsStore()
const { events } = storeToRefs(eventsStore)

const detail = ref<RunDetail | null>(null)
const infra = ref<RunInfra | null>(null)
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
  try {
    infra.value = await window.rookery.runs.infra(props.id)
  } catch {
    infra.value = null
  }
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
      return `${p.subagentType ? `↳ [${p.subagentType}] ` : ''}${String(p.text)}`
    case 'agent.tool_use':
      return `${p.subagentType ? `↳ [${p.subagentType}] ` : ''}🔧 ${p.toolName}`
    case 'agent.tool_result':
      return `↳ ${p.isError ? '⚠ tool error' : 'tool result'}: ${String(p.content).slice(0, 200)}`
    case 'agent.permission_denied':
      return `⛔ Denied ${p.toolName}${p.subagentId ? ' (subagent)' : ''}: ${p.reason}`
    case 'agent.task':
      return `🧵 Task ${p.phase}${p.subagentType ? ` [${p.subagentType}]` : ''}${p.summary ? `: ${p.summary}` : ''}`
    case 'agent.error':
      return `✖ agent error: ${p.message}`
    case 'infra.provisioning':
      return `⛭ Provisioning infra: ${p.instanceName} (template ${p.template})`
    case 'infra.up':
      return `⛭ Infra up: ${p.instanceName} — ${(p.worktrees as unknown[]).length} worktree(s), ${p.containerCount} container(s)`
    case 'infra.down':
      return `⛭ Infra ${p.removed ? 'removed' : 'stopped'}: ${p.instanceName}`
    case 'infra.failed':
      return `✖ Infra failed: ${p.message}`
    default:
      return ''
  }
}

const activity = computed(() => runEvents.value.filter((e) => activityLine(e) !== ''))

function lineClass(type: string): string {
  if (type.endsWith('_failed') || type === 'agent.error') return 'text-red-600'
  if (type === 'agent.permission_denied') return 'text-red-600'
  if (type === 'run.gate_awaiting' || type === 'run.changes_requested') return 'text-amber-700'
  if (type === 'run.finished' || type === 'run.stage_passed' || type === 'infra.up')
    return 'text-green-700'
  if (type === 'agent.tool_use') return 'text-blue-700'
  if (type === 'agent.tool_result' || type === 'agent.task') return 'text-muted-foreground'
  if (type === 'infra.provisioning' || type === 'infra.down') return 'text-purple-700'
  if (type.startsWith('run.')) return 'text-muted-foreground'
  return ''
}

// Prefer the live instance from `runs.infra`; fall back to the last infra.up
// event payload so worktree paths remain visible after teardown.
const lastInfraUp = computed(() => {
  for (let i = runEvents.value.length - 1; i >= 0; i--) {
    if (runEvents.value[i]!.type === 'infra.up') return runEvents.value[i]!
  }
  return null
})

interface InfraWorktreeView {
  repo: string
  path: string
  branch: string | null
}

const liveInstance = computed<InfraInstance | null>(() => infra.value?.instance ?? null)

const infraWorktrees = computed<InfraWorktreeView[]>(() => {
  if (liveInstance.value) {
    return liveInstance.value.worktrees.map((w) => ({
      repo: w.repo,
      path: w.path,
      branch: w.branch
    }))
  }
  const payload = lastInfraUp.value?.payload as { worktrees?: InfraWorktreeView[] } | undefined
  return payload?.worktrees ?? []
})

const infraPorts = computed<number[]>(() => {
  if (liveInstance.value) return liveInstance.value.ports
  const payload = lastInfraUp.value?.payload as { ports?: number[] } | undefined
  return payload?.ports ?? []
})

// Show the section whenever infra is configured or the run produced infra events.
const showInfra = computed(
  () =>
    (infra.value?.instanceName != null && infra.value.provider !== 'none') ||
    runEvents.value.some((e) => e.type.startsWith('infra.'))
)

const INFRA_STATUS_CLASS: Record<string, string> = {
  none: 'bg-secondary text-muted-foreground',
  provisioning: 'bg-purple-500/15 text-purple-700',
  up: 'bg-green-500/15 text-green-700',
  down: 'bg-secondary text-muted-foreground',
  failed: 'bg-red-500/15 text-red-600'
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

      <!-- Infrastructure -->
      <section v-if="showInfra" class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-semibold">Infrastructure</h2>
          <span
            class="rounded px-2 py-0.5 text-xs"
            :class="INFRA_STATUS_CLASS[infra?.status ?? 'none']"
            >{{ infra?.status ?? 'none' }}</span
          >
          <span class="text-xs text-muted-foreground">via {{ infra?.provider ?? 'none' }}</span>
        </div>

        <p
          v-if="infra && !infra.providerAvailable && infra.provider !== 'none'"
          class="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800"
        >
          The “{{ infra.provider }}” provider isn’t available on this machine — install it to
          provision or inspect infrastructure.
        </p>

        <div class="rounded-md border border-border p-3 text-sm">
          <dl class="flex flex-col gap-1">
            <div class="flex gap-2">
              <dt class="w-28 shrink-0 text-muted-foreground">Instance</dt>
              <dd class="font-mono text-xs">{{ infra?.instanceName ?? '—' }}</dd>
            </div>
            <div v-if="liveInstance" class="flex gap-2">
              <dt class="w-28 shrink-0 text-muted-foreground">Containers</dt>
              <dd>{{ liveInstance.containerCount }}</dd>
            </div>
            <div v-if="infraPorts.length" class="flex gap-2">
              <dt class="w-28 shrink-0 text-muted-foreground">Ports</dt>
              <dd class="font-mono text-xs">{{ infraPorts.join(', ') }}</dd>
            </div>
          </dl>

          <div v-if="infraWorktrees.length" class="mt-3 flex flex-col gap-1">
            <span class="text-xs font-medium text-muted-foreground">Worktrees</span>
            <ul class="flex flex-col gap-1">
              <li
                v-for="wt in infraWorktrees"
                :key="wt.repo"
                class="flex flex-wrap items-baseline gap-2"
              >
                <span class="font-medium">{{ wt.repo }}</span>
                <span v-if="wt.branch" class="text-xs text-muted-foreground">{{ wt.branch }}</span>
                <span class="font-mono text-xs text-muted-foreground">{{ wt.path }}</span>
              </li>
            </ul>
          </div>
          <p v-else class="mt-2 text-xs text-muted-foreground">No worktrees provisioned.</p>
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
