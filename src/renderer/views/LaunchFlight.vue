<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { ApproachDef, FlightExecutionMode, Repo } from '@shared/domain'
import { validateApproach } from '@shared/approach-validation'
import { firstHold, holdCount } from '@shared/checkpoint-rail'
import { useBriefsStore } from '@renderer/stores/briefs'
import { useApproachesStore } from '@renderer/stores/approaches'
import { useFlightsStore } from '@renderer/stores/flights'
import { useAgentStore } from '@renderer/stores/agent'
import { Button } from '@renderer/components/ui/button'
import { Chip, MonoLabel } from '@renderer/components/journey'

// Send it into isolation (Phase J6). One confident act commits the brief to
// flight, with the isolated workspace made legible as safety: your main branch
// stays untouched while agents work inside a sealed copy (worktree + containers).
// Reuses the flight engine unchanged — this is only the front-of-house.
const props = defineProps<{ id: string }>()
const router = useRouter()
const briefsStore = useBriefsStore()
const approachesStore = useApproachesStore()
const flightsStore = useFlightsStore()
const agentStore = useAgentStore()

const loading = ref(true)
const briefNotFound = ref(false)
const briefTitle = ref('')
const repos = ref<Repo[]>([])
const approach = ref<ApproachDef | null>(null)

// Flight options — plain choices with sensible defaults (J6.2).
const executionMode = ref<FlightExecutionMode>('infra')
const workspaceTemplate = ref('')
const workBranch = ref('')
const maxIterations = ref(3)
const maxVerificationCycles = ref(2)
const teardownOnComplete = ref(true)

const starting = ref(false)
const error = ref<string | null>(null)

const credentials = computed(() => agentStore.credentials)
const credentialsReady = computed(() => credentials.value?.available === true)

const approachValid = computed(() =>
  approach.value
    ? validateApproach({
        name: approach.value.name,
        description: approach.value.description,
        stages: approach.value.stages
      }).ok
    : false
)

const holds = computed(() =>
  approach.value ? holdCount(approach.value.stages, approach.value.landing) : 0
)
const firstStop = computed(() =>
  approach.value ? firstHold(approach.value.stages, approach.value.landing) : null
)
const firstStopText = computed(() => {
  const f = firstStop.value
  if (!f || f.kind === 'none') return 'It will run to completion without stopping for you.'
  if (f.kind === 'landing') return 'First stop: when it’s ready to land.'
  return `First stop: after “${f.label}”.`
})

const canBegin = computed(
  () =>
    !starting.value &&
    approach.value !== null &&
    approachValid.value &&
    credentialsReady.value &&
    (executionMode.value !== 'local_branch' || workBranch.value.trim() !== '')
)

onMounted(async () => {
  void agentStore.checkCredentials()
  const detail = await briefsStore.get(props.id)
  if (!detail) {
    briefNotFound.value = true
    loading.value = false
    return
  }
  briefTitle.value = detail.brief.title
  repos.value = detail.repos
  await approachesStore.load()
  approach.value = approachesStore.items.find((a) => a.briefId === props.id) ?? null
  loading.value = false
})

async function begin(): Promise<void> {
  if (!approach.value) return
  error.value = null
  starting.value = true
  try {
    const flight = await flightsStore.start({
      briefId: props.id,
      approachId: approach.value.id,
      maxIterations: maxIterations.value,
      maxVerificationCycles: maxVerificationCycles.value,
      executionMode: executionMode.value,
      infraTemplate:
        executionMode.value === 'infra' ? workspaceTemplate.value.trim() || undefined : undefined,
      workBranch:
        executionMode.value === 'local_branch' ? workBranch.value.trim() || undefined : undefined,
      teardownOnComplete: teardownOnComplete.value
    })
    await router.push(`/flight/${flight.id}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-8">
    <header class="flex items-center justify-between gap-4">
      <div class="flex flex-col gap-1">
        <MonoLabel class="text-primary">Ready to fly · {{ briefTitle }}</MonoLabel>
        <h1 class="text-2xl font-bold tracking-tight text-balance">Send it into isolation</h1>
      </div>
      <RouterLink
        :to="`/brief/${props.id}/checkpoints`"
        class="text-sm text-muted-foreground hover:underline"
      >
        ← Checkpoints
      </RouterLink>
    </header>

    <p v-if="briefNotFound" class="rounded-md border border-border p-4 text-sm text-muted-foreground">
      Brief not found.
    </p>
    <p v-else-if="loading" class="text-sm text-muted-foreground">Loading…</p>

    <section
      v-else-if="!approach"
      class="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-6"
    >
      <p class="text-sm text-muted-foreground">
        No approach yet — shape how this brief is tackled and place your checkpoints first.
      </p>
      <RouterLink :to="`/brief/${props.id}/approach`">
        <Button variant="outline">Shape the approach →</Button>
      </RouterLink>
    </section>

    <template v-else>
      <!-- Sealed-copy diagram: main untouched → worktree + containers (J6.1). -->
      <section class="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
        <MonoLabel>A sealed copy — your work is never at risk</MonoLabel>
        <div class="flex items-center gap-3 text-sm">
          <div class="flex flex-1 flex-col gap-1 rounded-lg border border-border bg-surface-2 p-3">
            <span class="mono-label text-ink-faint">your machine</span>
            <span class="font-semibold">main — untouched</span>
            <span class="text-xs text-muted-foreground">
              {{ repos.length }} {{ repos.length === 1 ? 'repo' : 'repos' }} stay exactly as they are.
            </span>
          </div>
          <span class="shrink-0 text-primary" aria-hidden="true">→</span>
          <div class="flex flex-1 flex-col gap-1 rounded-lg border border-primary bg-accent-wash/60 p-3">
            <span class="mono-label text-primary">isolated workspace</span>
            <span class="font-semibold">worktree + containers</span>
            <span class="text-xs text-muted-foreground">
              Agents edit and run only in here. Torn down when the flight ends.
            </span>
          </div>
        </div>
        <ul v-if="repos.length" class="flex flex-wrap gap-2">
          <li v-for="repo in repos" :key="repo.id">
            <Chip tone="pending">{{ repo.name }}</Chip>
          </li>
        </ul>
      </section>

      <!-- Where it first holds for you (restated from the checkpoints). -->
      <div
        class="flex items-center justify-between gap-4 rounded-lg border border-beacon bg-beacon-wash/40 p-4 text-sm"
      >
        <span class="text-beacon">◆ {{ firstStopText }}</span>
        <RouterLink
          :to="`/brief/${props.id}/checkpoints`"
          class="shrink-0 text-xs text-muted-foreground hover:underline"
        >
          {{ holds }} {{ holds === 1 ? 'checkpoint' : 'checkpoints' }} · edit
        </RouterLink>
      </div>

      <!-- Workspace + flight options, reframed as plain choices (J6.2). -->
      <section class="flex flex-col gap-4">
        <MonoLabel>How it flies</MonoLabel>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">Workspace</span>
            <select
              v-model="executionMode"
              class="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="infra">Isolated workspace (recommended)</option>
              <option value="local_branch">A branch of your checkout</option>
              <option value="read_only">Read-only — agents can’t edit</option>
            </select>
          </label>

          <label v-if="executionMode === 'infra'" class="flex flex-col gap-1">
            <span class="text-sm font-medium">Workspace template</span>
            <input
              v-model="workspaceTemplate"
              type="text"
              placeholder="e.g. api-web — a sprig template"
              class="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
          <label v-else-if="executionMode === 'local_branch'" class="flex flex-col gap-1">
            <span class="text-sm font-medium">Work branch</span>
            <input
              v-model="workBranch"
              type="text"
              placeholder="e.g. rookery/rate-limit"
              class="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>

          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">Max iterations per step</span>
            <input
              v-model.number="maxIterations"
              type="number"
              min="1"
              max="20"
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">Max verification cycles</span>
            <input
              v-model.number="maxVerificationCycles"
              type="number"
              min="1"
              max="10"
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
        </div>

        <label
          v-if="executionMode === 'infra'"
          class="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <input v-model="teardownOnComplete" type="checkbox" class="size-4" />
          Tear the workspace down when the flight ends
        </label>

        <p v-if="executionMode === 'local_branch'" class="text-xs text-muted-foreground">
          Runs on the brief’s own checkout — no sandbox. Changes are left on the branch for you to
          review and land yourself.
        </p>
        <p v-else-if="executionMode === 'read_only'" class="text-xs text-muted-foreground">
          Agents review and propose but never edit files.
        </p>
      </section>

      <!-- Credential guard (J6.4). -->
      <div
        v-if="credentials && !credentialsReady"
        class="flex flex-col gap-1 rounded-lg border border-beacon bg-beacon-wash/50 p-4 text-sm text-beacon"
      >
        <span class="mono-label">Log in before you can fly</span>
        <span class="text-xs">
          No Agent SDK credentials found. Set <code class="font-mono">ANTHROPIC_API_KEY</code> or run
          <code class="font-mono">claude login</code>, then reopen this screen.
        </span>
      </div>

      <footer class="flex items-center justify-between gap-4 border-t border-border pt-5">
        <div class="flex items-center gap-3 text-sm">
          <Chip v-if="credentialsReady" tone="pass" led>credentials ok</Chip>
          <span v-if="!approachValid" class="text-block">
            This approach has unresolved issues — fix it in the approach step first.
          </span>
          <span v-if="error" class="text-block">{{ error }}</span>
        </div>
        <Button size="lg" :disabled="!canBegin" @click="begin">
          {{ starting ? 'Launching…' : '◆ Begin the flight' }}
        </Button>
      </footer>
    </template>
  </div>
</template>
