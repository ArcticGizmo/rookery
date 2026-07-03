<script setup lang="ts">
import { JourneyPlaceholder } from '@renderer/components/journey'

// Placeholder for the per-brief approach step (Phase J4 builds the AI-drafted,
// editable approach + "Done means…"). Until then, point at the approach library.
defineProps<{ id: string }>()
</script>

<template>
  <JourneyPlaceholder
    phase="Phase J4"
    title="Shape the approach"
    note="This is where an agent will draft how the brief gets tackled — readable stages, roles, and a first-class “Done means…” — for you to edit. Until it's built, author a reusable approach in the library."
    to="/approaches"
    to-label="Open the approach library"
  />
</template>
