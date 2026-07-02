import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@renderer/App.vue'
import { router } from '@renderer/router'
import '@renderer/styles/main.css'

// `window.rookery` is injected by the preload script and only exists inside the
// real Electron window. If it's missing, the page was opened in a plain browser
// (e.g. the Vite dev URL) where none of the IPC-backed features work — so bail
// out with a clear message instead of mounting a broken app.
if ((window as Window & { rookery?: unknown }).rookery) {
  createApp(App).use(createPinia()).use(router).mount('#app')
} else {
  const app = document.getElementById('app')
  if (app) {
    app.style.cssText =
      'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:system-ui,sans-serif;text-align:center;color:#e2e8f0;background:#0f172a'
    app.textContent = 'You must use the electron browser'
  }
}
