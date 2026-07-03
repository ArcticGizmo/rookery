<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@renderer/lib/utils'

/** A small state pill in the flight-deck vocabulary. `led` adds a status dot. */
const props = withDefaults(
  defineProps<{
    tone?: 'pass' | 'active' | 'pending' | 'beacon' | 'block'
    led?: boolean
    class?: string
  }>(),
  { tone: 'pending', class: undefined }
)

const toneClass = computed(
  () =>
    ({
      pass: 'bg-pass-wash text-pass',
      active: 'bg-accent-wash text-primary',
      pending: 'bg-surface-3 text-ink-faint',
      beacon: 'bg-beacon-wash text-beacon',
      block: 'bg-block-wash text-block'
    })[props.tone]
)
</script>

<template>
  <span
    :class="
      cn(
        'mono-label inline-flex items-center gap-1.5 rounded-full px-2.5 py-1',
        toneClass,
        props.class
      )
    "
  >
    <span v-if="led" class="size-1.5 rounded-full bg-current" />
    <slot />
  </span>
</template>
