<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { EffortLevel, PermissionMode, BriefDetail } from '@shared/domain'
import type { StoredEvent } from '@shared/events'
import Button from '@renderer/components/ui/button/Button.vue'
import { useAgentStore } from '@renderer/stores/agent'
import { useEventsStore } from '@renderer/stores/events'
import { useBriefsStore } from '@renderer/stores/briefs'

const agentStore = useAgentStore()
const eventsStore = useEventsStore()
const briefsStore = useBriefsStore()

const { credentials, activeRunId } = storeToRefs(agentStore)
const { events } = storeToRefs(eventsStore)
const { items } = storeToRefs(briefsStore)

const MODELS = ['', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5']
const EFFORTS: (EffortLevel | '')[] = ['', 'low', 'medium', 'high', 'xhigh', 'max']
const PERMISSION_MODES: PermissionMode[] = [
  'plan',
  'bypassPermissions',
  'acceptEdits',
  'default',
  'dontAsk',
  'auto'
]

// Form state
const selectedBriefId = ref('')
const detail = ref<BriefDetail | null>(null)
const selectedRepoPath = ref('')
const prompt = ref('')
const personaName = ref('Implementer')
const personaRole = ref('Engineer')
const systemPrompt = ref(
  'You are a focused software engineer. Work carefully and explain your steps.'
)
const model = ref('claude-opus-4-8')
const effort = ref<EffortLevel | ''>('high')
const permissionMode = ref<PermissionMode>('plan')
const error = ref<string | null>(null)

const inputClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring'

watch(selectedBriefId, async (id) => {
  detail.value = id ? await briefsStore.get(id) : null
  prompt.value = detail.value?.currentSpec?.content ?? ''
  selectedRepoPath.value = detail.value?.repos[0]?.localPath ?? ''
})

// --- Live run projection (read from the shared audit event stream) ----------

interface HasRunId {
  agentRunId?: string
}

const runEvents = computed<StoredEvent[]>(() =>
  activeRunId.value
    ? events.value.filter((e) => (e.payload as HasRunId)?.agentRunId === activeRunId.value)
    : []
)

const TERMINAL = ['agent.finished', 'agent.cancelled', 'agent.error']
const isRunning = computed(
  () => activeRunId.value !== null && !runEvents.value.some((e) => TERMINAL.includes(e.type))
)

const transcript = computed(() =>
  runEvents.value.filter((e) =>
    ['agent.spawned', 'agent.message', 'agent.tool_use', ...TERMINAL].includes(e.type)
  )
)

function lastPayload<T>(type: string): T | undefined {
  for (let i = runEvents.value.length - 1; i >= 0; i--) {
    if (runEvents.value[i]!.type === type) return runEvents.value[i]!.payload as T
  }
  return undefined
}

const usage = computed(() =>
  lastPayload<{
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
  }>('agent.usage')
)
const pressure = computed(() =>
  lastPayload<{ percent: number; contextWindow: number; level: 'ok' | 'warn' | 'high' }>(
    'agent.context_pressure'
  )
)

function transcriptLine(event: StoredEvent): string {
  const p = event.payload as Record<string, unknown>
  switch (event.type) {
    case 'agent.spawned':
      return `▶ Spawned "${p.personaName}" · model ${p.model}${p.cwd ? ` · ${p.cwd}` : ''}`
    case 'agent.message':
      return String(p.text)
    case 'agent.tool_use':
      return `🔧 ${p.toolName}(${JSON.stringify(p.input)})`
    case 'agent.finished':
      return `■ Finished: ${p.subtype} · ${p.numTurns} turn(s)${
        p.totalCostUsd != null ? ` · $${Number(p.totalCostUsd).toFixed(4)}` : ''
      }`
    case 'agent.cancelled':
      return '■ Cancelled'
    case 'agent.error':
      return `✖ Error: ${p.message}`
    default:
      return event.type
  }
}

function lineClass(type: string): string {
  if (type === 'agent.tool_use') return 'text-blue-700'
  if (type === 'agent.error') return 'text-red-600'
  if (type === 'agent.spawned' || type === 'agent.finished' || type === 'agent.cancelled') {
    return 'text-muted-foreground'
  }
  return ''
}

const canRun = computed(
  () =>
    !isRunning.value &&
    prompt.value.trim().length > 0 &&
    personaName.value.trim().length > 0 &&
    personaRole.value.trim().length > 0
)

async function run(): Promise<void> {
  error.value = null
  try {
    await agentStore.start({
      persona: {
        id: crypto.randomUUID(),
        name: personaName.value.trim(),
        role: personaRole.value.trim(),
        systemPrompt: systemPrompt.value,
        model: model.value || undefined,
        effort: effort.value || undefined
      },
      prompt: prompt.value,
      cwd: selectedRepoPath.value || undefined,
      permissionMode: permissionMode.value
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function cancel(): Promise<void> {
  await agentStore.cancel()
}

onMounted(() => {
  void agentStore.checkCredentials()
  void briefsStore.load()
  void eventsStore.init()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold tracking-tight">Agent run</h1>
      <p class="text-sm text-muted-foreground">
        Flight a single configured agent against a work item's spec and repo.
      </p>
    </header>

    <div
      v-if="credentials && !credentials.available"
      class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700"
    >
      No Agent SDK credentials found. Set <code>ANTHROPIC_API_KEY</code> or run
      <code>claude /login</code> (or <code>claude setup-token</code>), then reopen this page.
    </div>
    <p v-else-if="credentials" class="text-xs text-muted-foreground">
      Credentials: {{ credentials.source }}
    </p>

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- Configuration -->
      <section class="flex flex-col gap-3">
        <h2 class="text-sm font-semibold">Configuration</h2>

        <label class="text-sm font-medium" for="wi">Work item</label>
        <select
          id="wi"
          v-model="selectedBriefId"
          class="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">Select a work item…</option>
          <option v-for="item in items" :key="item.id" :value="item.id">{{ item.title }}</option>
        </select>

        <template v-if="detail">
          <label class="text-sm font-medium" for="repo">Repo (working directory)</label>
          <select
            id="repo"
            v-model="selectedRepoPath"
            class="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">None</option>
            <option v-for="repo in detail.repos" :key="repo.id" :value="repo.localPath">
              {{ repo.name }} — {{ repo.localPath }}
            </option>
          </select>
        </template>

        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium" for="pname">Persona name</label>
            <input id="pname" v-model="personaName" type="text" :class="inputClass" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium" for="prole">Role</label>
            <input id="prole" v-model="personaRole" type="text" :class="inputClass" />
          </div>
        </div>

        <label class="text-sm font-medium" for="sysprompt">System prompt</label>
        <textarea
          id="sysprompt"
          v-model="systemPrompt"
          rows="3"
          class="rounded-md border border-input bg-background p-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        ></textarea>

        <div class="grid grid-cols-3 gap-2">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium" for="model">Model</label>
            <select
              id="model"
              v-model="model"
              class="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option v-for="m in MODELS" :key="m" :value="m">{{ m || 'default' }}</option>
            </select>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium" for="effort">Effort</label>
            <select
              id="effort"
              v-model="effort"
              class="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option v-for="e in EFFORTS" :key="e" :value="e">{{ e || 'default' }}</option>
            </select>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium" for="perm">Permission</label>
            <select
              id="perm"
              v-model="permissionMode"
              class="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option v-for="pm in PERMISSION_MODES" :key="pm" :value="pm">{{ pm }}</option>
            </select>
          </div>
        </div>
        <p v-if="permissionMode === 'plan'" class="text-xs text-muted-foreground">
          Plan mode is read-only (no file edits or command execution). Choose
          <code>bypassPermissions</code> for autonomous work.
        </p>

        <label class="text-sm font-medium" for="prompt">Prompt (from spec — editable)</label>
        <textarea
          id="prompt"
          v-model="prompt"
          rows="6"
          placeholder="Select a work item to load its spec, or type a prompt…"
          class="rounded-md border border-input bg-background p-2 font-mono text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        ></textarea>

        <div class="flex items-center gap-3">
          <Button :disabled="!canRun" @click="run">{{
            isRunning ? 'Running…' : 'Flight agent'
          }}</Button>
          <Button v-if="isRunning" variant="outline" @click="cancel">Cancel</Button>
          <span v-if="error" class="text-sm text-red-600">{{ error }}</span>
        </div>
      </section>

      <!-- Live run -->
      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold">Live run</h2>
          <span v-if="isRunning" class="text-xs text-green-700">● running</span>
        </div>

        <!-- Usage + context pressure -->
        <div
          v-if="usage || pressure"
          class="flex flex-col gap-2 rounded-md border border-border p-3"
        >
          <div v-if="usage" class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>in {{ usage.inputTokens }}</span>
            <span>out {{ usage.outputTokens }}</span>
            <span>cache-read {{ usage.cacheReadTokens }}</span>
            <span>cache-write {{ usage.cacheCreationTokens }}</span>
          </div>
          <div v-if="pressure" class="flex flex-col gap-1">
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium">Context pressure</span>
              <span
                :class="{
                  'text-green-700': pressure.level === 'ok',
                  'text-amber-700': pressure.level === 'warn',
                  'text-red-600': pressure.level === 'high'
                }"
              >
                {{ pressure.percent }}% of {{ pressure.contextWindow.toLocaleString() }}
                <template v-if="pressure.level !== 'ok'">— {{ pressure.level }}</template>
              </span>
            </div>
            <div class="h-2 w-full overflow-hidden rounded bg-secondary">
              <div
                class="h-full rounded transition-all"
                :class="{
                  'bg-green-500': pressure.level === 'ok',
                  'bg-amber-500': pressure.level === 'warn',
                  'bg-red-500': pressure.level === 'high'
                }"
                :style="{ width: `${Math.min(pressure.percent, 100)}%` }"
              ></div>
            </div>
          </div>
        </div>

        <div class="min-h-[16rem] rounded-md border border-border">
          <p v-if="transcript.length === 0" class="p-4 text-sm text-muted-foreground">
            No activity yet. Configure a run and hit “Flight agent”.
          </p>
          <ul v-else class="divide-y divide-border">
            <li
              v-for="event in transcript"
              :key="event.id"
              class="whitespace-pre-wrap px-3 py-2 text-sm"
              :class="lineClass(event.type)"
            >
              {{ transcriptLine(event) }}
            </li>
          </ul>
        </div>
      </section>
    </div>
  </div>
</template>
