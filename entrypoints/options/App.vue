<script lang="ts" setup>
import useI18n from "@/composables/useI18n";

import {ref} from 'vue'
import {
    Document,
    Menu as IconMenu,
    Location,
    Setting,
} from '@element-plus/icons-vue'

const isCollapse = ref(true)
const handleOpen = (key: string, keyPath: string[]) => {
    console.log(key, keyPath)
}
const handleClose = (key: string, keyPath: string[]) => {
    console.log(key, keyPath)
}
</script>

<template>
    <v-app>
        <v-main>
            <router-view></router-view>
        </v-main>

        <el-page-header icon="" class="pa-2">
            <template #content>
                <div class="flex items-center ml-15">
                    <el-avatar
                        :size="32"
                        class="mr-3"
                        src="https://cube.elemecdn.com/0/88/03b0d39583f48206768a7534e55bcpng.png"
                    />
                    <span class="text-large font-600 mr-3"> DUO </span>
                    <span class="text-sm mr-2" style="color: var(--el-text-color-regular)">
<!--          Sub title-->
        </span>
                    <!--                    <el-tag>Default</el-tag>-->
                </div>
            </template>
            <template #extra>
                <div class="flex items-center mr-15">
                    <el-button>官网</el-button>
                    <el-button type="primary" class="ml-2">github</el-button>
                </div>
            </template>
        </el-page-header>

        <el-menu
            default-active="2"
            class="el-menu-vertical-demo"
            :collapse="false"
            @open="handleOpen"
            @close="handleClose"
        >
            <!--            <el-sub-menu index="1">-->
            <!--                <template #title>-->
            <!--                    <el-icon>-->
            <!--                        <location/>-->
            <!--                    </el-icon>-->
            <!--                    <span>Navigator One</span>-->
            <!--                </template>-->
            <!--                <el-menu-item-group>-->
            <!--                    <template #title><span>Group One</span></template>-->
            <!--                    <el-menu-item index="1-1">item one</el-menu-item>-->
            <!--                    <el-menu-item index="1-2">item two</el-menu-item>-->
            <!--                </el-menu-item-group>-->
            <!--                <el-menu-item-group title="Group Two">-->
            <!--                    <el-menu-item index="1-3">item three</el-menu-item>-->
            <!--                </el-menu-item-group>-->
            <!--                <el-sub-menu index="1-4">-->
            <!--                    <template #title><span>item four</span></template>-->
            <!--                    <el-menu-item index="1-4-1">item one</el-menu-item>-->
            <!--                </el-sub-menu>-->
            <!--            </el-sub-menu>-->
            <el-menu-item index="1">
                <el-icon>
                    <location/>
                </el-icon>
                <template #title>基础设置</template>
            </el-menu-item>
                <el-menu-item index="2">
                    <el-icon>
                        <icon-menu/>
                    </el-icon>
                    <template #title>翻译服务</template>
                </el-menu-item>
                <el-menu-item index="3">
                    <el-icon>
                        <document/>
                    </el-icon>
                    <template #title>快捷键</template>
                </el-menu-item>
                <el-menu-item index="4">
                    <el-icon>
                        <setting/>
                    </el-icon>
                    <template #title>Navigator Four</template>
                </el-menu-item>
        </el-menu>


    </v-app>


</template>

<style>
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