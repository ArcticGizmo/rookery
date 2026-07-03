<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterLink, useRouter } from 'vue-router'
import type { RunExecutionMode } from '@shared/domain'
import { validateApproach } from '@shared/approach-validation'
import Button from '@renderer/components/ui/button/Button.vue'
import { useRunsStore } from '@renderer/stores/runs'
import { useBriefsStore } from '@renderer/stores/briefs'
import { useApproachesStore } from '@renderer/stores/approaches'

const router = useRouter()
const runsStore = useRunsStore()
const briefsStore = useBriefsStore()
const approachesStore = useApproachesStore()

const { items, loading } = storeToRefs(runsStore)
const { items: briefs } = storeToRefs(briefsStore)
const { items: approaches } = storeToRefs(approachesStore)

const briefId = ref('')
const approachId = ref('')
const maxIterations = ref(3)
const maxVerificationCycles = ref(2)
const executionMode = ref<RunExecutionMode>('read_only')
const workBranch = ref('')
const infraTemplate = ref('')
const teardownOnComplete = ref(true)
const error = ref<string | null>(null)
const starting = ref(false)

const selectedApproachValid = computed(() => {
  const wf = approaches.value.find((w) => w.id === approachId.value)
  return wf
    ? validateApproach({ name: wf.name, description: wf.description, stages: wf.stages }).ok
    : false
})

const canStart = computed(
  () =>
    !starting.value &&
    briefId.value !== '' &&
    approachId.value !== '' &&
    selectedApproachValid.value &&
    (executionMode.value !== 'local_branch' || workBranch.value.trim() !== '')
)

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-secondary text-secondary-foreground',
  running: 'bg-blue-500/15 text-blue-700',
  awaiting_gate: 'bg-amber-500/15 text-amber-700',
  passed: 'bg-green-500/15 text-green-700',
  failed: 'bg-red-500/15 text-red-600',
  cancelled: 'bg-secondary text-muted-foreground'
}

function briefTitle(id: string): string {
  return briefs.value.find((w) => w.id === id)?.title ?? id.slice(0, 8)
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString()
}

async function start(): Promise<void> {
  error.value = null
  starting.value = true
  try {
    const run = await runsStore.start({
      briefId: briefId.value,
      approachId: approachId.value,
      maxIterations: maxIterations.value,
      maxVerificationCycles: maxVerificationCycles.value,
      executionMode: executionMode.value,
      infraTemplate:
        executionMode.value === 'infra' ? infraTemplate.value.trim() || undefined : undefined,
      workBranch:
        executionMode.value === 'local_branch' ? workBranch.value.trim() || undefined : undefined,
      teardownOnComplete: teardownOnComplete.value
    })
    await router.push(`/runs/${run.id}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    starting.value = false
  }
}

onMounted(() => {
  void runsStore.load()
  void briefsStore.load()
  void approachesStore.load()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold tracking-tight">Runs</h1>
      <p class="text-sm text-muted-foreground">Execute a approach over a work item.</p>
    </header>

    <!-- Start form -->
    <section class="flex flex-col gap-3 rounded-md border border-border p-4">
      <h2 class="text-sm font-semibold">Start a run</h2>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="wi">Work item</label>
          <select
            id="wi"
            v-model="briefId"
            class="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Select…</option>
            <option v-for="w in briefs" :key="w.id" :value="w.id">{{ w.title }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="wf">Approach</label>
          <select
            id="wf"
            v-model="approachId"
            class="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Select…</option>
            <option v-for="w in approaches" :key="w.id" :value="w.id">
              {{ w.name }} (v{{ w.version }})
            </option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="mi">Max iterations</label>
          <input
            id="mi"
            v-model.number="maxIterations"
            type="number"
            min="1"
            max="20"
            class="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="mvc">Max verification cycles</label>
          <input
            id="mvc"
            v-model.number="maxVerificationCycles"
            type="number"
            min="1"
            max="10"
            class="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="mode">Execution mode</label>
          <select
            id="mode"
            v-model="executionMode"
            class="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="read_only">Read-only (plan)</option>
            <option value="local_branch">Local branch (edit checkout)</option>
            <option value="infra">Isolated infra (sprig)</option>
          </select>
        </div>

        <!-- Local branch: name a branch on the work item's own repo checkout. -->
        <div v-if="executionMode === 'local_branch'" class="flex flex-col gap-1 sm:col-span-2">
          <label class="text-sm font-medium" for="branch">Work branch</label>
          <input
            id="branch"
            v-model="workBranch"
            type="text"
            placeholder="e.g. rookery/reset-button"
            class="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>

        <!-- Isolated infra: sprig template + teardown. -->
        <template v-else-if="executionMode === 'infra'">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium" for="infra">Infra template</label>
            <input
              id="infra"
              v-model="infraTemplate"
              type="text"
              placeholder="e.g. api-web — a sprig template"
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <label class="flex items-center gap-2 self-end pb-1 text-sm" for="teardown">
            <input id="teardown" v-model="teardownOnComplete" type="checkbox" class="size-4" />
            Tear down infra on completion
          </label>
        </template>
      </div>

      <p v-if="executionMode === 'local_branch'" class="text-xs text-muted-foreground">
        Runs on the work item's own repo checkout — no sprig or Docker. Edits unlock once a
        <span class="font-mono">setup</span> stage runs, and the working tree must be clean to
        start. Changes are left on the branch for you to review and land manually.
      </p>
      <p v-else-if="executionMode === 'read_only'" class="text-xs text-muted-foreground">
        Agents run read-only (plan mode) — they can review and propose but not edit files.
      </p>
      <p v-if="approachId && !selectedApproachValid" class="text-xs text-amber-700">
        This approach has validation issues — fix it in the Approaches builder before running.
      </p>
      <div class="flex items-center gap-3">
        <Button :disabled="!canStart" @click="start">{{
          starting ? 'Starting…' : 'Start run'
        }}</Button>
        <span v-if="error" class="text-sm text-red-600">{{ error }}</span>
      </div>
    </section>

    <!-- Runs list -->
    <div class="rounded-md border border-border">
      <p v-if="loading" class="p-4 text-sm text-muted-foreground">Loading…</p>
      <p v-else-if="items.length === 0" class="p-4 text-sm text-muted-foreground">No runs yet.</p>
      <ul v-else class="divide-y divide-border">
        <li v-for="run in items" :key="run.id">
          <RouterLink
            :to="`/runs/${run.id}`"
            class="flex items-center justify-between px-4 py-3 hover:bg-accent"
          >
            <span class="flex items-center gap-3">
              <span class="font-medium">{{ briefTitle(run.briefId) }}</span>
              <span class="text-xs text-muted-foreground"
                >stage {{ run.currentStageIndex + 1 }}</span
              >
            </span>
            <span class="flex items-center gap-3">
              <span class="text-xs text-muted-foreground">{{ formatDate(run.updatedAt) }}</span>
              <span class="rounded px-2 py-0.5 text-xs" :class="STATUS_CLASS[run.status]">{{
                run.status
              }}</span>
            </span>
          </RouterLink>
        </li>
      </ul>
    </div>
  </div>
</template>
