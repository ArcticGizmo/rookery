import { ref } from 'vue'

/**
 * Light/dark theme handling for the flight-deck UI (Phase J0.1).
 *
 * Toggles the `.dark` class on <html> (the shadcn/Tailwind dark variant) and
 * persists the choice. Module-level state so every caller shares one source of
 * truth; the first `useTheme()` call resolves the initial theme from storage,
 * falling back to the OS preference.
 */

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'rookery.theme'
const theme = ref<Theme>('light')
let initialized = false

function apply(next: Theme): void {
  document.documentElement.classList.toggle('dark', next === 'dark')
}

function initialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme(): {
  theme: typeof theme
  setTheme: (next: Theme) => void
  toggle: () => void
} {
  if (!initialized) {
    initialized = true
    theme.value = initialTheme()
    apply(theme.value)
  }

  function setTheme(next: Theme): void {
    theme.value = next
    localStorage.setItem(STORAGE_KEY, next)
    apply(next)
  }

  function toggle(): void {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  return { theme, setTheme, toggle }
}
