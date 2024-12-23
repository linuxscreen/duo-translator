import {createApp} from 'vue';
import './style.css';
// @ts-ignore
import App from './App.vue';
import '@mdi/font/css/materialdesignicons.css'
import Vue from 'vue'
import Buefy from 'buefy'
import 'buefy/dist/buefy.css'

// Vuetify
import 'vuetify/styles'
import {createVuetify} from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import router from "@/router";
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
let app = createApp(App).use(router).use(i18n).use(ElementPlus)
app.mount('#app')
app.config.errorHandler = (err) => {
    console.log(err)
}

