import { createRouter, createWebHashHistory } from 'vue-router'
import Desk from '@renderer/views/Desk.vue'

// Hash history so routing works when the renderer is loaded from file:// in production.
//
// Journey route map (Phase J2): the Desk is home; work is followed as a brief →
// approach → flight → story. The old tab paths redirect to their nearest new home.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'desk', component: Desk },

    // Brief authoring
    {
      path: '/brief/new',
      name: 'brief-new',
      component: () => import('@renderer/views/BriefComposer.vue')
    },
    {
      path: '/brief/:id',
      name: 'brief',
      component: () => import('@renderer/views/BriefEditor.vue'),
      props: true
    },
    {
      // Shape how the brief is tackled (Phase J4).
      path: '/brief/:id/approach',
      name: 'brief-approach',
      component: () => import('@renderer/views/ApproachForBrief.vue'),
      props: true
    },
    {
      // Place your checkpoints on the approach's seams (Phase J5).
      path: '/brief/:id/checkpoints',
      name: 'brief-checkpoints',
      component: () => import('@renderer/views/CheckpointRail.vue'),
      props: true
    },
    {
      // Send it into isolation and begin the flight (Phase J6).
      path: '/brief/:id/launch',
      name: 'brief-launch',
      component: () => import('@renderer/views/LaunchFlight.vue'),
      props: true
    },

    // The flight (live) and its story (retrospective — Phase J9 refines; reuse the
    // flight view for now so the route resolves).
    {
      path: '/flight/:id',
      name: 'flight',
      component: () => import('@renderer/views/FlightDetail.vue'),
      props: true
    },
    {
      path: '/story/:id',
      name: 'story',
      component: () => import('@renderer/views/FlightDetail.vue'),
      props: true
    },

    // Secondary surfaces, reachable from the shell (retired/reworked later phases).
    {
      path: '/approaches',
      name: 'approaches',
      component: () => import('@renderer/views/Approaches.vue')
    },
    {
      path: '/approaches/new',
      name: 'approach-new',
      component: () => import('@renderer/views/ApproachBuilder.vue')
    },
    {
      path: '/approaches/:id',
      name: 'approach-edit',
      component: () => import('@renderer/views/ApproachBuilder.vue'),
      props: true
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('@renderer/views/History.vue')
    },
    {
      path: '/agent-run',
      name: 'agent-run',
      component: () => import('@renderer/views/AgentRun.vue')
    },
    {
      // The raw event feed — kept as a low-level surface (History is the richer view).
      path: '/events',
      name: 'events',
      component: () => import('@renderer/views/Home.vue')
    },

    // Journey redesign reference surfaces (Phase J0). Not in the main nav.
    {
      path: '/dev/tokens',
      name: 'dev-tokens',
      component: () => import('@renderer/views/dev/TokensReference.vue')
    },
    {
      path: '/dev/gallery',
      name: 'dev-gallery',
      component: () => import('@renderer/views/dev/PrimitivesGallery.vue')
    },

    // --- Redirects from the retired tab paths → nearest new home ---
    { path: '/dashboard', redirect: '/' },
    { path: '/briefs', redirect: '/' },
    { path: '/briefs/new', redirect: '/brief/new' },
    { path: '/briefs/:id', redirect: (to) => `/brief/${to.params.id}` },
    { path: '/flights', redirect: '/' },
    { path: '/flights/:id', redirect: (to) => `/flight/${to.params.id}` }
  ]
})
