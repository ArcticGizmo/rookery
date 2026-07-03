<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type {
  CheckpointDecision,
  FlightStatus,
  FlightDetail,
  StageExecution,
  StageStatus
} from '@shared/domain'
import { type ChainItem, type ChainTool, buildChainOfThought } from '@shared/chain-of-thought'
import { eventsByStage, rightNow, whatITried } from '@shared/flight-timeline'
import { holdCount } from '@shared/checkpoint-rail'
import { stageRoles } from '@shared/approach-view'
import type { StoredEvent } from '@shared/events'
import type { InfraInstance, FlightInfra } from '@shared/infra'
import type { FlightChanges } from '@shared/changes'
import Button from '@renderer/components/ui/button/Button.vue'
import LandingRecap from '@renderer/components/LandingRecap.vue'
import MarkdownView from '@renderer/components/MarkdownView.vue'
import { BeaconCard, Chip, MilestoneNode, MonoLabel, StatusDot } from '@renderer/components/journey'
import { useScopedEvents } from '@renderer/composables/use-scoped-events'
import { useFlightsStore } from '@renderer/stores/flights'
import { useBriefsStore } from '@renderer/stores/briefs'
import { rookery } from '@renderer/lib/rookery'

const props = defineProps<{ id: string }>()
const runsStore = useFlightsStore()
const briefsStore = useBriefsStore()

// The brief this flight is for (title + repo count for the header). Fetched
// alongside the flight projection; falls back to the approach name.
const briefTitle = ref('')
const repoCount = ref(0)

// Load this run's events straight from the backend (paginated) and live-tail
// them, so a run's full history is shown even after a restart — the shared
// events store's buffer may not hold an older run's events.
const { events: runEvents, reload: reloadEvents } = useScopedEvents(
  () => ({ flightId: props.id }),
  (event) => event.flightId === props.id
)

const detail = ref<FlightDetail | null>(null)
const infra = ref<FlightInfra | null>(null)
const changes = ref<FlightChanges | null>(null)
const notFound = ref(false)
const by = ref('human')
const note = ref('')
const targetStageIndex = ref(0)
const acting = ref(false)
const error = ref<string | null>(null)

const passed = computed(() => detail.value?.flight.status === 'passed')

// --- Header (J7.1): the flight read as a journey at a glance -----------------

// A live clock so elapsed time ticks while the flight is still in the air.
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null

const inAir = computed(() => {
  const s = detail.value?.flight.status
  return s === 'running' || s === 'awaiting_checkpoint' || s === 'pending'
})

const phaseLabel = computed(() => {
  const d = detail.value
  if (!d) return ''
  const total = d.approach.stages.length
  return `phase ${Math.min(d.flight.currentStageIndex + 1, total)} of ${total}`
})

const checkpointCount = computed(() =>
  detail.value ? holdCount(detail.value.approach.stages, detail.value.approach.landing) : 0
)

// --- "Right now" strip (J7.4): who's working + context pressure -------------

const nowSnapshot = computed(() => rightNow(runEvents.value))

// personaName → role, resolved from the approach (the spawn event omits role).
const personaRoles = computed(() => {
  const map = new Map<string, string>()
  for (const stage of detail.value?.approach.stages ?? []) {
    for (const persona of stage.personas) map.set(persona.name, persona.role)
  }
  return map
})
function agentRole(agent: { personaName: string; model: string }): string {
  return personaRoles.value.get(agent.personaName) || agent.model
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?'
}

const PRESSURE_TONE: Record<'ok' | 'warn' | 'high', string> = {
  ok: 'bg-pass',
  warn: 'bg-beacon',
  high: 'bg-block'
}
const PRESSURE_LABEL: Record<'ok' | 'warn' | 'high', string> = {
  ok: 'healthy',
  warn: 'warming',
  high: 'high'
}

// --- Broad changes summary (J7.5) -------------------------------------------
const hasChanges = computed(() => (changes.value?.repos ?? []).some((r) => r.files.length > 0))

const elapsedMs = computed(() => {
  const f = detail.value?.flight
  if (!f) return 0
  const start = new Date(f.createdAt).getTime()
  const end = inAir.value ? now.value : new Date(f.updatedAt).getTime()
  return Math.max(0, end - start)
})

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

const STATUS_TONE: Record<FlightStatus, 'pass' | 'active' | 'pending' | 'beacon' | 'block'> = {
  pending: 'pending',
  running: 'active',
  awaiting_checkpoint: 'beacon',
  passed: 'pass',
  failed: 'block',
  cancelled: 'pending'
}
const STATUS_LABEL: Record<FlightStatus, string> = {
  pending: 'pending',
  running: 'in flight',
  awaiting_checkpoint: 'needs you',
  passed: 'landed',
  failed: 'failed',
  cancelled: 'cancelled'
}

const terminating = ref(false)
// A run can be terminated while it's still doing work or paused at a checkpoint.
const canTerminate = computed(() => {
  const status = detail.value?.flight.status
  return status === 'running' || status === 'awaiting_checkpoint'
})

async function terminate(): Promise<void> {
  if (!detail.value || terminating.value) return
  if (!window.confirm('Terminate this run? Its active agents will be stopped.')) return
  error.value = null
  terminating.value = true
  try {
    await runsStore.cancel(props.id)
    await refresh()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    terminating.value = false
  }
}

async function refresh(): Promise<void> {
  const d = await runsStore.get(props.id)
  if (!d) notFound.value = true
  else {
    detail.value = d
    const brief = await briefsStore.get(d.flight.briefId)
    briefTitle.value = brief?.brief.title ?? d.approach.name
    repoCount.value = brief?.repos.length ?? 0
  }
  try {
    infra.value = await rookery().flights.infra(props.id)
  } catch {
    infra.value = null
  }
  try {
    changes.value = await runsStore.changes(props.id)
  } catch {
    changes.value = null
  }
}

// Coalesce refreshes per animation frame (J7.6): a busy flight appends many
// events per second, and each refresh fans out to several IPC calls (detail,
// infra, changes, land targets). Collapsing bursts into one refresh per frame
// keeps the live view smooth; a refresh that finishes with newer events still
// pending schedules exactly one more.
let refreshScheduled = false
let refreshing = false
let refreshAgain = false

async function runRefresh(): Promise<void> {
  if (refreshing) {
    refreshAgain = true
    return
  }
  refreshing = true
  try {
    await refresh()
  } finally {
    refreshing = false
    if (refreshAgain) {
      refreshAgain = false
      scheduleRefresh()
    }
  }
}

function scheduleRefresh(): void {
  if (refreshScheduled) return
  refreshScheduled = true
  requestAnimationFrame(() => {
    refreshScheduled = false
    void runRefresh()
  })
}

// Re-fetch the run projection whenever new events for this run arrive.
watch(
  () => runEvents.value.length,
  () => scheduleRefresh()
)
watch(
  () => props.id,
  () => {
    detail.value = null
    notFound.value = false
    void reloadEvents()
    void refresh()
  }
)

const awaitingCheckpoint = computed(() => detail.value?.flight.status === 'awaiting_checkpoint')

const currentCheckpoint = computed(() => {
  const d = detail.value
  if (!d) return null
  const stage = d.approach.stages[d.flight.currentStageIndex]
  return stage?.checkpoints.find((g) => g.kind === 'human') ?? null
})

// When a run is paused because verification exhausted its automatic retry budget
// (Phase 6.3), surface the recorded issues in the checkpoint banner so the human sees
// what failed. Scan back to the most recent escalation since the last resolution.
const verificationEscalation = computed<string | null>(() => {
  if (!awaitingCheckpoint.value) return null
  for (let i = runEvents.value.length - 1; i >= 0; i--) {
    const e = runEvents.value[i]!
    if (e.type === 'flight.checkpoint_resolved') break
    if (e.type === 'flight.verification_failed') {
      const p = e.payload as { issues?: string; routedBack?: boolean }
      if (!p.routedBack) return p.issues ?? ''
    }
  }
  return null
})

// The artifacts the current stage's personas produced (latest iteration each),
// shown at the checkpoint so a human sees exactly what they're approving.
const checkpointArtifacts = computed<{ personaName: string; role: string; artifact: string }[]>(() => {
  const d = detail.value
  if (!d || !awaitingCheckpoint.value) return []
  const idx = d.flight.currentStageIndex
  const byPersona = new Map<string, { personaName: string; role: string; artifact: string }>()
  for (const e of runEvents.value) {
    if (e.type !== 'flight.stage_output') continue
    const p = e.payload as {
      stageIndex: number
      personaId: string
      personaName: string
      role: string
      artifact: string
    }
    if (p.stageIndex !== idx) continue
    byPersona.set(p.personaId, { personaName: p.personaName, role: p.role, artifact: p.artifact })
  }
  return [...byPersona.values()]
})

// Stages we can route back to on request-changes (0..current).
const backTargets = computed(() => {
  const d = detail.value
  if (!d) return []
  return d.stages.slice(0, d.flight.currentStageIndex + 1)
})

// --- The "needs you" beacon (J8) --------------------------------------------

// A verification-budget escalation reuses the checkpoint machinery but reads
// differently to the human — the agents couldn't resolve it on their own.
const isEscalation = computed(() => verificationEscalation.value !== null)

// Plain language for *why this decision is yours*, addressed to the human.
const beaconTitle = computed(() => {
  const d = detail.value
  const stage = d ? stageName(d.flight.currentStageIndex) : ''
  return isEscalation.value ? `${stage} needs you` : `${stage} — your checkpoint`
})
const whyYours = computed(() => {
  if (isEscalation.value) {
    return 'The agents tried and couldn’t get this to pass on their own. Whether to accept it as-is, loop back for another attempt, or change direction is your call.'
  }
  return currentCheckpoint.value?.description || 'You asked to hold here before the flight continues.'
})

// "What I tried" for the stage awaiting a decision (J8.1), built from its events.
const currentStageId = computed(() => {
  const d = detail.value
  return d?.stages[d.flight.currentStageIndex]?.stageId ?? null
})
const tried = computed(() =>
  currentStageId.value ? whatITried(stageEventsMap.value.get(currentStageId.value) ?? []) : []
)
const triedOpen = ref(false)

function stageName(index: number): string {
  return detail.value?.approach.stages[index]?.name ?? `Stage ${index + 1}`
}

// --- Milestone timeline (J7.2): stages read as broad milestones -------------

type MilestoneState = 'done' | 'active' | 'pending' | 'beacon' | 'block'

function milestoneState(status: StageStatus): MilestoneState {
  switch (status) {
    case 'passed':
      return 'done'
    case 'running':
      return 'active'
    case 'awaiting_checkpoint':
      return 'beacon'
    case 'failed':
      return 'block'
    case 'pending':
      return 'pending'
  }
}

/** A one-line, human summary of where a stage is right now. */
function milestoneSummary(exec: StageExecution): string {
  const def = detail.value?.approach.stages[exec.stageIndex]
  switch (exec.status) {
    case 'passed':
      return 'Done'
    case 'running': {
      const roles = def ? stageRoles(def) : []
      return roles.length ? `${roles.join(', ')} working…` : 'In progress…'
    }
    case 'awaiting_checkpoint': {
      const cp = def?.checkpoints.find((c) => c.kind === 'human')
      return cp?.description || 'Waiting for your decision'
    }
    case 'failed':
      return 'Failed — see activity below'
    case 'pending':
      return 'Not started'
  }
}

function activityLine(event: StoredEvent): string {
  const p = event.payload as Record<string, unknown>
  switch (event.type) {
    case 'flight.created':
      return 'Flight created'
    case 'flight.started':
      return 'Flight started'
    case 'flight.stage_entered':
      return `→ ${p.stageName} (iteration ${p.iteration})`
    case 'flight.stage_passed':
      return `✓ Stage passed: ${stageName(Number(p.stageIndex))}`
    case 'flight.stage_failed':
      return `✗ Stage failed: ${p.reason}`
    case 'flight.criterion_evaluated':
      return `${p.passed ? '✓' : '✗'} criterion ${p.criterionType}: ${p.detail}`
    case 'flight.stage_output':
      return `📄 ${p.personaName} (${p.role}) produced output`
    case 'flight.checkpoint_awaiting':
      return `⏸ Awaiting human checkpoint: ${p.description}`
    case 'flight.checkpoint_resolved':
      return `Checkpoint ${p.decision} by ${p.by}${p.note ? ` — ${p.note}` : ''}`
    case 'flight.changes_requested':
      return `↩ Changes requested → ${stageName(Number(p.targetStageIndex))}: ${p.note}`
    case 'flight.verification_failed':
      return p.routedBack
        ? `↺ Verification failed (${p.cycle}/${p.maxCycles}) — routing back with issues: ${p.issues}`
        : `⚠ Verification failed — escalated for human intervention: ${p.issues}`
    case 'flight.finished':
      return `■ Flight ${p.status}`
    case 'flight.cancelled':
      return `⏹ Flight terminated by human (was ${p.previousStatus})`
    case 'flight.branch_ready':
      return `🌿 Branch ready: ${p.repo} on ${p.branch}`
    case 'flight.branch_failed':
      return `✖ Branch prep failed (${p.repo}): ${p.message}`
    case 'flight.landing_started':
      return `⚑ Landing ${p.repo} via ${p.method} (by ${p.by})`
    case 'flight.landed':
      return `✅ Landed ${p.repo} via ${p.method}${
        p.prUrl ? `: ${p.prUrl}` : p.mergedInto ? ` → ${p.mergedInto}` : ''
      }`
    case 'flight.landing_failed':
      return `✖ Landing ${p.repo} failed: ${p.message}`
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

const historyLink = computed(() => `/history?flightId=${props.id}`)

// This flight's events grouped by stage — the basis for per-milestone
// transcripts (J7.3) and the "what I tried" beacon detail (J8.1).
const stageEventsMap = computed(() => eventsByStage(runEvents.value))

// Granular disclosure (J7.3): each milestone expands to its own chain-of-thought
// — the meaningful moments (agent messages, paired tool calls, transitions) that
// happened inside that stage. Built once per event change, keyed by stage id.
const stageChains = computed(() => {
  const map = new Map<string, ChainItem[]>()
  for (const [stageId, evs] of stageEventsMap.value) {
    map.set(stageId, buildChainOfThought(evs, 40))
  }
  return map
})
function stageChain(stageId: string): ChainItem[] {
  return stageChains.value.get(stageId) ?? []
}

// Which milestones are expanded to their transcript. New Sets on toggle so Vue
// reliably re-renders.
const expandedStages = ref<Set<string>>(new Set())
function toggleStage(stageId: string): void {
  const next = new Set(expandedStages.value)
  if (next.has(stageId)) next.delete(stageId)
  else next.add(stageId)
  expandedStages.value = next
}

// Tool detail within a transcript is collapsed by default.
const expandedTools = ref<Set<string>>(new Set())
function toggleTool(key: string): void {
  const next = new Set(expandedTools.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedTools.value = next
}

function toolInput(tool: ChainTool): string {
  if (tool.input == null) return ''
  if (typeof tool.input === 'string') return tool.input
  try {
    return JSON.stringify(tool.input, null, 2)
  } catch {
    return String(tool.input)
  }
}

function lineClass(type: string): string {
  // Verification failures loop back or escalate — attention, not terminal failure.
  if (type === 'flight.verification_failed') return 'text-amber-700'
  if (type.endsWith('_failed') || type === 'agent.error') return 'text-red-600'
  if (type === 'agent.permission_denied') return 'text-red-600'
  if (type === 'flight.cancelled') return 'text-red-600'
  if (type === 'flight.checkpoint_awaiting' || type === 'flight.changes_requested') return 'text-amber-700'
  if (
    type === 'flight.finished' ||
    type === 'flight.stage_passed' ||
    type === 'flight.landed' ||
    type === 'flight.branch_ready' ||
    type === 'infra.up'
  )
    return 'text-green-700'
  if (type === 'agent.tool_use') return 'text-blue-700'
  if (type === 'agent.tool_result' || type === 'agent.task') return 'text-muted-foreground'
  if (type === 'infra.provisioning' || type === 'infra.down') return 'text-purple-700'
  if (type.startsWith('flight.')) return 'text-muted-foreground'
  return ''
}

// Prefer the live instance from `flights.infra`; fall back to the last infra.up
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

async function act(decision: CheckpointDecision): Promise<void> {
  if (!detail.value) return
  error.value = null
  acting.value = true
  try {
    await runsStore.checkpoint({
      flightId: props.id,
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
  void refresh()
  clock = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (clock) clearInterval(clock)
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex items-start justify-between gap-4">
      <MonoLabel class="text-primary">The flight</MonoLabel>
      <div class="flex items-center gap-4 text-sm">
        <RouterLink :to="`/story/${props.id}`" class="text-muted-foreground hover:underline">
          The story →
        </RouterLink>
        <RouterLink to="/" class="text-muted-foreground hover:underline">← Desk</RouterLink>
      </div>
    </header>

    <p v-if="notFound" class="rounded-md border border-border p-4 text-sm text-muted-foreground">
      Flight not found.
    </p>

    <template v-else-if="detail">
      <!-- Flight header: the journey at a glance (J7.1). -->
      <div class="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
        <div class="flex items-start justify-between gap-4">
          <div class="flex min-w-0 flex-col gap-1">
            <h1 class="truncate text-2xl font-bold tracking-tight text-balance">{{ briefTitle }}</h1>
            <span class="text-sm text-muted-foreground">via {{ detail.approach.name }}</span>
          </div>
          <div class="flex shrink-0 items-center gap-3">
            <Chip :tone="STATUS_TONE[detail.flight.status]" led>{{
              STATUS_LABEL[detail.flight.status]
            }}</Chip>
            <Button
              v-if="canTerminate"
              variant="outline"
              size="sm"
              :disabled="terminating"
              @click="terminate"
            >
              {{ terminating ? 'Terminating…' : 'Terminate' }}
            </Button>
          </div>
        </div>
        <dl class="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
          <div class="flex items-center gap-1.5">
            <dt class="mono-label text-ink-faint">phase</dt>
            <dd class="font-medium text-ink">{{ phaseLabel }}</dd>
          </div>
          <div class="flex items-center gap-1.5">
            <dt class="mono-label text-ink-faint">elapsed</dt>
            <dd class="font-medium tabular-nums text-ink">{{ formatDuration(elapsedMs) }}</dd>
          </div>
          <div class="flex items-center gap-1.5">
            <dt class="mono-label text-ink-faint">repos</dt>
            <dd class="font-medium text-ink">{{ repoCount }}</dd>
          </div>
          <div class="flex items-center gap-1.5">
            <dt class="mono-label text-ink-faint">checkpoints</dt>
            <dd class="font-medium text-ink">{{ checkpointCount }}</dd>
          </div>
        </dl>
      </div>

      <!-- "Right now": who's working + context pressure (J7.4). -->
      <section
        v-if="inAir && (nowSnapshot.agents.length || nowSnapshot.pressure)"
        class="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-4"
      >
        <div class="flex items-center gap-3">
          <MonoLabel class="text-ink-faint">right now</MonoLabel>
          <div v-if="nowSnapshot.agents.length" class="flex items-center gap-2">
            <div
              v-for="agent in nowSnapshot.agents"
              :key="agent.agentRunId"
              class="flex items-center gap-2"
              :title="`${agent.personaName} · ${agentRole(agent)}`"
            >
              <span
                class="grid size-7 shrink-0 place-items-center rounded-full bg-accent-wash text-xs font-semibold text-primary"
              >
                {{ initials(agent.personaName) }}
              </span>
              <span class="text-sm text-muted-foreground">{{ agentRole(agent) }}</span>
            </div>
          </div>
          <span v-else class="text-sm text-ink-faint">Thinking…</span>
        </div>

        <div v-if="nowSnapshot.pressure" class="flex min-w-40 flex-1 items-center gap-2">
          <MonoLabel class="text-ink-faint">context</MonoLabel>
          <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div
              class="h-full rounded-full transition-all"
              :class="PRESSURE_TONE[nowSnapshot.pressure.level]"
              :style="{ width: `${Math.min(100, Math.max(2, nowSnapshot.pressure.percent))}%` }"
            ></div>
          </div>
          <span
            class="mono-label shrink-0 tabular-nums"
            :class="{
              'text-pass': nowSnapshot.pressure.level === 'ok',
              'text-beacon': nowSnapshot.pressure.level === 'warn',
              'text-block': nowSnapshot.pressure.level === 'high'
            }"
          >
            {{ Math.round(nowSnapshot.pressure.percent) }}% · {{ PRESSURE_LABEL[nowSnapshot.pressure.level] }}
          </span>
        </div>
      </section>

      <!-- Paused, waiting for you (J8.5): the patience guarantee made visible. A
           held flight holds here indefinitely — nothing times out — while your
           other flights keep flying. The beacon below is where you decide. -->
      <section
        v-if="awaitingCheckpoint"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-beacon/40 bg-beacon-wash/40 px-4 py-3"
      >
        <span class="flex items-center gap-2">
          <StatusDot tone="beacon" />
          <MonoLabel class="text-beacon">paused · waiting for you</MonoLabel>
        </span>
        <span class="text-sm text-ink-dim">
          Holding here indefinitely — nothing times out. Your other flights keep flying.
        </span>
      </section>

      <!-- Milestone timeline: broad milestones that zoom to granular detail (J7.2/J7.3). -->
      <section class="flex flex-col">
        <div class="mb-3 flex items-center justify-between">
          <MonoLabel>The journey</MonoLabel>
          <RouterLink :to="historyLink" class="text-xs text-muted-foreground hover:underline">
            Full activity log →
          </RouterLink>
        </div>
        <MilestoneNode
          v-for="(stage, index) in detail.stages"
          :key="stage.id"
          :state="milestoneState(stage.status)"
          :line="index < detail.stages.length - 1"
          :pulse="stage.status === 'running' || stage.status === 'awaiting_checkpoint'"
        >
          <div class="flex items-baseline gap-2">
            <span class="mono-label text-ink-faint">{{ index + 1 }}</span>
            <span class="text-sm font-semibold">{{ stageName(stage.stageIndex) }}</span>
            <span v-if="stage.iteration > 1" class="mono-label text-ink-faint">
              · iteration {{ stage.iteration }}
            </span>
          </div>
          <p
            class="text-xs"
            :class="{
              'text-beacon': stage.status === 'awaiting_checkpoint',
              'text-block': stage.status === 'failed',
              'text-muted-foreground': stage.status !== 'awaiting_checkpoint' && stage.status !== 'failed'
            }"
          >
            {{ milestoneSummary(stage) }}
          </p>

          <!-- Zoom in: this stage's transcript (J7.3). -->
          <button
            v-if="stageChain(stage.stageId).length"
            type="button"
            class="mt-1.5 text-xs text-primary hover:underline"
            @click="toggleStage(stage.stageId)"
          >
            {{ expandedStages.has(stage.stageId) ? '▾ hide detail' : `▸ show detail (${stageChain(stage.stageId).length})` }}
          </button>
          <ul
            v-if="expandedStages.has(stage.stageId)"
            class="mt-2 flex flex-col divide-y divide-border rounded-lg border border-border bg-surface-2"
          >
            <li v-for="item in stageChain(stage.stageId)" :key="item.key" class="px-3 py-1.5 text-xs">
              <!-- Transitions & agent messages -->
              <div
                v-if="item.kind === 'event'"
                class="whitespace-pre-wrap"
                :class="lineClass(item.event.type)"
              >
                {{ activityLine(item.event) }}
              </div>
              <!-- Tool call: collapsed, expandable for input/result -->
              <div v-else>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 text-left"
                  @click="toggleTool(item.key)"
                >
                  <span class="text-primary">🔧 {{ item.tool.toolName }}</span>
                  <span v-if="item.tool.subagentType" class="text-ink-faint">
                    [{{ item.tool.subagentType }}]
                  </span>
                  <span v-if="item.tool.isError" class="text-block">error</span>
                  <span class="flex-1"></span>
                  <span class="text-ink-faint">{{ expandedTools.has(item.key) ? '▾' : '▸' }}</span>
                </button>
                <div
                  v-if="expandedTools.has(item.key)"
                  class="mt-1 flex flex-col gap-2 overflow-x-auto rounded bg-background p-2"
                >
                  <div v-if="toolInput(item.tool)">
                    <span class="text-ink-faint">input</span>
                    <pre class="whitespace-pre-wrap">{{ toolInput(item.tool) }}</pre>
                  </div>
                  <div v-if="item.tool.result !== null">
                    <span class="text-ink-faint">result</span>
                    <pre
                      class="whitespace-pre-wrap"
                      :class="item.tool.isError ? 'text-block' : ''"
                      >{{ item.tool.result }}</pre>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </MilestoneNode>
      </section>

      <!-- Broad changes so far, across the workspace (J7.5). -->
      <section v-if="changes?.available && hasChanges" class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <MonoLabel>Changes so far · this workspace</MonoLabel>
          <span class="mono-label">
            <span class="text-pass">+{{ changes.totalAdditions }}</span>
            <span class="text-block">−{{ changes.totalDeletions }}</span>
          </span>
        </div>
        <div
          v-for="repo in changes.repos"
          :key="repo.repo"
          class="overflow-hidden rounded-xl border border-border"
        >
          <div class="mono-label border-b border-border bg-surface-2 px-3 py-1.5 text-ink-faint">
            {{ repo.repo }}
          </div>
          <p v-if="!repo.files.length" class="px-3 py-2 text-xs text-muted-foreground">
            No changes yet.
          </p>
          <ul v-else class="divide-y divide-border">
            <li
              v-for="f in repo.files"
              :key="f.path"
              class="flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-xs"
            >
              <span class="truncate text-muted-foreground">{{ f.path }}</span>
              <span class="shrink-0 tabular-nums">
                <span v-if="f.binary" class="text-ink-faint">binary</span>
                <template v-else>
                  <span class="text-pass">+{{ f.additions }}</span>
                  <span class="text-block">−{{ f.deletions }}</span>
                </template>
              </span>
            </li>
          </ul>
        </div>
      </section>

      <!-- The "needs you" beacon: one calm card when a decision is yours (J8). -->
      <BeaconCard v-if="awaitingCheckpoint" :title="beaconTitle" subtitle="a decision that's yours">
        <div class="flex flex-col gap-4">
          <p class="text-sm text-ink">{{ whyYours }}</p>

          <!-- Collapsible "what I tried" (J8.1). -->
          <div v-if="tried.length" class="flex flex-col gap-2">
            <button
              type="button"
              class="self-start text-xs text-primary hover:underline"
              @click="triedOpen = !triedOpen"
            >
              {{ triedOpen ? '▾ hide what I tried' : `▸ what I tried (${tried.length})` }}
            </button>
            <ul
              v-if="triedOpen"
              class="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface-2"
            >
              <li v-for="(t, i) in tried" :key="i" class="px-3 py-2 text-xs">
                <span class="mono-label text-block">{{ t.label }}</span>
                <p v-if="t.detail" class="mt-0.5 whitespace-pre-wrap text-muted-foreground">{{ t.detail }}</p>
              </li>
            </ul>
          </div>

          <!-- For your review: the artifacts this stage produced. -->
          <div v-if="checkpointArtifacts.length" class="flex flex-col gap-2">
            <MonoLabel class="text-ink-faint">for your review</MonoLabel>
            <div
              v-for="artifact in checkpointArtifacts"
              :key="artifact.personaName"
              class="rounded-lg border border-border bg-background p-3"
            >
              <p class="mb-1 mono-label text-ink-faint">{{ artifact.personaName }} · {{ artifact.role }}</p>
              <MarkdownView :source="artifact.artifact" />
            </div>
          </div>

          <!-- Your three levers (J8.2): approve · request changes (note) · route back. -->
          <div class="flex flex-wrap items-end gap-2">
            <div class="flex flex-col gap-1">
              <label class="mono-label text-ink-faint" for="by">you</label>
              <input
                id="by"
                v-model="by"
                type="text"
                class="h-8 rounded-md border border-input bg-background px-2 text-sm"
              />
            </div>
            <div class="flex flex-1 flex-col gap-1">
              <label class="mono-label text-ink-faint" for="note">note</label>
              <input
                id="note"
                v-model="note"
                type="text"
                placeholder="Optional — sent back with your decision"
                class="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="mono-label text-ink-faint" for="target">route back to</label>
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
          <div class="flex flex-wrap items-center gap-2">
            <Button :disabled="acting" @click="act('approve')">Approve a direction</Button>
            <Button variant="outline" :disabled="acting" @click="act('request_changes')">
              Request changes
            </Button>
            <Button variant="ghost" :disabled="acting" @click="act('reject')">Reject</Button>
            <span v-if="error" class="text-sm text-block">{{ error }}</span>
          </div>

          <!-- Patience guarantee (J8.5): reassurance right at the decision. -->
          <p class="mono-label text-ink-faint">
            No rush — nothing advances until you decide.
          </p>
        </div>
      </BeaconCard>

      <!-- How it lands: the final checkpoint (J5.3), reused from the story (J9.3). -->
      <LandingRecap v-if="passed" :flight-id="props.id" @changed="scheduleRefresh" />

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

    </template>
  </div>
</template>
