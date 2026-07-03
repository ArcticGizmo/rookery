<script setup lang="ts">
import { computed, onMounted, ref, toRaw, watch } from 'vue'
import { useRouter } from 'vue-router'
import type {
  AgentPersona,
  Checkpoint,
  PassCriterion,
  Stage,
  StageType,
  PassCriterionType,
  CheckpointKind
} from '@shared/domain'
import { validateApproach } from '@shared/approach-validation'
import { KNOWN_MODELS } from '@shared/models'
import { WORKFLOW_TEMPLATES, instantiateTemplate } from '@shared/approach-templates'
import Button from '@renderer/components/ui/button/Button.vue'
import { useApproachesStore } from '@renderer/stores/approaches'

const props = defineProps<{ id?: string }>()
const router = useRouter()
const store = useApproachesStore()

const STAGE_TYPES: StageType[] = [
  'review',
  'plan',
  'setup',
  'implementation',
  'verification',
  'custom'
]
const CRITERION_TYPES: PassCriterionType[] = [
  'reviewer_approves',
  'personas_agree',
  'tests_pass',
  'manual'
]
const GATE_KINDS: CheckpointKind[] = ['human', 'automated']

const isEdit = computed(() => Boolean(props.id))

const name = ref('')
const description = ref('')
const stages = ref<Stage[]>([])

const saving = ref(false)
const error = ref<string | null>(null)
const notFound = ref(false)
// New approaches begin at a template chooser; editing an existing one skips it.
const showTemplateChooser = ref(false)

const validation = computed(() =>
  validateApproach({ name: name.value, description: description.value, stages: stages.value })
)

function issuesFor(prefix: string): string[] {
  return validation.value.issues.filter((i) => i.path.startsWith(prefix)).map((i) => i.message)
}

function uid(): string {
  return crypto.randomUUID()
}

/** Seed the builder from a template (or start blank), then dismiss the chooser. */
function useTemplate(templateId: string | null): void {
  showTemplateChooser.value = false
  if (!templateId) return // blank — leave the empty defaults in place
  const template = WORKFLOW_TEMPLATES.find((t) => t.id === templateId)
  if (!template) return
  const body = instantiateTemplate(template, uid)
  name.value = body.name
  description.value = body.description
  stages.value = body.stages
}

function addStage(): void {
  const stage: Stage = {
    id: uid(),
    name: `Stage ${stages.value.length + 1}`,
    type: 'review',
    personas: [],
    passCriteria: [],
    checkpoints: []
  }
  stages.value.push(stage)
}

function removeStage(index: number): void {
  stages.value.splice(index, 1)
}

function moveStage(index: number, direction: -1 | 1): void {
  const target = index + direction
  if (target < 0 || target >= stages.value.length) return
  const arr = stages.value
  const moved = arr[index]!
  arr[index] = arr[target]!
  arr[target] = moved
}

function addPersona(stage: Stage): void {
  const persona: AgentPersona = {
    id: uid(),
    name: '',
    role: '',
    systemPrompt: '',
    model: ''
  }
  stage.personas.push(persona)
}

function addCriterion(stage: Stage): void {
  const criterion: PassCriterion = { id: uid(), type: 'manual', description: '' }
  stage.passCriteria.push(criterion)
}

function addCheckpoint(stage: Stage): void {
  const checkpoint: Checkpoint = { id: uid(), kind: 'human', description: '' }
  stage.checkpoints.push(checkpoint)
}

function removeFrom<T>(arr: T[], index: number): void {
  arr.splice(index, 1)
}

async function load(id: string): Promise<void> {
  const wf = await store.get(id)
  if (!wf) {
    notFound.value = true
    return
  }
  name.value = wf.name
  description.value = wf.description
  stages.value = wf.stages
}

async function save(): Promise<void> {
  error.value = null
  saving.value = true
  // Deep-clone to plain objects: reactive proxies can't cross the IPC boundary.
  const body = structuredClone({
    name: name.value.trim(),
    description: description.value,
    stages: toRaw(stages.value)
  })
  try {
    if (isEdit.value && props.id) {
      await store.update(props.id, body)
    } else {
      const created = await store.create(body)
      await router.push(`/approaches/${created.id}`)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  if (!props.id) return
  await store.remove(props.id)
  await router.push('/approaches')
}

const inputClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring'

onMounted(() => {
  if (props.id) void load(props.id)
  else showTemplateChooser.value = true
})

watch(
  () => props.id,
  (id) => {
    if (id) void load(id)
  }
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex items-center justify-between">
      <h1 class="text-2xl font-bold tracking-tight">
        {{ isEdit ? 'Edit approach' : 'New approach' }}
      </h1>
      <RouterLink to="/approaches" class="text-sm text-muted-foreground hover:underline">
        ← Back to list
      </RouterLink>
    </header>

    <p v-if="notFound" class="rounded-md border border-border p-4 text-sm text-muted-foreground">
      Approach not found.
    </p>

    <!-- Template chooser (new approaches only). -->
    <section v-else-if="showTemplateChooser" class="flex flex-col gap-3">
      <h2 class="text-sm font-medium">Start from a template</h2>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <button
          type="button"
          class="flex flex-col gap-1 rounded-md border border-border p-4 text-left hover:border-ring hover:bg-accent"
          @click="useTemplate(null)"
        >
          <span class="text-sm font-medium">Blank</span>
          <span class="text-xs text-muted-foreground">Start from scratch with no stages.</span>
        </button>
        <button
          v-for="t in WORKFLOW_TEMPLATES"
          :key="t.id"
          type="button"
          class="flex flex-col gap-1 rounded-md border border-border p-4 text-left hover:border-ring hover:bg-accent"
          @click="useTemplate(t.id)"
        >
          <span class="text-sm font-medium">{{ t.label }}</span>
          <span class="text-xs text-muted-foreground">{{ t.description }}</span>
        </button>
      </div>
    </section>

    <template v-else>
      <!-- Autocomplete source for persona model fields (free text still allowed). -->
      <datalist id="model-list">
        <option v-for="m in KNOWN_MODELS" :key="m" :value="m" />
      </datalist>

      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium" for="wf-name">Name</label>
        <input
          id="wf-name"
          v-model="name"
          type="text"
          placeholder="Basic feature"
          :class="inputClass"
        />
      </div>
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium" for="wf-desc">Description</label>
        <input
          id="wf-desc"
          v-model="description"
          type="text"
          placeholder="Optional summary"
          :class="inputClass"
        />
      </div>

      <!-- Validation summary -->
      <div
        class="rounded-md border p-3 text-sm"
        :class="
          validation.ok
            ? 'border-green-500/40 bg-green-500/10 text-green-700'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-700'
        "
      >
        <template v-if="validation.ok">✓ Approach is valid and ready to run.</template>
        <template v-else>
          <p class="font-medium">
            {{ validation.issues.length }} issue(s) to resolve before running:
          </p>
          <ul class="mt-1 list-inside list-disc">
            <li v-for="(issue, i) in validation.issues" :key="i">
              <span class="font-mono text-xs">{{ issue.path }}</span> — {{ issue.message }}
            </li>
          </ul>
        </template>
      </div>

      <!-- Stages -->
      <section class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Stages</h2>
          <Button variant="outline" size="sm" @click="addStage">Add stage</Button>
        </div>

        <p v-if="stages.length === 0" class="text-sm text-muted-foreground">
          No stages yet. A approach needs at least one.
        </p>

        <article
          v-for="(stage, sIndex) in stages"
          :key="stage.id"
          class="flex flex-col gap-4 rounded-md border border-border p-4"
        >
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium text-muted-foreground">#{{ sIndex + 1 }}</span>
            <input
              v-model="stage.name"
              type="text"
              placeholder="Stage name"
              :class="[inputClass, 'flex-1']"
            />
            <select
              v-model="stage.type"
              class="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option v-for="t in STAGE_TYPES" :key="t" :value="t">{{ t }}</option>
            </select>
            <Button
              variant="ghost"
              size="sm"
              :disabled="sIndex === 0"
              @click="moveStage(sIndex, -1)"
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              :disabled="sIndex === stages.length - 1"
              @click="moveStage(sIndex, 1)"
            >
              ↓
            </Button>
            <Button variant="ghost" size="sm" @click="removeStage(sIndex)">Remove</Button>
          </div>

          <ul
            v-if="issuesFor(`stages[${sIndex}]`).length > 0"
            class="list-inside list-disc rounded bg-amber-500/10 p-2 text-xs text-amber-700"
          >
            <li v-for="(msg, i) in issuesFor(`stages[${sIndex}]`)" :key="i">{{ msg }}</li>
          </ul>

          <!-- Personas -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-medium">Personas</h3>
              <Button variant="outline" size="sm" @click="addPersona(stage)">Add persona</Button>
            </div>
            <div
              v-for="(persona, pIndex) in stage.personas"
              :key="persona.id"
              class="flex flex-col gap-2 rounded border border-border/60 p-2"
            >
              <div class="flex items-center gap-2">
                <input
                  v-model="persona.name"
                  type="text"
                  placeholder="Name (Alex)"
                  :class="[inputClass, 'flex-1']"
                />
                <input
                  v-model="persona.role"
                  type="text"
                  placeholder="Role (Tech Lead)"
                  :class="[inputClass, 'flex-1']"
                />
                <input
                  v-model="persona.model"
                  type="text"
                  list="model-list"
                  placeholder="Model (optional)"
                  :class="[inputClass, 'w-40']"
                />
                <Button variant="ghost" size="sm" @click="removeFrom(stage.personas, pIndex)"
                  >Remove</Button
                >
              </div>
              <textarea
                v-model="persona.systemPrompt"
                rows="2"
                placeholder="System prompt / instructions"
                class="rounded-md border border-input bg-background p-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              ></textarea>
            </div>
          </div>

          <!-- Pass criteria -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-medium">Pass criteria</h3>
              <Button variant="outline" size="sm" @click="addCriterion(stage)"
                >Add criterion</Button
              >
            </div>
            <div
              v-for="(criterion, cIndex) in stage.passCriteria"
              :key="criterion.id"
              class="flex items-center gap-2"
            >
              <select
                v-model="criterion.type"
                class="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option v-for="t in CRITERION_TYPES" :key="t" :value="t">{{ t }}</option>
              </select>
              <input
                v-model="criterion.description"
                type="text"
                placeholder="Description (optional)"
                :class="[inputClass, 'flex-1']"
              />
              <Button variant="ghost" size="sm" @click="removeFrom(stage.passCriteria, cIndex)">
                Remove
              </Button>
            </div>
          </div>

          <!-- Checkpoints -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-medium">Checkpoints</h3>
              <Button variant="outline" size="sm" @click="addCheckpoint(stage)">Add checkpoint</Button>
            </div>
            <div
              v-for="(checkpoint, gIndex) in stage.checkpoints"
              :key="checkpoint.id"
              class="flex items-center gap-2"
            >
              <select
                v-model="checkpoint.kind"
                class="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option v-for="k in GATE_KINDS" :key="k" :value="k">{{ k }}</option>
              </select>
              <input
                v-model="checkpoint.description"
                type="text"
                placeholder="What this checkpoint checks"
                :class="[inputClass, 'flex-1']"
              />
              <Button variant="ghost" size="sm" @click="removeFrom(stage.checkpoints, gIndex)"
                >Remove</Button
              >
            </div>
          </div>
        </article>
      </section>

      <div class="flex items-center gap-3 border-t border-border pt-4">
        <Button :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save approach' }}</Button>
        <Button v-if="isEdit" variant="outline" @click="remove">Delete</Button>
        <span v-if="error" class="text-sm text-red-600">{{ error }}</span>
      </div>
    </template>
  </div>
</template>
