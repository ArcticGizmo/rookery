<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { SpecDiff, SpecVersion } from '@shared/domain'
import { type RepoProbe, normalizeRepoPath } from '@shared/workspace'
import Button from '@renderer/components/ui/button/Button.vue'
import MarkdownView from '@renderer/components/MarkdownView.vue'
import { rookery } from '@renderer/lib/rookery'
import { useWorkItemsStore } from '@renderer/stores/work-items'

const props = defineProps<{ id?: string }>()
const router = useRouter()
const store = useWorkItemsStore()

interface RepoRow {
  name: string
  localPath: string
  remoteUrl: string
  /** Last probe of `localPath` (transient UI state; not persisted). */
  probe: RepoProbe | null
  /** Directory autocomplete candidates for the current `localPath`. */
  suggestions: string[]
}

const isEdit = computed(() => Boolean(props.id))

const title = ref('')
const spec = ref('')
const repos = ref<RepoRow[]>([])

const history = ref<SpecVersion[]>([])
const diffFrom = ref<number | null>(null)
const diffTo = ref<number | null>(null)
const diff = ref<SpecDiff | null>(null)

const saving = ref(false)
const error = ref<string | null>(null)
const notFound = ref(false)
const specPreview = ref(false)

function addRepo(): void {
  repos.value.push({ name: '', localPath: '', remoteUrl: '', probe: null, suggestions: [] })
}

function removeRepo(index: number): void {
  repos.value.splice(index, 1)
}

// Autocomplete: fetch directory candidates as the user types, converting Windows
// backslashes live. A request id guards against out-of-order responses.
let listRequestId = 0
async function onPathInput(repo: RepoRow): Promise<void> {
  repo.localPath = repo.localPath.replace(/\\/g, '/')
  repo.probe = null // stale until re-probed on blur
  const id = ++listRequestId
  const suggestions = await rookery().workspace.listDirs(repo.localPath)
  if (id === listRequestId) repo.suggestions = suggestions
}

// Probe the path for git-ness + remote URL (on blur or after picking a folder).
async function probeRepoRow(repo: RepoRow): Promise<void> {
  repo.localPath = normalizeRepoPath(repo.localPath)
  if (repo.localPath === '') {
    repo.probe = null
    return
  }
  const probe = await rookery().workspace.probeRepo(repo.localPath)
  repo.probe = probe
  // Infer the remote URL from the checkout when the user hasn't supplied one.
  if (probe.isGitRepo && probe.remoteUrl && repo.remoteUrl.trim() === '') {
    repo.remoteUrl = probe.remoteUrl
  }
}

async function browseRepo(repo: RepoRow): Promise<void> {
  const picked = await rookery().workspace.pickDirectory(repo.localPath || undefined)
  if (picked) {
    repo.localPath = picked
    await probeRepoRow(repo)
  }
}

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
  title.value = detail.workItem.title
  spec.value = detail.currentSpec?.content ?? ''
  repos.value = detail.repos.map((r) => ({
    name: r.name,
    localPath: r.localPath,
    remoteUrl: r.remoteUrl ?? '',
    probe: null,
    suggestions: []
  }))
  // Surface any git warnings for already-attached repos without blocking the load.
  for (const repo of repos.value) void probeRepoRow(repo)
  await loadHistory(id)
}

function reposPayload(): { name: string; localPath: string; remoteUrl: string | undefined }[] {
  return repos.value.map((r) => ({
    name: r.name.trim(),
    localPath: r.localPath.trim(),
    remoteUrl: r.remoteUrl.trim() === '' ? undefined : r.remoteUrl.trim()
  }))
}

async function save(): Promise<void> {
  error.value = null
  if (title.value.trim() === '') {
    error.value = 'Title is required.'
    return
  }
  saving.value = true
  try {
    if (isEdit.value && props.id) {
      await store.update(props.id, { title: title.value.trim(), repos: reposPayload() })
      await store.saveSpec(props.id, spec.value)
      await loadHistory(props.id)
    } else {
      const detail = await store.create({
        title: title.value.trim(),
        spec: spec.value,
        repos: reposPayload()
      })
      await router.push(`/work-items/${detail.workItem.id}`)
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
  await router.push('/work-items')
}

async function showDiff(): Promise<void> {
  if (!props.id || diffFrom.value === null || diffTo.value === null) return
  diff.value = await store.specDiff(props.id, diffFrom.value, diffTo.value)
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString()
}

onMounted(() => {
  if (props.id) void loadDetail(props.id)
})

// Handle navigating between different work items without a full remount.
watch(
  () => props.id,
  (id) => {
    if (id) void loadDetail(id)
  }
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex items-center justify-between">
      <h1 class="text-2xl font-bold tracking-tight">
        {{ isEdit ? 'Edit work item' : 'New work item' }}
      </h1>
      <RouterLink to="/work-items" class="text-sm text-muted-foreground hover:underline">
        ← Back to list
      </RouterLink>
    </header>

    <p v-if="notFound" class="rounded-md border border-border p-4 text-sm text-muted-foreground">
      Work item not found.
    </p>

    <template v-else>
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium" for="title">Title</label>
        <input
          id="title"
          v-model="title"
          type="text"
          placeholder="Add SSO login"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <!-- Repos -->
      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-medium">Repos</h2>
          <Button variant="outline" size="sm" @click="addRepo">Add repo</Button>
        </div>
        <p v-if="repos.length === 0" class="text-sm text-muted-foreground">No repos attached.</p>
        <div v-for="(repo, index) in repos" :key="index" class="flex flex-col gap-1">
          <div class="grid grid-cols-[1fr_1.5fr_1.5fr_auto] items-center gap-2">
            <input
              v-model="repo.name"
              type="text"
              placeholder="name (api)"
              class="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div class="flex items-center gap-1">
              <input
                v-model="repo.localPath"
                type="text"
                :list="`dirs-${index}`"
                placeholder="local path (C:/git/api)"
                class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                @input="onPathInput(repo)"
                @blur="probeRepoRow(repo)"
              />
              <datalist :id="`dirs-${index}`">
                <option v-for="s in repo.suggestions" :key="s" :value="s" />
              </datalist>
              <Button variant="outline" size="sm" @click="browseRepo(repo)">Browse…</Button>
            </div>
            <input
              v-model="repo.remoteUrl"
              type="text"
              placeholder="remote URL (optional)"
              class="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button variant="ghost" size="sm" @click="removeRepo(index)">Remove</Button>
          </div>
          <!-- Non-blocking git hints for the path. -->
          <p
            v-if="repo.probe && repo.localPath && !repo.probe.exists"
            class="text-xs text-amber-700"
          >
            Path not found on disk.
          </p>
          <p v-else-if="repo.probe && !repo.probe.isGitRepo" class="text-xs text-amber-700">
            No <span class="font-mono">.git</span> folder here — you can still attach it, but it
            doesn't look like a git repo.
          </p>
          <p v-else-if="repo.probe && repo.probe.isGitRepo" class="text-xs text-muted-foreground">
            ✓ git repo<template v-if="repo.probe.defaultBranch">
              · {{ repo.probe.defaultBranch }}</template
            ><template v-if="repo.probe.remoteUrl"> · {{ repo.probe.remoteUrl }}</template>
          </p>
        </div>
      </section>

      <!-- Spec -->
      <section class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium" for="spec">Spec (markdown)</label>
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
        <div
          v-if="specPreview"
          class="min-h-[8rem] rounded-md border border-input bg-background p-3"
        >
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
        <Button v-if="isEdit" variant="outline" @click="remove">Delete</Button>
        <span v-if="error" class="text-sm text-red-600">{{ error }}</span>
      </div>

      <!-- Spec version history + diff -->
      <section v-if="isEdit" class="flex flex-col gap-3 border-t border-border pt-6">
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
                'bg-green-500/15 text-green-700': line.kind === 'added',
                'bg-red-500/15 text-red-700': line.kind === 'removed',
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
