<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LandingMethod } from '@shared/domain'
import type { LandingTargets } from '@shared/landing'
import Button from '@renderer/components/ui/button/Button.vue'
import { MonoLabel } from '@renderer/components/journey'
import { rookery } from '@renderer/lib/rookery'

/**
 * The landing recap (J9.3): the final checkpoint of the journey. Per-repo land
 * actions — open a PR (`gh`) or merge (`git`) — with audited outcomes, then
 * workspace teardown. Reuses the landing-service behind the flights IPC; shown
 * both on the live flight view and as the closing act of the story.
 */
const props = defineProps<{ flightId: string }>()
const emit = defineEmits<{ changed: [] }>()

const landing = ref<LandingTargets | null>(null)
const by = ref('human')
/** `${repo}:${method}` of the in-flight landing, or null. */
const landingAction = ref<string | null>(null)
const landingError = ref<string | null>(null)
const tearingDown = ref(false)

const providerBlocked = computed(() => landing.value != null && !landing.value.providerAvailable)

async function load(): Promise<void> {
  try {
    landing.value = await rookery().flights.landTargets(props.flightId)
  } catch {
    landing.value = null
  }
}

async function landRepo(repo: string, method: LandingMethod): Promise<void> {
  landingError.value = null
  landingAction.value = `${repo}:${method}`
  try {
    await rookery().flights.land({ flightId: props.flightId, repo, method, by: by.value.trim() || 'human' })
    await load()
    emit('changed')
  } catch (e) {
    landingError.value = e instanceof Error ? e.message : String(e)
  } finally {
    landingAction.value = null
  }
}

async function teardown(): Promise<void> {
  landingError.value = null
  tearingDown.value = true
  try {
    await rookery().flights.teardown(props.flightId)
    await load()
    emit('changed')
  } catch (e) {
    landingError.value = e instanceof Error ? e.message : String(e)
  } finally {
    tearingDown.value = false
  }
}

watch(() => props.flightId, load, { immediate: true })
defineExpose({ reload: load })
</script>

<template>
  <section
    v-if="landing"
    class="flex flex-col gap-3 rounded-xl border border-pass/40 bg-pass-wash/40 p-5"
  >
    <div class="flex items-center justify-between gap-3">
      <MonoLabel class="text-pass">How it landed</MonoLabel>
      <span class="mono-label text-ink-faint">via {{ landing.provider }}</span>
    </div>

    <p v-if="!landing.canLand" class="text-sm text-muted-foreground">{{ landing.reason }}</p>

    <template v-else>
      <p
        v-if="providerBlocked"
        class="rounded-lg border border-beacon/40 bg-beacon-wash/50 px-3 py-2 text-xs text-beacon"
      >
        The “{{ landing.provider }}” landing tooling (git/gh) isn’t available on this machine —
        install it to open PRs or merge.
      </p>

      <p v-if="landing.targets.length === 0" class="text-sm text-muted-foreground">
        No worktrees to land.
      </p>
      <ul v-else class="flex flex-col gap-2">
        <li
          v-for="t in landing.targets"
          :key="t.repo"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          <span class="font-medium">{{ t.repo }}</span>
          <span class="font-mono text-xs text-muted-foreground">{{ t.branch }} → {{ t.base }}</span>
          <span v-if="!t.remoteUrl" class="mono-label text-beacon">no remote</span>
          <span v-if="t.landed" class="rounded bg-pass-wash px-2 py-0.5 mono-label text-pass">landed</span>
          <span class="flex-1"></span>
          <Button
            size="sm"
            variant="outline"
            :disabled="landingAction !== null || !landing.providerAvailable"
            @click="landRepo(t.repo, 'pr')"
            >{{ landingAction === `${t.repo}:pr` ? 'Opening…' : 'Open PR' }}</Button
          >
          <Button
            size="sm"
            variant="ghost"
            :disabled="landingAction !== null || !landing.providerAvailable"
            @click="landRepo(t.repo, 'merge')"
            >{{ landingAction === `${t.repo}:merge` ? 'Merging…' : 'Merge' }}</Button
          >
        </li>
      </ul>

      <div class="flex items-center gap-3">
        <Button variant="ghost" :disabled="tearingDown" @click="teardown">{{
          tearingDown ? 'Tearing down…' : 'Tear down workspace'
        }}</Button>
        <span v-if="landingError" class="text-sm text-block">{{ landingError }}</span>
      </div>
    </template>
  </section>
</template>
