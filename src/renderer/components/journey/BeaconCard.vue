<script setup lang="ts">
import { cn } from '@renderer/lib/utils'

/**
 * The "needs you" beacon — a calm, human-addressed card reserved for the moments
 * a decision is genuinely the user's. Header takes a title + subtitle (or slots);
 * `actions` slot sits top-right, default slot is the body.
 */
const props = defineProps<{ title?: string; subtitle?: string; class?: string }>()
</script>

<template>
  <div :class="cn('overflow-hidden rounded-xl border border-beacon', props.class)">
    <div class="flex items-center gap-3 border-b border-beacon bg-beacon-wash px-5 py-4">
      <span
        class="grid size-8 shrink-0 place-items-center rounded-lg bg-beacon text-beacon-foreground"
        aria-hidden="true"
        >◆</span
      >
      <div class="min-w-0">
        <div class="font-semibold leading-tight"><slot name="title">{{ title }}</slot></div>
        <div class="mono-label mt-0.5 text-beacon"><slot name="subtitle">{{ subtitle }}</slot></div>
      </div>
      <div class="ml-auto flex items-center gap-2"><slot name="actions" /></div>
    </div>
    <div class="px-5 py-4"><slot /></div>
  </div>
</template>
