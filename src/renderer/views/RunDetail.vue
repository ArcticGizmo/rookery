<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { GateDecision, LandingMethod, RunDetail, StageStatus } from '@shared/domain'
import { type ChainTool, buildChainOfThought } from '@shared/chain-of-thought'
import type { StoredEvent } from '@shared/events'
import type { InfraInstance, RunInfra } from '@shared/infra'
import type { LandingTargets } from '@shared/landing'
import Button from '@renderer/components/ui/button/Button.vue'
import MarkdownView from '@renderer/components/MarkdownView.vue'
import { useScopedEvents } from '@renderer/composables/use-scoped-events'
import { useRunsStore } from '@renderer/stores/runs'
import { rookery } from '@renderer/lib/rookery'

const props = defineProps<{ id: string }>()
const runsStore = useRunsStore()

// Load this run's events straight from the backend (paginated) and live-tail
// them, so a run's full history is shown even after a restart — the shared
// events store's buffer may not hold an older run's events.
const { events: runEvents, reload: reloadEvents } = useScopedEvents(
  () => ({ runId: props.id }),
  (event) => event.runId === props.id
)

const detail = ref<RunDetail | null>(null)
const infra = ref<RunInfra | null>(null)
const landing = ref<LandingTargets | null>(null)
const notFound = ref(false)
const by = ref('human')
const note = ref('')
const targetStageIndex = ref(0)
const acting = ref(false)
const error = ref<string | null>(null)
/** `${repo}:${method}` of the in-flight landing, or null. */
const landingAction = ref<string | null>(null)
const landingError = ref<string | null>(null)
const tearingDown = ref(false)

const passed = computed(() => detail.value?.run.status === 'passed')

const terminating = ref(false)
// A run can be terminated while it's still doing work or paused at a gate.
const canTerminate = computed(() => {
  const status = detail.value?.run.status
  return status === 'running' || status === 'awaiting_gate'
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
  else detail.value = d
  try {
    infra.value = await rookery().runs.infra(props.id)
  } catch {
    infra.value = null
  }
  // Landing is only relevant once a run has succeeded (Phase 6.4).
  if (d?.run.status === 'passed') {
    try {
      landing.value = await rookery().runs.landTargets(props.id)
    } catch {
      landing.value = null
    }
  } else {
    landing.value = null
  }
}

async function landRepo(repo: string, method: LandingMethod): Promise<void> {
  landingError.value = null
  landingAction.value = `${repo}:${method}`
  try {
    await rookery().runs.land({
      runId: props.id,
      repo,
      method,
      by: by.value.trim() || 'human'
    })
    await refresh()
  } catch (e) {
    landingError.value = e instanceof Error ? e.message : String(e)
  } finally {
    landingAction.value = null
  }
}

async function teardownInfra(): Promise<void> {
  landingError.value = null
  tearingDown.value = true
  try {
    await rookery().runs.teardown(props.id)
    await refresh()
  } catch (e) {
    landingError.value = e instanceof Error ? e.message : String(e)
  } finally {
    tearingDown.value = false
  }
}

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
    void reloadEvents()
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

// When a run is paused because verification exhausted its automatic retry budget
// (Phase 6.3), surface the recorded issues in the gate banner so the human sees
// what failed. Scan back to the most recent escalation since the last resolution.
const verificationEscalation = computed<string | null>(() => {
  if (!awaitingGate.value) return null
  for (let i = runEvents.value.length - 1; i >= 0; i--) {
    const e = runEvents.value[i]!
    if (e.type === 'run.gate_resolved') break
    if (e.type === 'run.verification_failed') {
      const p = e.payload as { issues?: string; routedBack?: boolean }
      if (!p.routedBack) return p.issues ?? ''
    }
  }
  return null
})

// The artifacts the current stage's personas produced (latest iteration each),
// shown at the gate so a human sees exactly what they're approving.
const gateArtifacts = computed<{ personaName: string; role: string; artifact: string }[]>(() => {
  const d = detail.value
  if (!d || !awaitingGate.value) return []
  const idx = d.run.currentStageIndex
  const byPersona = new Map<string, { personaName: string; role: string; artifact: string }>()
  for (const e of runEvents.value) {
    if (e.type !== 'run.stage_output') continue
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
    case 'run.stage_output':
      return `📄 ${p.personaName} (${p.role}) produced output`
    case 'run.gate_awaiting':
      return `⏸ Awaiting human gate: ${p.description}`
    case 'run.gate_resolved':
      return `Gate ${p.decision} by ${p.by}${p.note ? ` — ${p.note}` : ''}`
    case 'run.changes_requested':
      return `↩ Changes requested → ${stageName(Number(p.targetStageIndex))}: ${p.note}`
    case 'run.verification_failed':
      return p.routedBack
        ? `↺ Verification failed (${p.cycle}/${p.maxCycles}) — routing back with issues: ${p.issues}`
        : `⚠ Verification failed — escalated for human intervention: ${p.issues}`
    case 'run.finished':
      return `■ Run ${p.status}`
    case 'run.cancelled':
      return `⏹ Run terminated by human (was ${p.previousStatus})`
    case 'run.branch_ready':
      return `🌿 Branch ready: ${p.repo} on ${p.branch}`
    case 'run.branch_failed':
      return `✖ Branch prep failed (${p.repo}): ${p.message}`
    case 'run.landing_started':
      return `⚑ Landing ${p.repo} via ${p.method} (by ${p.by})`
    case 'run.landed':
      return `✅ Landed ${p.repo} via ${p.method}${
        p.prUrl ? `: ${p.prUrl}` : p.mergedInto ? ` → ${p.mergedInto}` : ''
      }`
    case 'run.landing_failed':
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

// Compact chain-of-thought: the recent, meaningful moments (agent messages,
// paired tool calls, transitions). The full log lives on the History page.
const chain = computed(() => buildChainOfThought(runEvents.value, 5))
const historyLink = computed(() => `/history?runId=${props.id}`)

// Tool detail is collapsed by default; a new Set is assigned on toggle so Vue
// reliably re-renders.
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
  if (type === 'run.verification_failed') return 'text-amber-700'
  if (type.endsWith('_failed') || type === 'agent.error') return 'text-red-600'
  if (type === 'agent.permission_denied') return 'text-red-600'
  if (type === 'run.cancelled') return 'text-red-600'
  if (type === 'run.gate_awaiting' || type === 'run.changes_requested') return 'text-amber-700'
  if (
    type === 'run.finished' ||
    type === 'run.stage_passed' ||
    type === 'run.landed' ||
    type === 'run.branch_ready' ||
    type === 'infra.up'
  )
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
        <span class="flex-1"></span>
        <Button
          v-if="canTerminate"
          variant="outline"
          size="sm"
          :disabled="terminating"
          @click="terminate"
        >
          {{ terminating ? 'Terminating…' : 'Terminate run' }}
        </Button>
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
        <p
          v-if="verificationEscalation"
          class="whitespace-pre-wrap rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-xs text-amber-800"
        >
          Verification issues: {{ verificationEscalation }}
        </p>

        <!-- What you're approving: the artifacts this stage produced. -->
        <div v-if="gateArtifacts.length" class="flex flex-col gap-2">
          <p class="text-xs font-medium text-amber-800">For your review:</p>
          <div
            v-for="artifact in gateArtifacts"
            :key="artifact.personaName"
            class="rounded-md border border-amber-500/40 bg-background p-3"
          >
            <p class="mb-1 text-xs font-medium text-muted-foreground">
              {{ artifact.personaName }} · {{ artifact.role }}
            </p>
            <MarkdownView :source="artifact.artifact" />
          </div>
        </div>

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

      <!-- Landing changes (Phase 6.4) -->
      <section
        v-if="passed && landing"
        class="flex flex-col gap-3 rounded-md border border-green-500/40 bg-green-500/5 p-4"
      >
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-green-800">Land changes</h2>
          <span class="text-xs text-muted-foreground">via {{ landing.provider }}</span>
        </div>

        <p v-if="!landing.canLand" class="text-sm text-muted-foreground">{{ landing.reason }}</p>

        <template v-else>
          <p
            v-if="!landing.providerAvailable"
            class="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800"
          >
            The “{{ landing.provider }}” landing tooling (git/gh) isn’t available on this machine —
            install it to open PRs or merge.
          </p>

          <p v-if="landing.targets.length === 0" class="text-sm text-muted-foreground">
            No worktrees to land.
          </p>
          <ul v-else class="flex flex-col gap-2">
            <li
              v-for="t in landing.targets"
              :key="t.repo"
              class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <span class="font-medium">{{ t.repo }}</span>
              <span class="font-mono text-xs text-muted-foreground"
                >{{ t.branch }} → {{ t.base }}</span
              >
              <span v-if="!t.remoteUrl" class="text-xs text-amber-700">no remote</span>
              <span
                v-if="t.landed"
                class="rounded bg-green-500/15 px-2 py-0.5 text-xs text-green-700"
                >landed</span
              >
              <span class="flex-1"></span>
              <Button
                size="sm"
                variant="outline"
                :disabled="landingAction !== null || !landing.providerAvailable"
                @click="landRepo(t.repo, 'pr')"
                >{{ landingAction === `${t.repo}:pr` ? 'Opening…' : 'Open PR' }}</Button
              >
              <Button
                size="sm"
                variant="ghost"
                :disabled="landingAction !== null || !landing.providerAvailable"
                @click="landRepo(t.repo, 'merge')"
                >{{ landingAction === `${t.repo}:merge` ? 'Merging…' : 'Merge' }}</Button
              >
            </li>
          </ul>

          <div class="flex items-center gap-3">
            <Button variant="ghost" :disabled="tearingDown" @click="teardownInfra">{{
              tearingDown ? 'Tearing down…' : 'Tear down infrastructure'
            }}</Button>
            <span v-if="landingError" class="text-sm text-red-600">{{ landingError }}</span>
          </div>
        </template>
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

      <!-- Activity: compact chain of thought (full log on the History page) -->
      <section class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold">Activity</h2>
          <RouterLink :to="historyLink" class="text-xs text-muted-foreground hover:underline">
            View all activity →
          </RouterLink>
        </div>
        <div class="rounded-md border border-border">
          <p v-if="chain.length === 0" class="p-4 text-sm text-muted-foreground">
            No activity yet.
          </p>
          <ul v-else class="divide-y divide-border">
            <li v-for="item in chain" :key="item.key" class="px-3 py-2 text-sm">
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
                  <span class="text-blue-700">🔧 {{ item.tool.toolName }}</span>
                  <span v-if="item.tool.subagentType" class="text-xs text-muted-foreground">
                    [{{ item.tool.subagentType }}]
                  </span>
                  <span v-if="item.tool.isError" class="text-xs text-red-600">error</span>
                  <span class="flex-1"></span>
                  <span class="text-xs text-muted-foreground">
                    {{ expandedTools.has(item.key) ? '▾' : '▸' }}
                  </span>
                </button>
                <div
                  v-if="expandedTools.has(item.key)"
                  class="mt-1 flex flex-col gap-2 overflow-x-auto rounded bg-muted/30 p-2"
                >
                  <div v-if="toolInput(item.tool)">
                    <span class="text-xs font-medium text-muted-foreground">input</span>
                    <pre class="whitespace-pre-wrap text-xs">{{ toolInput(item.tool) }}</pre>
                  </div>
                  <div v-if="item.tool.result !== null">
                    <span class="text-xs font-medium text-muted-foreground">result</span>
                    <pre
                      class="whitespace-pre-wrap text-xs"
                      :class="item.tool.isError ? 'text-red-600' : ''"
                      >{{ item.tool.result }}</pre>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </section>
    </template>
  </div>
</template>
