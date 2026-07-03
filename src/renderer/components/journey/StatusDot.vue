<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@renderer/lib/utils'

/** A small status indicator; `pulse` adds an animated halo for "live" states. */
const props = withDefaults(
  defineProps<{
    tone?: 'pass' | 'active' | 'pending' | 'beacon' | 'block'
    pulse?: boolean
    size?: 'sm' | 'md'
    class?: string
  }>(),
  { tone: 'pending', size: 'md', class: undefined }
)

const bg = computed(
  () =>
    ({
      pass: 'bg-pass',
      active: 'bg-primary',
      pending: 'bg-border-strong',
      beacon: 'bg-beacon',
      block: 'bg-block'
    })[props.tone]
)
const sz = computed(() => (props.size === 'sm' ? 'size-2' : 'size-3'))
</script>

<template>
  <span :class="cn('relative inline-flex', sz, props.class)">
    <span
      v-if="pulse"
      :class="cn('absolute inset-0 rounded-full opacity-60 animate-ping motion-reduce:hidden', bg)"
    />
    <span :class="cn('relative size-full rounded-full', bg)" />
  </span>
</template>
