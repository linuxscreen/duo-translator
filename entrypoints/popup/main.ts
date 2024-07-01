import {createApp} from 'vue';
import './style.css';
import {createRouter, createWebHistory} from 'vue-router'
import VueRouter from 'vue-router'
import App from './App.vue';
import {createPinia} from 'pinia'
import hello from '@/components/HelloWorld.vue'
import '@mdi/font/css/materialdesignicons.css'

import Home from '@/components/Home.vue'
import Profile from '@/components/Profile.vue'
import Settings from '@/components/Settings.vue'
import About from '@/components/About.vue'
import Register from "@/components/Register.vue";
import Login from "@/components/Login.vue";

import {browser} from "wxt/browser";
// Vuetify
import 'vuetify/styles'
import {createVuetify} from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import router from "@/router";

const vuetify = createVuetify({
    components,
    directives,
})
const pinia = createPinia()
// const router = createRouter({
//     history: createWebHistory(),
//     routes: [
//         {path: '/home', component: Home, name: 'home'},
//         {path: '/profile', component: Profile, name: 'profile'},
//         {path: '/settings', component: Settings,name:'settings'},
//         {path: '/about', component: About,name:'about'},
//         {path: '/register', component: Register,name:'register'},
//         {path: '/login', component: Login,name:'login'}
//     ]
// })
let app = createApp(App).use(router).use(vuetify).use(i18n).use(ElementPlus).use(pinia)
app.mount('#app')
// app.component('hello',hello)
app.config.errorHandler = (err) => {
    console.log(err)
}

