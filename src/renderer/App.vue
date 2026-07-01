<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
const links = [
  { to: '/', label: 'Events' },
  { to: '/work-items', label: 'Work items' },
  { to: '/workflows', label: 'Workflows' }
]

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-background text-foreground">
    <header class="border-b border-border">
      <div class="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
        <span class="text-lg font-bold tracking-tight">Rookery</span>
        <nav class="flex items-center gap-1">
          <RouterLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="rounded-md px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            :class="
              isActive(link.to) ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'
            "
          >
            {{ link.label }}
          </RouterLink>
        </nav>
      </div>
    </header>
    <main class="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <RouterView />
    </main>
  </div>
</template>
