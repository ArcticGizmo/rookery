import { createRouter, createWebHashHistory } from 'vue-router'
import Home from '@renderer/views/Home.vue'

// Hash history so routing works when the renderer is loaded from file:// in production.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: Home },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@renderer/views/Dashboard.vue')
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('@renderer/views/History.vue')
    },
    {
      path: '/work-items',
      name: 'work-items',
      component: () => import('@renderer/views/WorkItems.vue')
    },
    {
      path: '/work-items/new',
      name: 'work-item-new',
      component: () => import('@renderer/views/WorkItemEditor.vue')
    },
    {
      path: '/work-items/:id',
      name: 'work-item-edit',
      component: () => import('@renderer/views/WorkItemEditor.vue'),
      props: true
    },
    {
      path: '/workflows',
      name: 'workflows',
      component: () => import('@renderer/views/Workflows.vue')
    },
    {
      path: '/workflows/new',
      name: 'workflow-new',
      component: () => import('@renderer/views/WorkflowBuilder.vue')
    },
    {
      path: '/workflows/:id',
      name: 'workflow-edit',
      component: () => import('@renderer/views/WorkflowBuilder.vue'),
      props: true
    },
    {
      path: '/agent-run',
      name: 'agent-run',
      component: () => import('@renderer/views/AgentRun.vue')
    },
    {
      path: '/runs',
      name: 'runs',
      component: () => import('@renderer/views/Runs.vue')
    },
    {
      path: '/runs/:id',
      name: 'run-detail',
      component: () => import('@renderer/views/RunDetail.vue'),
      props: true
    }
  ]
})
