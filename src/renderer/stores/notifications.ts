import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { type NotificationItem, computeNotifications } from '@shared/notifications'
import { useEventsStore } from './events'

const OS_PREF_KEY = 'rookery.osNotifications'

function loadOsPref(): boolean {
  try {
    return localStorage.getItem(OS_PREF_KEY) === 'true'
  } catch {
    return false
  }
}

function saveOsPref(value: boolean): void {
  try {
    localStorage.setItem(OS_PREF_KEY, String(value))
  } catch {
    // Storage may be unavailable (e.g. private mode); the toggle just won't persist.
  }
}

function osSupported(): boolean {
  return typeof Notification !== 'undefined'
}

/**
 * In-app + optional OS notifications (Phase 6.5). Derives its list from the live
 * event stream via the pure `computeNotifications` projection and layers ephemeral
 * read state on top. OS toasts fire only for notifications that arrive *live*
 * (not the backfill loaded at startup), and only when the user has opted in and
 * granted browser permission.
 */
export const useNotificationsStore = defineStore('notifications', () => {
  const eventsStore = useEventsStore()
  const readIds = ref<Set<number>>(new Set())
  const osEnabled = ref(loadOsPref())

  /** Highest notification id seen; new ids beyond it are "live" and toast-worthy. */
  let seenMaxId = -1
  let baselineSet = false

  /** Newest first, for display. */
  const items = computed<NotificationItem[]>(() =>
    [...computeNotifications(eventsStore.events)].reverse()
  )
  const unreadCount = computed(() => items.value.filter((n) => !readIds.value.has(n.id)).length)

  function isRead(id: number): boolean {
    return readIds.value.has(id)
  }

  function markRead(id: number): void {
    const next = new Set(readIds.value)
    next.add(id)
    readIds.value = next
  }

  function markAllRead(): void {
    readIds.value = new Set(items.value.map((n) => n.id))
  }

  /** Mark every notification for a run read (e.g. when the user opens it). */
  function markFlightRead(flightId: string): void {
    const next = new Set(readIds.value)
    for (const n of items.value) if (n.flightId === flightId) next.add(n.id)
    readIds.value = next
  }

  /** Opt in to OS notifications, requesting browser permission if needed. */
  async function enableOs(): Promise<boolean> {
    if (!osSupported()) return false
    let permission = Notification.permission
    if (permission === 'default') permission = await Notification.requestPermission()
    osEnabled.value = permission === 'granted'
    saveOsPref(osEnabled.value)
    return osEnabled.value
  }

  function disableOs(): void {
    osEnabled.value = false
    saveOsPref(false)
  }

  // Fire OS toasts for genuinely new notifications. The first observation after
  // load sets the baseline (suppressing toasts for the initial backfill); every
  // arrival after that toasts when enabled + permission granted.
  watch(
    () => eventsStore.events.length,
    () => {
      const all = computeNotifications(eventsStore.events)
      const maxId = all.reduce((max, n) => Math.max(max, n.id), seenMaxId)
      if (!baselineSet) {
        baselineSet = true
        seenMaxId = maxId
        return
      }
      const canToast = osEnabled.value && osSupported() && Notification.permission === 'granted'
      if (canToast) {
        for (const n of all) {
          if (n.id > seenMaxId) new Notification(n.title, { body: n.body })
        }
      }
      seenMaxId = maxId
    }
  )

  return {
    items,
    unreadCount,
    osEnabled,
    osSupported,
    isRead,
    markRead,
    markAllRead,
    markFlightRead,
    enableOs,
    disableOs
  }
})
