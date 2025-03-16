<script setup lang="ts">
import useI18n from '@/composables/useI18n';
import { browser } from "wxt/browser";

const { t } = useI18n();

const openShortcuts = () => {
    browser.tabs.create({url: 'chrome://extensions/shortcuts'})
}

</script>

<template>
    <div>
        <el-text>{{ t('pleaseModifyInBrowserSettings') }}-></el-text>
        <el-link type="success" @click="openShortcuts()" target="_blank">{{ t('settings') }}</el-link>
    </div>

</template>

<style scoped>

</style>