<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterLink, useRouter } from 'vue-router'
import { validateWorkflow } from '@shared/workflow-validation'
import Button from '@renderer/components/ui/button/Button.vue'
import { useRunsStore } from '@renderer/stores/runs'
import { useWorkItemsStore } from '@renderer/stores/work-items'
import { useWorkflowsStore } from '@renderer/stores/workflows'

const router = useRouter()
const runsStore = useRunsStore()
const workItemsStore = useWorkItemsStore()
const workflowsStore = useWorkflowsStore()

const { items, loading } = storeToRefs(runsStore)
const { items: workItems } = storeToRefs(workItemsStore)
const { items: workflows } = storeToRefs(workflowsStore)

const workItemId = ref('')
const workflowId = ref('')
const maxIterations = ref(3)
const error = ref<string | null>(null)
const starting = ref(false)

const selectedWorkflowValid = computed(() => {
  const wf = workflows.value.find((w) => w.id === workflowId.value)
  return wf
    ? validateWorkflow({ name: wf.name, description: wf.description, stages: wf.stages }).ok
    : false
})

const canStart = computed(
  () =>
    !starting.value &&
    workItemId.value !== '' &&
    workflowId.value !== '' &&
    selectedWorkflowValid.value
)

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-secondary text-secondary-foreground',
  running: 'bg-blue-500/15 text-blue-700',
  awaiting_gate: 'bg-amber-500/15 text-amber-700',
  passed: 'bg-green-500/15 text-green-700',
  failed: 'bg-red-500/15 text-red-600',
  cancelled: 'bg-secondary text-muted-foreground'
}

function workItemTitle(id: string): string {
  return workItems.value.find((w) => w.id === id)?.title ?? id.slice(0, 8)
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString()
}

async function start(): Promise<void> {
  error.value = null
  starting.value = true
  try {
    const run = await runsStore.start({
      workItemId: workItemId.value,
      workflowId: workflowId.value,
      maxIterations: maxIterations.value
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
  void workItemsStore.load()
  void workflowsStore.load()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold tracking-tight">Runs</h1>
      <p class="text-sm text-muted-foreground">Execute a workflow over a work item.</p>
    </header>

    <!-- Start form -->
    <section class="flex flex-col gap-3 rounded-md border border-border p-4">
      <h2 class="text-sm font-semibold">Start a run</h2>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="wi">Work item</label>
          <select
            id="wi"
            v-model="workItemId"
            class="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Select…</option>
            <option v-for="w in workItems" :key="w.id" :value="w.id">{{ w.title }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="wf">Workflow</label>
          <select
            id="wf"
            v-model="workflowId"
            class="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Select…</option>
            <option v-for="w in workflows" :key="w.id" :value="w.id">
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
      <p v-if="workflowId && !selectedWorkflowValid" class="text-xs text-amber-700">
        This workflow has validation issues — fix it in the Workflows builder before running.
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
              <span class="font-medium">{{ workItemTitle(run.workItemId) }}</span>
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
