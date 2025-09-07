<script lang="ts" setup>
import useI18n from "@/composables/useI18n";
import { browser } from "wxt/browser";
import {useRouter} from "vue-router";
import { onMounted } from 'vue'

const { t } = useI18n();
const router = useRouter()

onMounted(() => {
  // Check if we're not already on a valid route
    if (router.currentRoute.value.path === '/') {
        router.push('/settings')
    }
})

import {ref} from 'vue'
import {
    Document,
    Menu as IconMenu,
    Location,
    Setting, Key,
} from '@element-plus/icons-vue'

const isCollapse = ref(true)
const handleOpen = (key: string, keyPath: string[]) => {
    console.log(key, keyPath)
}
const handleClose = (key: string, keyPath: string[]) => {
    console.log(key, keyPath)
}

function openUrl(url: string) {
    browser.tabs.create({url: url})
}
</script>

<template>
    <v-app>
        <div class="main-page">
            <el-page-header icon="" class="pa-2">
                <template #content>
                    <div class="ml-5" style="display: flex;flex-direction: row;align-items: center">
                        <img src="/DuoTranslator.svg" width="48" height="48" alt="">
                        <span class="text-large font-600 mr-3" style="display: flex;align-items: center"> DUO </span>
                    </div>
                </template>
                <template #extra>
                    <div class="flex items-center mr-15">
                        <el-button @click="openUrl('https://duo.zeroflx.com/')">{{ t('officialWebsite') }}</el-button>
                        <el-button type="primary" class="ml-2" @click="openUrl('https://github.com/linuxscreen/duo-translator')">GitHub</el-button>
                    </div>
                </template>
            </el-page-header>
            <div style="display: flex;flex-direction: row">
                <el-menu
                    default-active="1"
                    class="el-menu-vertical-demo"
                    :collapse="false"
                    router="true"
                    @open="handleOpen"
                    @close="handleClose"
                >
                    <el-menu-item index="1" route="/settings">
                        <el-icon>
                            <Setting/>
                        </el-icon>
                        <template #title>{{ t('basicSettings') }}</template>
                    </el-menu-item>
                    <el-menu-item index="2" route="/translation">
                        <el-icon>
                            <icon-menu/>
                        </el-icon>
                        <template #title>{{ t('translationService') }}</template>
                    </el-menu-item>
                    <el-menu-item index="3" route="/shortcuts">
                        <el-icon>
                            <Key />
                        </el-icon>
                        <template #title>{{ t('shortcuts') }}</template>
                    </el-menu-item>
                </el-menu>
                <div style="width: 100%;margin: 30px">
                    <router-view></router-view>
                </div>
            </div>


        </div>
    </v-app>


</template>

<style>
.main-page {
    width: 70%;
    margin: 0 auto;

}

.el-menu-vertical-demo:not(.el-menu--collapse) {
    width: 200px;
    min-height: 400px;
}

.el-page-header__back {
    display: none !important;
}

.el-divider--vertical {
    display: none !important;
}

.el-page-header__header {

}
</style>