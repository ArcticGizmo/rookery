<script setup lang="ts">
import { cn } from '@renderer/lib/utils'

// An uppercase monospace eyebrow/label — the flight-deck "instrument" voice.
const props = defineProps<{ class?: string }>()
</script>

<template>
  <span :class="cn('mono-label text-ink-faint', props.class)"><slot /></span>
</template>
