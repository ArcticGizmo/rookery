<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { Button } from '@renderer/components/ui/button'
import MonoLabel from './MonoLabel.vue'

/**
 * A stand-in for a journey screen not yet built (Phase J2 cutover). States
 * honestly what's coming and links onward to the existing surface that still
 * does the job, so nothing is a dead end during the migration.
 */
defineProps<{
  phase: string
  title: string
  note?: string
  toLabel?: string
  to?: string
}>()
</script>

<template>
  <div class="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center">
    <MonoLabel class="text-primary">Coming here next · {{ phase }}</MonoLabel>
    <h1 class="text-2xl font-bold tracking-tight text-balance">{{ title }}</h1>
    <p v-if="note" class="max-w-prose text-sm text-muted-foreground">{{ note }}</p>
    <RouterLink v-if="to" :to="to" class="mt-2">
      <Button variant="outline">{{ toLabel ?? 'Go there for now' }}</Button>
    </RouterLink>
  </div>
</template>
