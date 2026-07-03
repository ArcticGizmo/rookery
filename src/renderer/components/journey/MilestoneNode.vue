<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@renderer/lib/utils'

/**
 * One node on a flight's milestone timeline. Render a stack of these and set
 * `line` on all but the last to draw the connecting rail. Slot content is the
 * milestone body (title row, summary, expandable detail).
 */
const props = withDefaults(
  defineProps<{
    state?: 'done' | 'active' | 'pending' | 'beacon' | 'block'
    line?: boolean
    pulse?: boolean
    class?: string
  }>(),
  { state: 'pending', pulse: false, line: false, class: undefined }
)

const knob = computed(
  () =>
    ({
      done: 'bg-pass border-pass',
      active: 'bg-primary border-primary',
      pending: 'bg-surface border-border-strong',
      beacon: 'bg-beacon border-beacon',
      block: 'bg-block border-block'
    })[props.state]
)
</script>

<template>
  <div :class="cn('flex gap-3', props.class)">
    <div class="flex flex-col items-center">
      <span class="relative mt-1 inline-flex size-3.5 shrink-0">
        <span
          v-if="pulse"
          :class="cn('absolute inset-0 rounded-full opacity-60 animate-ping motion-reduce:hidden', knob)"
        />
        <span :class="cn('relative size-full rounded-full border-2', knob)" />
      </span>
      <span v-if="line" class="mt-1 w-0.5 grow bg-border" />
    </div>
    <div class="min-w-0 flex-1 pb-5"><slot /></div>
  </div>
</template>
