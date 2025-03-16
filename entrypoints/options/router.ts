import { createRouter, createWebHashHistory } from 'vue-router';
import Settings from '@/components/options/Settings.vue';
import Translation from '@/components/options/Translation.vue';
import Shortcuts from '@/components/options/Shortcuts.vue';
// import Navigator from '@/views/Navigator.vue';

const routes = [
    // { path: '/', component: Settings },
    { path: '/settings', component: Settings },
    { path: '/translation', component: Translation },
    { path: '/shortcuts', component: Shortcuts },
    // { path: '/navigator', component: Navigator },
];

const router = createRouter({
    history: createWebHashHistory(),
    routes,
});

export default router;