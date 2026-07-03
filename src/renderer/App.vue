<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import type { NotificationItem } from '@shared/notifications'
import { useEventsStore } from '@renderer/stores/events'
import { useNotificationsStore } from '@renderer/stores/notifications'
import { useTheme } from '@renderer/composables/use-theme'
import { rookery } from '@renderer/lib/rookery'

const route = useRoute()
const router = useRouter()
const eventsStore = useEventsStore()
const notifications = useNotificationsStore()
const { items, unreadCount, osEnabled } = storeToRefs(notifications)
const { theme, toggle: toggleTheme } = useTheme()

const links = [
  { to: '/dashboard', label: 'Activity' },
  { to: '/runs', label: 'Runs' },
  { to: '/briefs', label: 'Work items' },
  { to: '/approaches', label: 'Approaches' },
  { to: '/agent-run', label: 'Agent run' },
  { to: '/history', label: 'History' },
  { to: '/', label: 'Events' }
]

const open = ref(false)
const resetting = ref(false)

// Only present in dev builds (`electron-vite dev`); tree-shaken out of releases.
const isDev = import.meta.env.DEV

async function resetAllData(): Promise<void> {
  if (resetting.value) return
  const ok = window.confirm(
    'Delete ALL local data — work items, runs, approaches, and the event log?\n\nThis cannot be undone.'
  )
  if (!ok) return
  resetting.value = true
  try {
    await rookery().debug.resetData()
    // Every store caches data loaded on mount; a reload re-fetches from the now
    // empty database rather than trying to reconcile each store by hand.
    window.location.reload()
  } catch (error) {
    resetting.value = false
    window.alert(`Failed to reset data: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(`${to}/`)
}

function openNotification(n: NotificationItem): void {
  notifications.markRead(n.id)
  open.value = false
  if (n.kind === 'update') {
    // Quit and relaunch into the downloaded update (Phase 7.3).
    void rookery().update.install()
    return
  }
  if (n.runId) {
    notifications.markRunRead(n.runId)
    void router.push(`/runs/${n.runId}`)
  }
}

function notificationIcon(kind: NotificationItem['kind']): string {
  if (kind === 'checkpoint') return '⏸'
  if (kind === 'update') return '⬆'
  return '⚠'
}

async function toggleOs(): Promise<void> {
  if (osEnabled.value) notifications.disableOs()
  else await notifications.enableOs()
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString()
}

onMounted(() => {
  void eventsStore.init()
})
</script>

<template>
  <div class="flex min-h-screen flex-col bg-background text-foreground">
    <header class="border-b border-border">
      <div class="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
        <span class="text-lg font-bold tracking-tight">Rookery</span>
        <nav class="flex items-center gap-1">
          <RouterLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="rounded-md px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            :class="
              isActive(link.to) ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'
            "
          >
            {{ link.label }}
          </RouterLink>
        </nav>

        <!-- Journey redesign reference surfaces (Phase J0, dev builds only) -->
        <RouterLink
          v-if="isDev"
          to="/dev/gallery"
          class="ml-auto rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          title="Journey component kit (dev only)"
        >
          Kit
        </RouterLink>

        <!-- Theme toggle -->
        <button
          type="button"
          class="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          :class="isDev ? '' : 'ml-auto'"
          :aria-label="`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`"
          @click="toggleTheme"
        >
          <span class="text-base leading-none">{{ theme === 'dark' ? '☾' : '☀' }}</span>
        </button>

        <!-- Debug-only: wipe all local data (dev builds only) -->
        <button
          v-if="isDev"
          type="button"
          class="rounded-md border border-red-500/40 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-500/10 disabled:opacity-50"
          :disabled="resetting"
          title="Delete all local data (dev only)"
          @click="resetAllData"
        >
          {{ resetting ? 'Resetting…' : 'Reset data' }}
        </button>

        <!-- Notifications (Phase 6.5) -->
        <div class="relative">
          <button
            type="button"
            class="relative flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            :aria-label="`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`"
            @click="open = !open"
          >
            <span class="text-lg leading-none">🔔</span>
            <span
              v-if="unreadCount"
              class="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white"
              >{{ unreadCount > 9 ? '9+' : unreadCount }}</span
            >
          </button>

          <!-- Click-away backdrop -->
          <div v-if="open" class="fixed inset-0 z-10" @click="open = false"></div>

          <div
            v-if="open"
            class="absolute right-0 z-20 mt-2 w-80 rounded-md border border-border bg-card shadow-lg"
          >
            <div class="flex items-center justify-between border-b border-border px-3 py-2">
              <span class="text-sm font-semibold">Notifications</span>
              <button
                type="button"
                class="text-xs text-muted-foreground hover:underline disabled:opacity-50"
                :disabled="unreadCount === 0"
                @click="notifications.markAllRead()"
              >
                Mark all read
              </button>
            </div>

            <ul v-if="items.length" class="max-h-80 divide-y divide-border overflow-y-auto">
              <li v-for="n in items" :key="n.id">
                <button
                  type="button"
                  class="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-accent"
                  :class="notifications.isRead(n.id) ? 'opacity-60' : ''"
                  @click="openNotification(n)"
                >
                  <span class="flex items-center gap-2 text-sm">
                    <span>{{ notificationIcon(n.kind) }}</span>
                    <span :class="notifications.isRead(n.id) ? '' : 'font-semibold'">{{
                      n.title
                    }}</span>
                    <span
                      v-if="!notifications.isRead(n.id)"
                      class="ml-auto size-2 rounded-full bg-red-500"
                    ></span>
                  </span>
                  <span class="text-xs text-muted-foreground">{{ n.body }}</span>
                  <span class="text-[10px] text-muted-foreground">{{ formatTime(n.ts) }}</span>
                </button>
              </li>
            </ul>
            <p v-else class="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing needs your attention.
            </p>

            <label
              class="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground"
            >
              <input type="checkbox" class="size-3.5" :checked="osEnabled" @change="toggleOs" />
              Also show OS notifications
            </label>
          </div>
        </div>
      </div>
    </header>
    <main class="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <RouterView />
    </main>
  </div>
</template>
