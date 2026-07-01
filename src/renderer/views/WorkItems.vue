<script setup lang="ts">
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterLink } from 'vue-router'
import Button from '@renderer/components/ui/button/Button.vue'
import { useWorkItemsStore } from '@renderer/stores/work-items'

const store = useWorkItemsStore()
const { items, loading } = storeToRefs(store)

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString()
}

onMounted(() => {
  void store.load()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex items-center justify-between">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-bold tracking-tight">Work items</h1>
        <p class="text-sm text-muted-foreground">A spec plus the repos it touches.</p>
      </div>
      <RouterLink to="/work-items/new">
        <Button>New work item</Button>
      </RouterLink>
    </header>

    <div class="rounded-md border border-border">
      <p v-if="loading" class="p-4 text-sm text-muted-foreground">Loading…</p>
      <p v-else-if="items.length === 0" class="p-4 text-sm text-muted-foreground">
        No work items yet. Create one to get started.
      </p>
      <ul v-else class="divide-y divide-border">
        <li v-for="item in items" :key="item.id">
          <RouterLink
            :to="`/work-items/${item.id}`"
            class="flex items-center justify-between px-4 py-3 hover:bg-accent"
          >
            <span class="font-medium">{{ item.title }}</span>
            <span class="text-xs text-muted-foreground"
              >Updated {{ formatDate(item.updatedAt) }}</span
            >
          </RouterLink>
        </li>
      </ul>
    </div>
  </div>
</template>
