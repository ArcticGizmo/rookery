<script setup lang="ts">
import EventLog from '@renderer/components/EventLog.vue'
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold tracking-tight">Event log</h1>
      <p class="text-sm text-muted-foreground">
        Every meaningful change is appended here as it happens.
      </p>
    </header>
    <EventLog />
  </div>
</template>
