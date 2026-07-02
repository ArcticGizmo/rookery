<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '@renderer/lib/markdown'

const props = defineProps<{ source: string }>()

// Sanitized by renderMarkdown (markdown-it html:false + DOMPurify allow-list),
// so v-html is safe here.
const html = computed(() => renderMarkdown(props.source))
</script>

<template>
  <!-- eslint-disable vue/no-v-html -- html is sanitized in renderMarkdown (markdown-it html:false + DOMPurify allow-list) -->
  <div v-if="html" class="prose-rookery text-sm leading-relaxed" v-html="html"></div>
  <!-- eslint-enable vue/no-v-html -->
  <p v-else class="text-sm italic text-muted-foreground">(nothing to show)</p>
</template>

<style scoped>
/* Minimal, self-contained typography for rendered markdown — no external deps. */
.prose-rookery :deep(h1),
.prose-rookery :deep(h2),
.prose-rookery :deep(h3),
.prose-rookery :deep(h4) {
  font-weight: 600;
  line-height: 1.3;
  margin: 0.75em 0 0.35em;
}
.prose-rookery :deep(h1) {
  font-size: 1.3em;
}
.prose-rookery :deep(h2) {
  font-size: 1.15em;
}
.prose-rookery :deep(h3) {
  font-size: 1.05em;
}
.prose-rookery :deep(p),
.prose-rookery :deep(ul),
.prose-rookery :deep(ol),
.prose-rookery :deep(blockquote),
.prose-rookery :deep(pre),
.prose-rookery :deep(table) {
  margin: 0.5em 0;
}
.prose-rookery :deep(ul),
.prose-rookery :deep(ol) {
  padding-left: 1.4em;
}
.prose-rookery :deep(ul) {
  list-style: disc;
}
.prose-rookery :deep(ol) {
  list-style: decimal;
}
.prose-rookery :deep(a) {
  color: var(--color-blue-700, #1d4ed8);
  text-decoration: underline;
}
.prose-rookery :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
  background: color-mix(in srgb, currentColor 10%, transparent);
  padding: 0.1em 0.3em;
  border-radius: 0.25rem;
}
.prose-rookery :deep(pre) {
  background: color-mix(in srgb, currentColor 8%, transparent);
  padding: 0.75em;
  border-radius: 0.375rem;
  overflow-x: auto;
}
.prose-rookery :deep(pre code) {
  background: none;
  padding: 0;
}
.prose-rookery :deep(blockquote) {
  border-left: 3px solid color-mix(in srgb, currentColor 25%, transparent);
  padding-left: 0.75em;
  color: color-mix(in srgb, currentColor 70%, transparent);
}
.prose-rookery :deep(table) {
  border-collapse: collapse;
}
.prose-rookery :deep(th),
.prose-rookery :deep(td) {
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  padding: 0.3em 0.6em;
}
</style>
