<script setup lang="ts">
import EventLog from '@renderer/components/EventLog.vue'
</script>

<template>
  <main
    class="mx-auto flex min-h-screen max-w-4xl flex-col items-center gap-8 bg-background px-6 py-10 text-foreground"
  >
    <header class="flex flex-col items-center gap-1">
      <h1 class="text-3xl font-bold tracking-tight">Rookery</h1>
      <p class="text-sm text-muted-foreground">Agent orchestrator &amp; workflow desktop app</p>
    </header>
    <EventLog />
  </main>
</template>
