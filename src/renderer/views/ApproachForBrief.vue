<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ApproachDefBody, DoneCriterionType, Stage, StageType } from '@shared/domain'
import { validateApproach } from '@shared/approach-validation'
import { doneCriterionLabel, stageRoles, stageTypeLabel } from '@shared/approach-view'
import { WORKFLOW_TEMPLATES, instantiateTemplate } from '@shared/approach-templates'
import { useBriefsStore } from '@renderer/stores/briefs'
import { useApproachesStore } from '@renderer/stores/approaches'
import { Button } from '@renderer/components/ui/button'
import { Chip, MonoLabel } from '@renderer/components/journey'

// Shape how a brief is tackled (Phase J4). Start from a template (AI drafting is
// layered on next), edit the steps as readable cards, author "Done means…", and
// save the approach against the brief. Checkpoints (Hold/Auto) come in J5.
const props = defineProps<{ id: string }>()
const briefsStore = useBriefsStore()
const approachesStore = useApproachesStore()

const STAGE_TYPES: StageType[] = ['review', 'plan', 'setup', 'implementation', 'verification', 'custom']
const DONE_TYPES: DoneCriterionType[] = ['manual', 'reviewer_approves', 'personas_agree', 'tests_pass']

const briefTitle = ref('')
const briefNotFound = ref(false)
const loading = ref(true)

const body = ref<ApproachDefBody | null>(null)
const approachId = ref<string | null>(null)

const saving = ref(false)
const saved = ref(false)
const error = ref<string | null>(null)

const uid = (): string => crypto.randomUUID()

const validation = computed(() => (body.value ? validateApproach(body.value) : null))

onMounted(async () => {
  const detail = await briefsStore.get(props.id)
  if (!detail) {
    briefNotFound.value = true
    loading.value = false
    return
  }
  briefTitle.value = detail.brief.title
  await approachesStore.load()
  const linked = approachesStore.items.find((a) => a.briefId === props.id)
  if (linked) {
    approachId.value = linked.id
    body.value = {
      name: linked.name,
      description: linked.description,
      briefId: props.id,
      stages: structuredClone(linked.stages)
    }
  }
  loading.value = false
})

function pickTemplate(templateId: string): void {
  const template = WORKFLOW_TEMPLATES.find((t) => t.id === templateId)
  if (!template) return
  body.value = { ...instantiateTemplate(template), briefId: props.id }
  saved.value = false
}

function startBlank(): void {
  body.value = {
    name: `Approach for ${briefTitle.value || 'this brief'}`,
    description: '',
    briefId: props.id,
    stages: []
  }
  saved.value = false
}

function addStage(): void {
  body.value?.stages.push({
    id: uid(),
    name: 'New step',
    type: 'custom',
    personas: [],
    doneCriteria: [],
    checkpoints: []
  })
  saved.value = false
}

function removeStage(index: number): void {
  body.value?.stages.splice(index, 1)
  saved.value = false
}

function moveStage(index: number, dir: -1 | 1): void {
  const stages = body.value?.stages
  if (!stages) return
  const target = index + dir
  if (target < 0 || target >= stages.length) return
  const [moved] = stages.splice(index, 1)
  stages.splice(target, 0, moved!)
  saved.value = false
}

function addCriterion(stage: Stage): void {
  stage.doneCriteria.push({ id: uid(), type: 'manual', description: '' })
  saved.value = false
}

function removeCriterion(stage: Stage, index: number): void {
  stage.doneCriteria.splice(index, 1)
  saved.value = false
}

async function save(): Promise<void> {
  if (!body.value) return
  error.value = null
  saving.value = true
  try {
    if (approachId.value) {
      await approachesStore.update(approachId.value, body.value)
    } else {
      const created = await approachesStore.create(body.value)
      approachId.value = created.id
    }
    saved.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-8">
    <header class="flex items-center justify-between gap-4">
      <div class="flex flex-col gap-1">
        <MonoLabel class="text-primary">Approach · {{ briefTitle }}</MonoLabel>
        <h1 class="text-2xl font-bold tracking-tight text-balance">How should this be tackled?</h1>
      </div>
      <RouterLink :to="`/brief/${props.id}`" class="text-sm text-muted-foreground hover:underline">
        ← Brief
      </RouterLink>
    </header>

    <p v-if="briefNotFound" class="rounded-md border border-border p-4 text-sm text-muted-foreground">
      Brief not found.
    </p>
    <p v-else-if="loading" class="text-sm text-muted-foreground">Loading…</p>

    <!-- Chooser: pick a starting point -->
    <section v-else-if="!body" class="flex flex-col gap-4">
      <p class="max-w-prose text-sm text-muted-foreground">
        Start from a template and edit it to fit. Each is a readable set of steps — review, plan,
        build, verify — that you can reshape.
      </p>
      <div class="grid gap-3 sm:grid-cols-2">
        <button
          v-for="t in WORKFLOW_TEMPLATES"
          :key="t.id"
          type="button"
          class="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-border-strong"
          @click="pickTemplate(t.id)"
        >
          <span class="text-sm font-semibold">{{ t.label }}</span>
          <span class="text-xs text-muted-foreground">{{ t.description }}</span>
        </button>
        <button
          type="button"
          class="flex flex-col gap-1 rounded-xl border border-dashed border-border-strong bg-surface-2 p-4 text-left transition-colors hover:border-primary"
          @click="startBlank"
        >
          <span class="text-sm font-semibold">Start blank</span>
          <span class="text-xs text-muted-foreground">Add your own steps from scratch.</span>
        </button>
      </div>
      <div class="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3">
        <Chip tone="pending">soon</Chip>
        <span class="text-xs text-muted-foreground">
          ✦ Drafting an approach from your brief with an agent arrives in the next step.
        </span>
      </div>
    </section>

    <!-- Editor: readable, editable stage cards -->
    <template v-else>
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium" for="approach-name">Approach name</label>
        <input
          id="approach-name"
          v-model="body.name"
          type="text"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <MonoLabel>The steps</MonoLabel>
          <Button variant="outline" size="sm" @click="addStage">＋ Add step</Button>
        </div>

        <div
          v-for="(stage, index) in body.stages"
          :key="stage.id"
          class="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
        >
          <div class="flex items-start gap-3">
            <span class="mono-label pt-2 text-primary">{{ index + 1 }}</span>
            <div class="flex min-w-0 flex-1 flex-col gap-2">
              <input
                v-model="stage.name"
                type="text"
                class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div class="flex flex-wrap items-center gap-2">
                <select
                  v-model="stage.type"
                  class="h-8 rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option v-for="t in STAGE_TYPES" :key="t" :value="t">{{ stageTypeLabel(t) }}</option>
                </select>
                <Chip v-for="role in stageRoles(stage)" :key="role" tone="pending">{{ role }}</Chip>
                <span v-if="!stage.personas.length" class="text-xs text-ink-faint">no reviewers</span>
              </div>
            </div>
            <div class="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                class="rounded px-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-30"
                :disabled="index === 0"
                title="Move up"
                @click="moveStage(index, -1)"
              >
                ↑
              </button>
              <button
                type="button"
                class="rounded px-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-30"
                :disabled="index === body.stages.length - 1"
                title="Move down"
                @click="moveStage(index, 1)"
              >
                ↓
              </button>
              <button
                type="button"
                class="rounded px-1.5 text-xs text-block hover:bg-block-wash"
                title="Remove step"
                @click="removeStage(index)"
              >
                ✕
              </button>
            </div>
          </div>

          <!-- Done means… -->
          <div class="flex flex-col gap-2 rounded-lg border border-accent-wash bg-accent-wash/50 p-3">
            <div class="flex items-center justify-between">
              <span class="mono-label text-primary">◇ Done means</span>
              <button
                type="button"
                class="text-xs text-primary hover:underline"
                @click="addCriterion(stage)"
              >
                ＋ add
              </button>
            </div>
            <p v-if="!stage.doneCriteria.length" class="text-xs text-ink-faint">
              Nothing required — this step passes on its own.
            </p>
            <div
              v-for="(crit, ci) in stage.doneCriteria"
              :key="crit.id"
              class="flex items-center gap-2"
            >
              <select
                v-model="crit.type"
                class="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option v-for="t in DONE_TYPES" :key="t" :value="t">{{ doneCriterionLabel(t) }}</option>
              </select>
              <input
                v-model="crit.description"
                type="text"
                placeholder="note (optional)"
                class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <button
                type="button"
                class="rounded px-1.5 text-xs text-block hover:bg-block-wash"
                @click="removeCriterion(stage, ci)"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        <p v-if="!body.stages.length" class="text-sm text-muted-foreground">
          No steps yet. Add one, or go back and pick a template.
        </p>
      </section>

      <!-- Validation -->
      <div
        v-if="validation && !validation.ok"
        class="flex flex-col gap-1 rounded-lg border border-beacon bg-beacon-wash/50 p-3 text-xs text-beacon"
      >
        <span class="mono-label">Not runnable yet</span>
        <span v-for="issue in validation.issues" :key="issue.path + issue.message">
          · {{ issue.message }}
        </span>
      </div>

      <footer class="flex items-center justify-between gap-4 border-t border-border pt-5">
        <div class="flex items-center gap-3 text-sm">
          <Chip v-if="validation?.ok" tone="pass" led>runnable</Chip>
          <span v-if="saved" class="text-primary">✓ Saved. Placing checkpoints & sending come next.</span>
          <span v-if="error" class="text-block">{{ error }}</span>
        </div>
        <div class="flex shrink-0 items-center gap-3">
          <RouterLink v-if="approachId" :to="`/approaches/${approachId}`">
            <Button variant="ghost" size="sm">Edit reviewers in builder →</Button>
          </RouterLink>
          <Button size="lg" :disabled="saving" @click="save">
            {{ saving ? 'Saving…' : 'Save approach' }}
          </Button>
        </div>
      </footer>
    </template>
  </div>
</template>
