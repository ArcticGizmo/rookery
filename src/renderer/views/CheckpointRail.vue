<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue'
import type { ApproachDefBody, Stage } from '@shared/domain'
import { stageTypeLabel } from '@shared/approach-view'
import {
  defaultCheckpointDescription,
  setHumanHold,
  stageHolds
} from '@shared/checkpoint-rail'
import { useBriefsStore } from '@renderer/stores/briefs'
import { useApproachesStore } from '@renderer/stores/approaches'
import { Button } from '@renderer/components/ui/button'
import { MonoLabel } from '@renderer/components/journey'

// Place your checkpoints (Phase J5). Render the saved approach as a vertical
// rail and, at each seam, choose Hold (drop a human checkpoint — the flight
// waits here until you decide) or Auto (let it run). The final seam is where
// the change lands, held by default. Every toggle round-trips through the
// approach service, so it's validated and audited like any edit.
const props = defineProps<{ id: string }>()
const briefsStore = useBriefsStore()
const approachesStore = useApproachesStore()

const briefTitle = ref('')
const loading = ref(true)
const briefNotFound = ref(false)

const body = ref<ApproachDefBody | null>(null)
const approachId = ref<string | null>(null)

const saving = ref(false)
const error = ref<string | null>(null)

const uid = (): string => crypto.randomUUID()

const holdCount = computed(() => {
  if (!body.value) return 0
  const stageHolds_ = body.value.stages.filter(stageHolds).length
  return stageHolds_ + (body.value.landing.hold ? 1 : 0)
})

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
      stages: structuredClone(linked.stages),
      landing: { ...linked.landing }
    }
  }
  loading.value = false
})

async function persist(): Promise<void> {
  if (!body.value) return
  error.value = null
  saving.value = true
  // Deep-clone to plain objects: reactive proxies can't cross the IPC boundary.
  const payload = structuredClone(toRaw(body.value))
  try {
    if (approachId.value) {
      await approachesStore.update(approachId.value, payload)
    } else {
      const created = await approachesStore.create(payload)
      approachId.value = created.id
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

// Flip a stage's hold optimistically, then persist the whole approach.
async function setStageHold(stage: Stage, hold: boolean): Promise<void> {
  if (hold === stageHolds(stage)) return
  stage.checkpoints = setHumanHold(stage.checkpoints, hold, defaultCheckpointDescription(stage.type), uid)
  await persist()
}

async function setLandingHold(hold: boolean): Promise<void> {
  if (!body.value || hold === body.value.landing.hold) return
  body.value.landing.hold = hold
  await persist()
}
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-8">
    <header class="flex items-center justify-between gap-4">
      <div class="flex flex-col gap-1">
        <MonoLabel class="text-primary">Checkpoints · {{ briefTitle }}</MonoLabel>
        <h1 class="text-2xl font-bold tracking-tight text-balance">Where should this hold for you?</h1>
      </div>
      <RouterLink
        :to="`/brief/${props.id}/approach`"
        class="text-sm text-muted-foreground hover:underline"
      >
        ← Approach
      </RouterLink>
    </header>

    <p v-if="briefNotFound" class="rounded-md border border-border p-4 text-sm text-muted-foreground">
      Brief not found.
    </p>
    <p v-else-if="loading" class="text-sm text-muted-foreground">Loading…</p>

    <section
      v-else-if="!body"
      class="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-6"
    >
      <p class="text-sm text-muted-foreground">
        No approach yet — shape how this brief is tackled first, then drop your checkpoints.
      </p>
      <RouterLink :to="`/brief/${props.id}/approach`">
        <Button variant="outline">Shape the approach →</Button>
      </RouterLink>
    </section>

    <template v-else>
      <p class="max-w-prose text-sm text-muted-foreground">
        Between every step you decide: <b class="text-beacon">◆ Hold</b> for your approval, or let it
        run on <b>Auto</b>. Everything between checkpoints runs unattended; a held checkpoint waits
        indefinitely — the flight never advances past a decision that's yours.
      </p>

      <!-- The rail: one seam (Hold/Auto) per stage, then the landing. -->
      <section class="flex flex-col">
        <div
          v-for="(stage, index) in body.stages"
          :key="stage.id"
          class="flex items-center gap-4 border-l-2 py-3 pl-5"
          :class="stageHolds(stage) ? 'border-beacon' : 'border-border'"
        >
          <span
            class="-ml-[1.625rem] size-2.5 shrink-0 rounded-full ring-4 ring-background"
            :class="stageHolds(stage) ? 'bg-beacon' : 'bg-border-strong'"
          ></span>
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-2">
              <span class="mono-label text-ink-faint">{{ index + 1 }}</span>
              <span class="truncate text-sm font-semibold">{{ stage.name }}</span>
            </div>
            <p class="text-xs text-muted-foreground">
              <template v-if="stageHolds(stage)">
                Checkpoint · holds for you. {{ defaultCheckpointDescription(stage.type) }}.
              </template>
              <template v-else>{{ stageTypeLabel(stage.type) }} — runs unattended.</template>
            </p>
          </div>
          <div class="inline-flex shrink-0 overflow-hidden rounded-full border border-border text-xs">
            <button
              type="button"
              class="px-3 py-1 font-medium transition-colors"
              :class="stageHolds(stage) ? 'bg-beacon-wash text-beacon' : 'text-muted-foreground hover:bg-accent'"
              :disabled="saving"
              @click="setStageHold(stage, true)"
            >
              Hold
            </button>
            <button
              type="button"
              class="border-l border-border px-3 py-1 font-medium transition-colors"
              :class="!stageHolds(stage) ? 'bg-surface-3 text-ink' : 'text-muted-foreground hover:bg-accent'"
              :disabled="saving"
              @click="setStageHold(stage, false)"
            >
              Auto
            </button>
          </div>
        </div>

        <!-- Landing: the final seam — held by default (J5.3). -->
        <div
          class="flex items-center gap-4 border-l-2 py-3 pl-5"
          :class="body.landing.hold ? 'border-beacon' : 'border-border'"
        >
          <span
            class="-ml-[1.625rem] size-2.5 shrink-0 rounded-full ring-4 ring-background"
            :class="body.landing.hold ? 'bg-beacon' : 'bg-border-strong'"
          ></span>
          <div class="min-w-0 flex-1">
            <span class="text-sm font-semibold">How it lands</span>
            <p class="text-xs text-muted-foreground">
              <template v-if="body.landing.hold">
                Checkpoint · holds for you. You decide how it lands — open a PR, or merge it yourself.
              </template>
              <template v-else>Lands automatically once the flight passes.</template>
            </p>
          </div>
          <div class="inline-flex shrink-0 overflow-hidden rounded-full border border-border text-xs">
            <button
              type="button"
              class="px-3 py-1 font-medium transition-colors"
              :class="body.landing.hold ? 'bg-beacon-wash text-beacon' : 'text-muted-foreground hover:bg-accent'"
              :disabled="saving"
              @click="setLandingHold(true)"
            >
              Hold
            </button>
            <button
              type="button"
              class="border-l border-border px-3 py-1 font-medium transition-colors"
              :class="!body.landing.hold ? 'bg-surface-3 text-ink' : 'text-muted-foreground hover:bg-accent'"
              :disabled="saving"
              @click="setLandingHold(false)"
            >
              Auto
            </button>
          </div>
        </div>

        <p v-if="!body.stages.length" class="py-3 pl-5 text-sm text-muted-foreground">
          This approach has no steps yet. Go back and add some first.
        </p>
      </section>

      <footer class="flex items-center justify-between gap-4 border-t border-border pt-5">
        <div class="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{{ holdCount }} {{ holdCount === 1 ? 'checkpoint' : 'checkpoints' }} held</span>
          <span v-if="saving" class="text-ink-faint">Saving…</span>
          <span v-if="error" class="text-block">{{ error }}</span>
        </div>
        <div class="flex shrink-0 items-center gap-3">
          <span class="text-xs text-ink-faint">Next: send it into isolation & begin the flight.</span>
        </div>
      </footer>
    </template>
  </div>
</template>
