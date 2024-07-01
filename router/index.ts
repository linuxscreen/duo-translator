import {createRouter, createWebHistory} from "vue-router";
import Home from "@/components/Home.vue";
import Profile from "@/components/Profile.vue";
import Settings from "@/components/Settings.vue";
import About from "@/components/About.vue";
import Register from "@/components/Register.vue";
import Login from "@/components/Login.vue";

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {path: '/home', component: Home, name: 'home'},
        {path: '/profile', component: Profile, name: 'profile'},
        {path: '/settings', component: Settings,name:'settings'},
        {path: '/about', component: About,name:'about'},
        {path: '/register', component: Register,name:'register'},
        {path: '/login', component: Login,name:'login'}
    ]
})

export default router