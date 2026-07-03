<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { SpecDiff, SpecVersion } from '@shared/domain'
import { Button } from '@renderer/components/ui/button'
import { MonoLabel } from '@renderer/components/journey'
import MarkdownView from '@renderer/components/MarkdownView.vue'
import RepoRowsEditor from '@renderer/components/RepoRowsEditor.vue'
import { useBriefsStore } from '@renderer/stores/briefs'

// Editing an existing brief: its name, repos, and spec (with version history +
// diffs). New briefs are authored in the composer (BriefComposer / /brief/new).
const props = defineProps<{ id: string }>()
const router = useRouter()
const store = useBriefsStore()

const title = ref('')
const spec = ref('')
const reposEditor = ref<InstanceType<typeof RepoRowsEditor> | null>(null)

const history = ref<SpecVersion[]>([])
const diffFrom = ref<number | null>(null)
const diffTo = ref<number | null>(null)
const diff = ref<SpecDiff | null>(null)

const saving = ref(false)
const error = ref<string | null>(null)
const notFound = ref(false)
const specPreview = ref(false)

async function loadHistory(id: string): Promise<void> {
  history.value = await store.specHistory(id)
  if (history.value.length >= 2) {
    diffFrom.value = history.value[history.value.length - 2]!.version
    diffTo.value = history.value[history.value.length - 1]!.version
  } else {
    diffFrom.value = null
    diffTo.value = null
  }
  diff.value = null
}

async function loadDetail(id: string): Promise<void> {
  const detail = await store.get(id)
  if (!detail) {
    notFound.value = true
    return
  }
  notFound.value = false
  title.value = detail.brief.title
  spec.value = detail.currentSpec?.content ?? ''
  reposEditor.value?.setFrom(detail.repos)
  await loadHistory(id)
}

async function save(): Promise<void> {
  error.value = null
  if (title.value.trim() === '') {
    error.value = 'A name is required.'
    return
  }
  saving.value = true
  try {
    await store.update(props.id, {
      title: title.value.trim(),
      repos: reposEditor.value?.payload() ?? []
    })
    await store.saveSpec(props.id, spec.value)
    await loadHistory(props.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  await store.remove(props.id)
  await router.push('/')
}

async function showDiff(): Promise<void> {
  if (diffFrom.value === null || diffTo.value === null) return
  diff.value = await store.specDiff(props.id, diffFrom.value, diffTo.value)
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString()
}

onMounted(() => void loadDetail(props.id))

// Handle navigating between different briefs without a full remount.
watch(
  () => props.id,
  (id) => void loadDetail(id)
)
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-6">
    <header class="flex items-center justify-between gap-4">
      <div class="flex flex-col gap-1">
        <MonoLabel class="text-primary">Brief</MonoLabel>
        <h1 class="text-2xl font-bold tracking-tight">Edit brief</h1>
      </div>
      <RouterLink to="/" class="text-sm text-muted-foreground hover:underline">← Desk</RouterLink>
    </header>

    <p v-if="notFound" class="rounded-md border border-border p-4 text-sm text-muted-foreground">
      Brief not found.
    </p>

    <template v-else>
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium" for="title">Name</label>
        <input
          id="title"
          v-model="title"
          type="text"
          placeholder="Rate-limit the public API"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <RepoRowsEditor ref="reposEditor" />

      <!-- Spec -->
      <section class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium" for="spec">Brief (markdown)</label>
          <div class="flex overflow-hidden rounded-md border border-input text-xs">
            <button
              type="button"
              class="px-2 py-1"
              :class="!specPreview ? 'bg-accent font-medium' : 'text-muted-foreground'"
              @click="specPreview = false"
            >
              Write
            </button>
            <button
              type="button"
              class="border-l border-input px-2 py-1"
              :class="specPreview ? 'bg-accent font-medium' : 'text-muted-foreground'"
              @click="specPreview = true"
            >
              Preview
            </button>
          </div>
        </div>
        <textarea
          v-show="!specPreview"
          id="spec"
          v-model="spec"
          rows="14"
          placeholder="# Feature&#10;Describe the work…"
          class="rounded-md border border-input bg-background p-3 font-mono text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        ></textarea>
        <div v-if="specPreview" class="min-h-[8rem] rounded-md border border-input bg-background p-3">
          <MarkdownView :source="spec" />
        </div>
        <p class="text-xs text-muted-foreground">
          Saving creates a new spec version only when the content changes.
        </p>
      </section>

      <div class="flex items-center gap-3">
        <Button :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </Button>
        <RouterLink :to="`/brief/${props.id}/approach`">
          <Button variant="outline">Shape the approach →</Button>
        </RouterLink>
        <Button variant="ghost" @click="remove">Delete</Button>
        <span v-if="error" class="text-sm text-block">{{ error }}</span>
      </div>

      <!-- Spec version history + diff -->
      <section class="flex flex-col gap-3 border-t border-border pt-6">
        <h2 class="text-sm font-medium">Spec history</h2>
        <p v-if="history.length === 0" class="text-sm text-muted-foreground">No versions yet.</p>
        <ul v-else class="flex flex-col gap-1 text-sm">
          <li v-for="version in history" :key="version.id" class="flex items-center gap-3">
            <span class="w-14 tabular-nums text-muted-foreground">v{{ version.version }}</span>
            <span class="text-muted-foreground">{{ formatDate(version.createdAt) }}</span>
            <span class="font-mono text-xs text-muted-foreground">{{
              version.contentHash.slice(0, 10)
            }}</span>
          </li>
        </ul>

        <div v-if="history.length >= 2" class="flex flex-col gap-3">
          <div class="flex items-center gap-2 text-sm">
            <span>Compare</span>
            <select
              v-model.number="diffFrom"
              class="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option v-for="v in history" :key="v.id" :value="v.version">v{{ v.version }}</option>
            </select>
            <span>→</span>
            <select
              v-model.number="diffTo"
              class="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option v-for="v in history" :key="v.id" :value="v.version">v{{ v.version }}</option>
            </select>
            <Button variant="outline" size="sm" @click="showDiff">Show diff</Button>
          </div>

          <div
            v-if="diff"
            class="overflow-x-auto rounded-md border border-border bg-muted/30 font-mono text-xs"
          >
            <div
              v-for="(line, i) in diff.lines"
              :key="i"
              class="whitespace-pre px-3 py-0.5"
              :class="{
                'bg-pass-wash text-pass': line.kind === 'added',
                'bg-block-wash text-block': line.kind === 'removed',
                'text-muted-foreground': line.kind === 'unchanged'
              }"
            >
              <span class="select-none pr-2 opacity-60">{{
                line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '
              }}</span
              >{{ line.value }}
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
