import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@renderer/App.vue'
import { router } from '@renderer/router'
import '@renderer/styles/main.css'

createApp(App).use(createPinia()).use(router).mount('#app')
