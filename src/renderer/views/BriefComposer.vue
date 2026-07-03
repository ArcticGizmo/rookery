<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from '@renderer/components/ui/button'
import { MonoLabel } from '@renderer/components/journey'
import RepoRowsEditor from '@renderer/components/RepoRowsEditor.vue'
import { useBriefsStore } from '@renderer/stores/briefs'

// The commissioning prompt (Phase J3) — the first thing a new user meets. Author
// the outcome as a brief, attach the repos it touches, and continue to shaping the
// approach. Nothing runs here; this only creates the (versioned, audited) brief.
const router = useRouter()
const store = useBriefsStore()

const title = ref('')
const spec = ref('')
const reposEditor = ref<InstanceType<typeof RepoRowsEditor> | null>(null)

const creating = ref(false)
const error = ref<string | null>(null)

/** Fall back to the first non-empty line of the brief when no name is given. */
function derivedTitle(): string {
  const explicit = title.value.trim()
  if (explicit) return explicit
  const firstLine = spec.value
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l.length > 0)
  return (firstLine ?? '').slice(0, 80)
}

async function shapeApproach(): Promise<void> {
  error.value = null
  const name = derivedTitle()
  if (!name) {
    error.value = 'Describe the work first — a sentence is enough.'
    return
  }
  creating.value = true
  try {
    const detail = await store.create({
      title: name,
      spec: spec.value,
      repos: reposEditor.value?.payload() ?? []
    })
    await router.push(`/brief/${detail.brief.id}/approach`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-8">
    <header class="flex items-center justify-between gap-4">
      <div class="flex flex-col gap-1">
        <MonoLabel class="text-primary">New brief</MonoLabel>
        <h1 class="text-3xl font-bold tracking-tight text-balance">What do you want done?</h1>
      </div>
      <RouterLink to="/" class="text-sm text-muted-foreground hover:underline">← Desk</RouterLink>
    </header>

    <!-- The prompt (this is the versioned spec) -->
    <section class="flex flex-col gap-3 rounded-xl border border-border-strong bg-surface-2 p-5">
      <input
        v-model="title"
        type="text"
        placeholder="A short name (optional — we'll use your first line)"
        class="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <textarea
        v-model="spec"
        rows="10"
        placeholder="Describe the problem or the feature. Write it like a brief for a trusted engineer — the outcome, the constraints, and what “done” looks like."
        class="resize-y rounded-md border border-input bg-background p-3 text-sm leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-ring"
      ></textarea>
    </section>

    <RepoRowsEditor ref="reposEditor" />

    <footer class="flex items-center justify-between gap-4 border-t border-border pt-5">
      <p class="max-w-prose text-sm text-ink-faint">
        Nothing runs yet — you're defining the work. Next you'll shape how it's tackled and where
        you hold the reins.
      </p>
      <div class="flex shrink-0 items-center gap-3">
        <span v-if="error" class="text-sm text-block">{{ error }}</span>
        <Button size="lg" :disabled="creating" @click="shapeApproach">
          {{ creating ? 'Creating…' : 'Shape the approach →' }}
        </Button>
      </div>
    </footer>
  </div>
</template>
