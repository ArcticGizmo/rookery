import { createRouter, createWebHashHistory } from 'vue-router'
import Home from '@renderer/views/Home.vue'

// Hash history so routing works when the renderer is loaded from file:// in production.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: '/', name: 'home', component: Home }]
})
