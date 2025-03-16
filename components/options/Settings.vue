<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { CONFIG_KEY, DEFAULT_VALUE, LANGUAGES, TRANSLATE_SERVICES, VIEW_STRATEGIES, TB_ACTION, TranslateService } from '@/entrypoints/constants';    
import { getConfig, sendMessageToAllTabs, sendMessageToBackground, setConfig } from '@/entrypoints/utils';
import useI18n from '@/composables/useI18n';
import { get } from 'node:http';

const { t } = useI18n();
const globalSwitch = ref(false)
const bilingualHighlightingSwitch = ref(false)
const floatBallSwitch = ref(false)
const contextMenuSwitch = ref(false)
const viewStrategy = ref('')
const targetLang = ref('')
const translateService = ref('')
const targetLangOptions = LANGUAGES
let translateServiceOptions :TranslateService[] = []
const viewStrategyOptions = VIEW_STRATEGIES

// store globalSwitch when it is changed
watch(globalSwitch, (newVal) => {
    setConfig(CONFIG_KEY.GLOBAL_SWITCH, newVal)
})

watch(bilingualHighlightingSwitch, (newVal) => {
    setConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH, newVal)
})

watch(floatBallSwitch, (newVal) => {
    setConfig(CONFIG_KEY.FLOAT_BALL_SWITCH, newVal)
})

watch(contextMenuSwitch, (newVal) => {
    setConfig(CONFIG_KEY.CONTEXT_MENU_SWITCH, newVal)
    sendMessageToBackground({
        action: TB_ACTION.CONTEXT_MENU_SWITCH,
        data: {
            contextMenuSwitch: newVal
        }
    })
})

// Add watchers for other settings
watch(viewStrategy, (newVal) => {
    setConfig(CONFIG_KEY.VIEW_STRATEGY, newVal)
})

watch(targetLang, (newVal) => {
    setConfig(CONFIG_KEY.TARGET_LANG, newVal)
})

watch(translateService, (newVal) => {
    setConfig(CONFIG_KEY.TRANSLATE_SERVICE, newVal)
})

onMounted(async () => {
    // get globalSwitch from db
    const [switchValue, bilingualHighlightingSwitchValue, floatBallSwitchValue, contextMenuSwitchValue, viewStrategyValue,
           targetLangValue, translateServiceValue, disabledTranslateServiceValue] =
        await Promise.all([
            getConfig(CONFIG_KEY.GLOBAL_SWITCH),
            getConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH),
            getConfig(CONFIG_KEY.FLOAT_BALL_SWITCH),
            getConfig(CONFIG_KEY.CONTEXT_MENU_SWITCH),
            getConfig(CONFIG_KEY.VIEW_STRATEGY),
            getConfig(CONFIG_KEY.TARGET_LANG),
            getConfig(CONFIG_KEY.TRANSLATE_SERVICE),
            getConfig(CONFIG_KEY.DISABLED_TRANSLATE_SERVICE)
        ])
    globalSwitch.value = switchValue === undefined ? true : switchValue
    bilingualHighlightingSwitch.value = bilingualHighlightingSwitchValue === undefined ? false : bilingualHighlightingSwitchValue
    floatBallSwitch.value = floatBallSwitchValue === undefined ? false : floatBallSwitchValue
    contextMenuSwitch.value = contextMenuSwitchValue === undefined ? false : contextMenuSwitchValue
    viewStrategy.value = viewStrategyValue === undefined ? DEFAULT_VALUE.VIEW_STRATEGY : viewStrategyValue
    targetLang.value = targetLangValue === undefined ? DEFAULT_VALUE.TARGET_LANG : targetLangValue
    translateService.value = translateServiceValue === undefined ? DEFAULT_VALUE.TRANSLATE_SERVICE : translateServiceValue
    TRANSLATE_SERVICES.forEach((item) => {
        if (!disabledTranslateServiceValue?.includes(item.value)) {
            translateServiceOptions.push(item)
        }
    })
    console.log(targetLangOptions)
})


</script>

<template>
    <el-row>
        <el-col :span="12">
            <div class="grid-content ep-bg-purple">
                <h1>{{ t('globalSwitch') }}</h1>
            </div>

        </el-col>
        <el-col :span="12">
            <div class="grid-content ep-bg-purple-light">
                <el-switch size="large" v-model="globalSwitch"></el-switch>
            </div>
        </el-col>
    </el-row>

    <el-row>
        <el-col :span="12">
            <div class="grid-content ep-bg-purple">
                <h1>{{ t('bilingualHighlighting') }}</h1>
            </div>
        </el-col>
        <el-col :span="12">
            <div class="grid-content ep-bg-purple-light">
                <el-switch size="large" v-model="bilingualHighlightingSwitch"></el-switch>
            </div>
        </el-col>
    </el-row>

    <el-row>
        <el-col :span="12">
            <div class="grid-content ep-bg-purple">
                <h1>{{ t('floatBall') }}</h1>
            </div>
        </el-col>
        <el-col :span="12">
            <div class="grid-content ep-bg-purple-light">
                <el-switch size="large" v-model="floatBallSwitch"></el-switch>    
            </div>
        </el-col>
    </el-row>

    <el-row>
        <el-col :span="12">
            <div class="grid-content ep-bg-purple">
                <h1>{{ t('contextMenu') }}</h1>
            </div>
        </el-col>
        <el-col :span="12">
            <div class="grid-content ep-bg-purple-light">
                <el-switch size="large" v-model="contextMenuSwitch"></el-switch>    
            </div>
        </el-col>
    </el-row>

    <el-row>
        <el-col :span="12">
            <div class="grid-content ep-bg-purple">
                <h1>{{ t('displayMode') }}</h1>
            </div>

        </el-col>
        <el-col :span="12">
            <div class="grid-content ep-bg-purple-light">
                <el-select v-model="viewStrategy" placeholder="Select" size="large" style="width: 240px">
                    <el-option v-for="item in viewStrategyOptions" :key="item.value" :label="t(item.title)" :value="item.value" />
                </el-select>
            </div>
        </el-col>
    </el-row>

    <el-row>
        <el-col :span="12">
            <div class="grid-content ep-bg-purple">
                <h1>{{ t('targetLanguage') }}</h1>
            </div>

        </el-col>
        <el-col :span="12">
            <div class="grid-content ep-bg-purple-light">
                <el-select v-model="targetLang" placeholder="Select" size="large" style="width: 240px">
                    <el-option v-for="item in targetLangOptions" :key="item.value" :label="t(item.title)" :value="item.value" />
                </el-select>
            </div>
        </el-col>
    </el-row>

    <el-row>
        <el-col :span="12">
            <div class="grid-content ep-bg-purple">
                <h1>{{ t('translateService') }}</h1>
            </div>

        </el-col>
        <el-col :span="12">
            <div class="grid-content ep-bg-purple-light">
                <el-select v-model="translateService" placeholder="Select" size="large" style="width: 240px">
                    <el-option v-for="item in translateServiceOptions" :key="item.value" :label="t(item.title)" :value="item.value" />
                </el-select>
            </div>
        </el-col>
    </el-row>

</template>

<style scoped>
.el-row {
    margin-bottom: 10px;
}
</style>