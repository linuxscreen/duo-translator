import {createRouter, createWebHistory} from "vue-router";
// @ts-ignore
import Home from "@/components/Home.vue";

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {path: '/home', component: Home, name: 'home'},
    ]
})

export default router