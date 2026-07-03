<script setup lang="ts">
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterLink } from 'vue-router'
import { validateApproach } from '@shared/approach-validation'
import Button from '@renderer/components/ui/button/Button.vue'
import { useApproachesStore } from '@renderer/stores/approaches'

const store = useApproachesStore()
const { items, loading } = storeToRefs(store)

function isValid(id: string): boolean {
  const wf = items.value.find((w) => w.id === id)
  if (!wf) return false
  return validateApproach({ name: wf.name, description: wf.description, stages: wf.stages }).ok
}

onMounted(() => {
  void store.load()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex items-center justify-between">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-bold tracking-tight">Approaches</h1>
        <p class="text-sm text-muted-foreground">How work moves through stages and checkpoints.</p>
      </div>
      <RouterLink to="/approaches/new">
        <Button>New approach</Button>
      </RouterLink>
    </header>

    <div class="rounded-md border border-border">
      <p v-if="loading" class="p-4 text-sm text-muted-foreground">Loading…</p>
      <p v-else-if="items.length === 0" class="p-4 text-sm text-muted-foreground">
        No approaches yet. Create one to define your process.
      </p>
      <ul v-else class="divide-y divide-border">
        <li v-for="wf in items" :key="wf.id">
          <RouterLink
            :to="`/approaches/${wf.id}`"
            class="flex items-center justify-between px-4 py-3 hover:bg-accent"
          >
            <span class="flex items-center gap-3">
              <span class="font-medium">{{ wf.name }}</span>
              <span class="text-xs text-muted-foreground">v{{ wf.version }}</span>
              <span class="text-xs text-muted-foreground"
                >{{ wf.stages.length }} stage{{ wf.stages.length === 1 ? '' : 's' }}</span
              >
            </span>
            <span
              class="rounded px-2 py-0.5 text-xs"
              :class="
                isValid(wf.id) ? 'bg-green-500/15 text-green-700' : 'bg-amber-500/15 text-amber-700'
              "
            >
              {{ isValid(wf.id) ? 'Valid' : 'Needs attention' }}
            </span>
          </RouterLink>
        </li>
      </ul>
    </div>
  </div>
</template>
