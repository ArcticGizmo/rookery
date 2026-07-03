<script setup lang="ts">
import { onMounted, reactive, watch } from 'vue'
import { useTheme } from '@renderer/composables/use-theme'
import { MonoLabel } from '@renderer/components/journey'

// J0.1 — a live reference of every flight-deck token, in both themes.
const { theme, toggle } = useTheme()

const groups: { title: string; tokens: string[] }[] = [
  { title: 'Ground & surface', tokens: ['background', 'card', 'surface-2', 'surface-3', 'muted', 'secondary'] },
  { title: 'Ink', tokens: ['foreground', 'ink-dim', 'ink-faint', 'muted-foreground'] },
  { title: 'Brand', tokens: ['primary', 'accent-wash', 'ring'] },
  { title: 'Semantic', tokens: ['beacon', 'beacon-wash', 'pass', 'pass-wash', 'block', 'block-wash', 'destructive'] },
  { title: 'Lines', tokens: ['border', 'border-strong', 'input'] }
]

const values = reactive<Record<string, string>>({})
function resolveValues(): void {
  const s = getComputedStyle(document.documentElement)
  for (const g of groups) for (const t of g.tokens) values[t] = s.getPropertyValue(`--${t}`).trim()
}
onMounted(resolveValues)
watch(theme, () => requestAnimationFrame(resolveValues))
</script>

<template>
  <div class="mx-auto flex max-w-4xl flex-col gap-8">
    <header class="flex items-start justify-between gap-4">
      <div class="flex flex-col gap-1">
        <MonoLabel class="text-primary">Design tokens · Phase J0.1</MonoLabel>
        <h1 class="text-2xl font-bold tracking-tight">Flight-deck palette</h1>
        <p class="text-sm text-muted-foreground">
          Every token, resolved live for the current theme. Toggle to check both.
        </p>
      </div>
      <button
        type="button"
        class="mono-label rounded-full border border-border bg-surface px-4 py-2 text-ink-dim hover:border-border-strong hover:text-foreground"
        @click="toggle"
      >
        {{ theme === 'dark' ? '☾ Dark' : '☀ Light' }}
      </button>
    </header>

    <section v-for="g in groups" :key="g.title" class="flex flex-col gap-3">
      <MonoLabel>{{ g.title }}</MonoLabel>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div
          v-for="t in g.tokens"
          :key="t"
          class="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
        >
          <span
            class="size-10 shrink-0 rounded-md border border-border-strong"
            :style="{ background: `var(--${t})` }"
          />
          <div class="min-w-0">
            <div class="truncate font-mono text-xs font-medium">--{{ t }}</div>
            <div class="truncate font-mono text-[11px] tabular-nums text-ink-faint">
              {{ values[t] || '…' }}
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-3">
      <MonoLabel>Type & instrument label</MonoLabel>
      <div class="flex flex-col gap-2 rounded-lg border border-border bg-card p-5">
        <h1 class="text-3xl font-bold tracking-tight">Commission the work</h1>
        <h2 class="text-xl font-semibold tracking-tight text-ink-dim">Don't operate the machine</h2>
        <p class="max-w-prose text-sm text-muted-foreground">
          Body copy sits in the system sans at a comfortable measure, with muted ink for
          secondary detail.
        </p>
        <MonoLabel class="mt-1">◇ Needs you · phase 2 of 4 · 46% context</MonoLabel>
      </div>
    </section>
  </div>
</template>
