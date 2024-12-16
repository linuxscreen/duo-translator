<script lang="ts">
import {ref} from 'vue';
import CustomColorPicker from "@/components/CustomColorPicker.vue";
import CustomSwitch from "@/components/CustomSwitch.vue";
import {sendMessageToBackground, sendMessageToTab} from "@/entrypoints/utils";
import {
    ACTION,
    COMMON,
    CONFIG_KEY,
    DB_ACTION,
    DOMAIN_STRATEGY,
    LANGUAGES,
    STORAGE_ACTION,
    TB_ACTION,
    TRANS_ACTION,
    TRANS_SERVICE,
    VIEW_STRATEGY
} from "@/entrypoints/constants";
import useI18n from "@/composables/useI18n";
import {browser} from "wxt/browser";
import MarqueeText from "@/components/MarqueeText.vue";
import {translationServices} from "@/entrypoints/translateService";
// import {franc} from 'franc'
import CustomDropdownMenu from "@/components/CustomDropdownMenu.vue";
import axios from "axios";
import debug from 'debug';

const title = import.meta.env.VITE_APP_TITLE
const env = import.meta.env.VITE_ENV
const enableDebug = import.meta.env.VITE_DEBUG

export default {
    computed: {
        translationServices() {
            return translationServices
        }
    },
    updated() {

    },
    beforeUpdate() {

    },
    setup() {
        const isFirstLoad = ref(true); // flag, which is used to determine whether it is the first load
        const bgColorIndex = ref(0); // The index of the selected color is selected by default
        const {t} = useI18n();
        const colorPickerComponent = ref(null)
        const padding = ref(3)
        const callInternalMethod = () => {
            if (colorPickerComponent.value) {
                colorPickerComponent.value.show();
            }
        };
        return {
            isFirstLoad,
            colorPickerComponent,
            callInternalMethod,
            padding: padding,
            t,
            // bgColorIndex,
        };
    },
    watch: {
        globalSwitch(newVal) {
            // console.log("globalSwitch", newVal)
            sendMessageToBackground({
                action: DB_ACTION.CONFIG_SET,
                data: {name: CONFIG_KEY.GLOBAL_SWITCH, value: newVal}
            })
        },
        bgColorIndex(newVal) {
            this.setConfig(CONFIG_KEY.BG_COLOR_INDEX, newVal)
        },
        fontColorIndex(newVal) {
            this.setConfig(CONFIG_KEY.FONT_COLOR_INDEX, newVal)
        },
        translationBgColorIndex(newVal) {
            this.setConfig(CONFIG_KEY.TRANSLATION_BG_COLOR_INDEX, newVal)
        },
        originalBgColorIndex(newVal) {
            this.setConfig(CONFIG_KEY.ORIGINAL_BG_COLOR_INDEX, newVal)
        },

    },
    components: {CustomDropdownMenu, MarqueeText, CustomSwitch, CustomColorPicker},
    data() {
        // const userInfo = getUserInfo
        return {
            domainStrategyAlwaysTranslate: false,
            domainStrategyNeverTranslate: false,
            nativeLanguage: 'en',
            translateToggleEnabled: true, // used to determine whether the current page can be translated(e.g. not a chrome:// page)
            isScrollable: false,
            maxHeight: 200,
            currentMenu: {icon: 'account-group', text: 'People'},
            menus: [
                {icon: 'account-group', text: 'People'},
                {icon: 'shopping-search', text: 'Orders'},
                {icon: 'credit-card-multiple', text: 'Payments'},
                {icon: 'dolly', text: 'Logistics'},
                {icon: 'clock-check', text: 'Jobs'},
                {icon: 'cart-arrow-right', text: 'Cart'},
                {icon: 'settings', text: 'Configuration'}
            ],

            globalSwitch: true,
            isPopupWindow: false,
            bgColorIndex: -1,
            originalBgColorIndex: -1,
            translationBgColorIndex: -1,
            fontColorIndex: -1,
            tabLanguage: undefined,
            tabs: [],
            tabStatusKey: '',
            domain: "",
            message: '',

            // Website translation strategy
            domainStrategies: [
                {title: "automaticallyDetermineWhetherToTranslate", value: DOMAIN_STRATEGY.AUTO},
                {title: "neverTranslateThisSite", value: DOMAIN_STRATEGY.NEVER},
                {title: "alwaysTranslateThisSite", value: DOMAIN_STRATEGY.ALWAYS},
                // {title: "alwaysAskToTranslateThisSite", value: DOMAIN_STRATEGY.ASK},
            ],
            defaultStrategies: [
                {title: "automaticallyDetermineWhetherToTranslate", value: DOMAIN_STRATEGY.AUTO},
                {title: "notTranslateAllWebsites", value: DOMAIN_STRATEGY.NEVER},
                {title: "translateAllWebsites", value: DOMAIN_STRATEGY.ALWAYS},
            ],
            // Translate the view strategy
            viewStrategies: [
                {title: "bilingual", value: VIEW_STRATEGY.DOUBLE, action: TRANS_ACTION.DOUBLE},
                {title: "monolingual", value: VIEW_STRATEGY.SINGLE, action: TRANS_ACTION.SINGLE},
                // todo show a dialog to ask user whether to translate
                // {title: "showToggleButton", value: VIEW_STRATEGY.BUTTON, action: TRANS_ACTION.TOGGLE},
            ],
            // translation service
            translateServices: [
                {title: "microsoftTranslator", value: TRANS_SERVICE.MICROSOFT},
                {title: "googleTranslator", value: TRANS_SERVICE.GOOGLE},
            ],
            targetLanguages: LANGUAGES,
            sourceLanguages: LANGUAGES,
            domainStrategy: "none",
            defaultStrategy: "auto",
            viewStrategy: "bilingual",
            selected: "default",
            targetLanguage: "simplifiedChinese",
            translateService: "microsoftTranslator",
            sourceLanguage: "automaticDetection",
            switchAlwaysTranslate: false,
            switchNeverTranslate: false,
            switchAutoDetect: false,
            localStorageValue: undefined,
            translateToggle: false,
            bgColor: '',
            translationBgColor: '',
            originalBgColor: '',
            fontColor: '',
            style: 'noneStyleSelect',
            bilingualHighlighting: true,
            options: [
                {
                    label: this.t('wrap'),
                    value: "borderStyleSelect",
                    options: [
                        {
                            value: 'noneStyleSelect',
                            label: this.t('none'),
                        },
                        {
                            value: 'solidBorder',
                            label: this.t('solidBorder'),
                        },
                        {
                            value: 'dottedBorder',
                            label: this.t('dottedBorder'),
                        },
                        {
                            value: 'dashedBorder',
                            label: this.t('dashedBorder'),
                        },
                    ],
                },
                {
                    label: this.t('bottom'),
                    value: 'underlineStyleSelect',
                    options: [
                        {
                            value: 'wavyLine',
                            label: this.t('wavyLine'),
                        },
                        {
                            value: 'doubleLine',
                            label: this.t('doubleUnderline'),
                        },
                        {
                            value: 'underLine',
                            label: this.t('underLine'),
                        },
                        {
                            value: 'dottedLine',
                            label: this.t('dottedLine'),
                        },
                        {
                            value: 'dashedLine',
                            label: this.t('dashedLine'),
                        },
                    ],
                },
            ]
        }
    },
    methods: {
        openHelpPage() {
            browser.tabs.create({url: "https://duo.zeroflx.com/docs"})
        },
        openSettingPage() {
            browser.tabs.create({url: "options.html"})
            // browser.runtime.openOptionsPage()
        },
        getNativeLanguage() {
            sendMessageToBackground({action: "getNativeLanguage"})
        },
        async bgColorChanged(newVal) {
            console.log('bgColorChanged', newVal)
            await this.setConfig(CONFIG_KEY.BG_COLOR, newVal)
            sendMessageToTab({action: ACTION.STYLE_CHANGE})
            let ele = document.querySelector("#showDemoTranslated") as HTMLElement
            console.log('bgColorChanged', ele)
            ele.style.backgroundColor = newVal
        },
        async styleChanged(newVal) {
            await this.setConfig(CONFIG_KEY.STYLE, newVal)
            let ele = document.querySelector("#showDemoTranslated") as HTMLElement
            ele.style.border = ''
            ele.style.textDecoration = ''
            switch (newVal) {
                case 'noneStyleSelect':
                    ele.style.border = 'none'
                    break;
                case 'solidBorder':
                    ele.style.border = '2px solid'
                    break
                case 'dottedBorder':
                    ele.style.border = '2px dotted'
                    break
                case 'dashedBorder':
                    ele.style.border = '2px dashed'
                    break;
                case "wavyLine":
                    ele.style.textDecoration = "wavy underline"
                    break;
                case "doubleLine":
                    ele.style.textDecoration = "underline double"
                    break;
                case "underLine":
                    ele.style.textDecoration = "underline"
                    break;
                case "dottedLine":
                    ele.style.textDecoration = "underline dotted"
                    break;
                case "dashedLine":
                    ele.style.textDecoration = "underline dashed"
                    break;
            }
            if (this.style.endsWith("Line")) {
                ele.style.textUnderlineOffset = `${this.padding}px`
            } else {
                ele.style.padding = `${this.padding}px`
            }
            await sendMessageToTab({action: ACTION.STYLE_CHANGE})
        },
        async fontColorChanged(newVal) {
            await this.setConfig(CONFIG_KEY.FONT_COLOR, newVal)
            sendMessageToTab({action: ACTION.STYLE_CHANGE})
            let ele = document.querySelector("#showDemoTranslated") as HTMLElement
            ele.style.color = newVal
        },
        async originalBgColorChanged(newVal) {
            await this.setConfig(CONFIG_KEY.ORIGINAL_BG_COLOR, newVal)
            await sendMessageToTab({action: ACTION.STYLE_CHANGE})
        },
        async translationBgColorChanged(newVal) {
            await this.setConfig(CONFIG_KEY.TRANSLATION_BG_COLOR, newVal)
            await sendMessageToTab({action: ACTION.STYLE_CHANGE})
        },
        async defaultStrategyChanged(newVal) {
            await this.setConfig(CONFIG_KEY.DEFAULT_STRATEGY, newVal)
        },
        async translateToggleChanged(newVal) {
            await sendMessageToBackground({
                action: STORAGE_ACTION.SESSION_SET,
                data: {key: this.tabStatusKey, value: newVal}
            })
        },
        async neverDomainStrategyChanged(newVal) {
            // console.log('neverDomainStrategyChanged', newVal)
            if (newVal) {
                this.domainStrategyAlwaysTranslate = false
                await sendMessageToBackground({
                    action: DB_ACTION.DOMAIN_UPDATE,
                    data: {domain: this.domain, strategy: DOMAIN_STRATEGY.NEVER}
                })
                this.translateToggle = await sendMessageToTab({
                    action: ACTION.DOMAIN_STRATEGY_CHANGE,
                    data: DOMAIN_STRATEGY.NEVER
                })
            }else {
                await sendMessageToBackground({
                    action: DB_ACTION.DOMAIN_UPDATE,
                    data: {domain: this.domain, strategy: DOMAIN_STRATEGY.AUTO}
                })
            }

        },
        async alwaysDomainStrategyChanged(newVal) {
            if (newVal) {
                this.domainStrategyNeverTranslate = false
                await sendMessageToBackground({
                    action: DB_ACTION.DOMAIN_UPDATE,
                    data: {domain: this.domain, strategy: DOMAIN_STRATEGY.ALWAYS}
                })
                this.translateToggle = await sendMessageToTab({
                    action: ACTION.DOMAIN_STRATEGY_CHANGE,
                    data: DOMAIN_STRATEGY.ALWAYS
                })
            }else {
                await sendMessageToBackground({
                    action: DB_ACTION.DOMAIN_UPDATE,
                    data: {domain: this.domain, strategy: DOMAIN_STRATEGY.AUTO}
                })
            }
        },
        async bilingualHighlightingChanged(newVal) {
            await this.setConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH, newVal)
            await sendMessageToTab({action: ACTION.STYLE_CHANGE})
        },
        // configure access functions
        async setConfig(key: CONFIG_KEY, value: any) {
            return sendMessageToBackground({
                action: DB_ACTION.CONFIG_SET,
                data: {name: key, value: value}
            });
        },
        // configure the fetch function
        async getConfig(key: CONFIG_KEY): Promise<any> {
            return sendMessageToBackground({
                action: DB_ACTION.CONFIG_GET,
                data: {name: key}
            });
        },
        highlightMouseLeaveDemo(event: Event) {
            if (!this.bilingualHighlighting) {
                return
            }
            let eventElement = event.target as HTMLElement
            let idName = eventElement.id
            if (idName.startsWith('origin')) {
                eventElement.style.backgroundColor = ''
                let originElement = document.querySelector("#translation" + idName.substring(6)) as HTMLElement
                originElement.style.backgroundColor = ''
            } else {
                eventElement.style.backgroundColor = ''
                let translationElement = document.querySelector("#origin" + idName.substring(11)) as HTMLElement
                translationElement.style.backgroundColor = ''
            }
        },
        highlightMouseOverDemo(event: Event) {
            if (!this.bilingualHighlighting) {
                return
            }
            const eventElement = event.target as HTMLElement
            let idName = eventElement.id
            if (idName.startsWith('origin')) {
                eventElement.style.backgroundColor = this.originalBgColor
                let translationElement = document.querySelector("#translation" + idName.substring(6)) as HTMLElement
                translationElement.style.backgroundColor = this.translationBgColor
            } else {
                eventElement.style.backgroundColor = this.translationBgColor
                let originElement = document.querySelector("#origin" + idName.substring(11)) as HTMLElement
                originElement.style.backgroundColor = this.originalBgColor
            }
        },

        test() {
        },
        changeDomainStrategy(selected) {
            // Obtain the domain name and save the policy to the database
            let selectedValue = this.getItemByTitle(this.domainStrategies, selected)?.value
            sendMessageToBackground({
                action: DB_ACTION.DOMAIN_UPDATE,
                data: {domain: this.domain, strategy: selectedValue}
            }).then(async (response) => {
                // Modify the policy displayed on the frontend
                this.domainStrategy = selected;
                // send msg to content script, determine what to do with the current page
                this.translateToggle = await sendMessageToTab({
                    action: ACTION.DOMAIN_STRATEGY_CHANGE,
                    data: selectedValue
                })
            }).catch(
                // todo upload an error message to the server
            )
        },
        changeDefaultStrategy(selected) {
            // Obtain the domain name and save the policy to the database
            sendMessageToBackground({
                action: DB_ACTION.CONFIG_SET,
                data: {name: CONFIG_KEY.DEFAULT_STRATEGY, value: selected}
            }).then(async (response) => {
                // Modify the policy displayed on the frontend
                this.defaultStrategy = selected;
            }).catch(
                // todo upload an error message to the server
            )
        },
        async changeTranslateService(selected) {
            await sendMessageToBackground({
                action: DB_ACTION.CONFIG_SET,
                data: {name: CONFIG_KEY.TRANSLATE_SERVICE, value: selected.value}
            })
            this.translateService = selected.title
            // if current is translate status, let content script to re-translate
            if (this.translateToggle) {
                await sendMessageToTab({action: ACTION.TRANSLATE_CHANGE})
            }
        },
        async changeViewStrategy(selected) {
            await sendMessageToBackground({
                action: DB_ACTION.CONFIG_SET,
                data: {name: CONFIG_KEY.VIEW_STRATEGY, value: selected.value}
            })
            this.viewStrategy = selected.title
            // if current is translate status, let content script to re-translate
            console.log('changeViewStrategy translateToggle', this.translateToggle)
            if (this.translateToggle) {
                await sendMessageToTab({action: ACTION.TRANSLATE_CHANGE})
            }
        },
        async changeTargetLanguage(selected) {
            await sendMessageToBackground({
                action: DB_ACTION.CONFIG_SET,
                data: {name: CONFIG_KEY.TARGET_LANG, value: selected.value}
            })
            this.targetLanguage = selected.title
            // if current is translate status, let content script to re-translate
            if (this.translateToggle) {
                await sendMessageToTab({action: ACTION.TRANSLATE_CHANGE})
            }
        },

        async toggleSelectionMode() {
            // if not in selection mode or not in translated status
            let status = await sendMessageToBackground({
                action: STORAGE_ACTION.SESSION_GET,
                data: {key: this.tabStatusKey}
            })
            if (!status) {
                await sendMessageToTab({action: ACTION.TOGGLE_SELECTION_MODE})
                window.close()
            } else {
                console.log('restoreOriginalFirst')
                // popup a message dialog
                this.$message({
                    message: this.t('restoreOriginalFirst'),
                    type: 'warning'
                });
            }
        },
        getItemByTitle(array: Array<any>, title: string) {
            return array.find(value => value.title == title)
        },
        getItemByValue(array: Array<any>, code: string) {
            return array.find(value => value.value == code)
        },
        async toggleTranslation(translateStatus: boolean) {
            console.log('toggleTranslation', translateStatus)
            // Sets the current tab translation status
            await sendMessageToBackground({
                action: STORAGE_ACTION.SESSION_SET,
                data: {key: this.tabStatusKey, value: translateStatus}
            })
            if (translateStatus) {
                // send message to content script, process translation action
                let action = this.viewStrategies.find(value => value.title == this.viewStrategy)?.action as string
                await sendMessageToTab({
                    action: action,
                    // data: {
                    //     targetLanguage: this.getItemByTitle(this.targetLanguages, this.targetLanguage)?.value,
                    //     sourceLanguage: undefined,
                    //     translateService: this.getItemByTitle(this.translateServices, this.translateService)?.value
                    // }
                })
            } else {
                await sendMessageToTab({action: TRANS_ACTION.ORIGIN})
            }

            // close popup
            // window.close()
        },
    },
    async mounted() {
        console.log("aaa", title)
        debug.log('debug test mounted')
        // Add a style setting Unstyled
        let element = document.querySelector("#noneStyleSelect")
        if (element) {
            element.textContent = this.t('none');
        }
        // send message to content script to leave selection mode
        sendMessageToTab({action: ACTION.LEAVE_SELECTION_MODE})
        try {
            // Gets the currently active tab
            this.tabs = await browser.tabs.query({active: true, currentWindow: true})
            this.tabStatusKey = "tabTranslateStatus#" + this.tabs?.[0]?.id
            let originUrl = this.tabs?.[0]?.url
            let url = new URL(originUrl)
            if (url.port != '80' && url.port != '443') {
                this.domain = url.hostname + ":" + url.port
            } else {
                this.domain = url.hostname
            }
            if (!originUrl.startsWith("http")) {
                // not a normal page, set translate toggle to disable
                this.translateToggleEnabled = false
            }
            console.log('tabs', this.tabs[0].id, 'domain', this.domain)
            let [targetLanguageConfigValue, tabLanguage, translateServiceConfigValue, status, domainData, viewStrategyConfigValue, nativeLanguage] = await Promise.all([
                sendMessageToBackground({action: DB_ACTION.CONFIG_GET, data: {name: CONFIG_KEY.TARGET_LANG}}),
                sendMessageToBackground({action: TB_ACTION.TAB_LANG_GET, data: this.tabs?.[0]}),
                sendMessageToBackground({action: DB_ACTION.CONFIG_GET, data: {name: CONFIG_KEY.TRANSLATE_SERVICE}}),
                sendMessageToBackground({
                    action: STORAGE_ACTION.SESSION_GET,
                    data: {key: this.tabStatusKey}
                }),
                sendMessageToBackground({action: DB_ACTION.DOMAIN_GET, data: {domain: this.domain}}),
                sendMessageToBackground({action: DB_ACTION.CONFIG_GET, data: {name: CONFIG_KEY.VIEW_STRATEGY}}),
                sendMessageToBackground({action: "getNativeLanguage"})
            ]);
            this.nativeLanguage = nativeLanguage
            console.log('tabLanguage', tabLanguage)
            if (targetLanguageConfigValue) {
                // obtain the title based on the code, which is used to set the front-end display
                this.targetLanguages.forEach(language => {
                    if (language.value == targetLanguageConfigValue) {
                        this.targetLanguage = language.title;
                    }
                })
            } else {
                this.targetLanguages.forEach(language => {
                    // get default browser language
                    if (language.value == navigator.language) {
                        this.targetLanguage = language.title;
                    }
                })
            }
            this.tabLanguage = tabLanguage
            if (translateServiceConfigValue) {
                this.translateService = this.getItemByValue(this.translateServices, translateServiceConfigValue)?.title;
            }
            // page translation status
            if (status) {
                this.translateToggle = status
            }
            console.log('tabs', this.tabs[0], 'tabLanguage', this.tabLanguage, 'status', status)
            // get the display policy
            if (viewStrategyConfigValue) {
                this.viewStrategy = this.getItemByValue(this.viewStrategies, viewStrategyConfigValue)?.title;
            }
            if (domainData) {
                if (domainData.strategy == DOMAIN_STRATEGY.ALWAYS) {
                    this.domainStrategyAlwaysTranslate = true
                    this.domainStrategyNeverTranslate = false
                } else if (domainData.strategy == DOMAIN_STRATEGY.NEVER) {
                    this.domainStrategyAlwaysTranslate = false
                    this.domainStrategyNeverTranslate = true
                } else {
                    this.domainStrategyAlwaysTranslate = false
                    this.domainStrategyNeverTranslate = false
                }
            }
            const [
                styleConfig,
                bgColorConfig,
                fontColorConfig,
                bgColorIndexConfig,
                fontColorIndexConfig,
                paddingConfig,
                originalBgColorConfig,
                originalBgColorIndexConfig,
                translationBgColorConfig,
                translationBgColorIndexConfig,
                bilingualHighlighting,
                globalSwitch,
                defaultStrategy,
            ] = await Promise.all([
                this.getConfig(CONFIG_KEY.STYLE),
                this.getConfig(CONFIG_KEY.BG_COLOR),
                this.getConfig(CONFIG_KEY.FONT_COLOR),
                this.getConfig(CONFIG_KEY.BG_COLOR_INDEX),
                this.getConfig(CONFIG_KEY.FONT_COLOR_INDEX),
                this.getConfig(CONFIG_KEY.PADDING),
                this.getConfig(CONFIG_KEY.ORIGINAL_BG_COLOR),
                this.getConfig(CONFIG_KEY.ORIGINAL_BG_COLOR_INDEX),
                this.getConfig(CONFIG_KEY.TRANSLATION_BG_COLOR),
                this.getConfig(CONFIG_KEY.TRANSLATION_BG_COLOR_INDEX),
                this.getConfig(CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH),
                this.getConfig(CONFIG_KEY.GLOBAL_SWITCH),
                this.getConfig(CONFIG_KEY.DEFAULT_STRATEGY)
            ]);

            // style
            this.style = styleConfig || 'noneStyleSelect'; // If there is no result, the assignment is an empty string
            // color
            this.bgColor = bgColorConfig || '';
            this.fontColor = fontColorConfig || '';
            this.originalBgColor = originalBgColorConfig || '#FFECCB';
            this.translationBgColor = translationBgColorConfig || '#ADD8E6';
            this.bgColorIndex = bgColorIndexConfig != undefined ? Number(bgColorIndexConfig) : 0;
            this.fontColorIndex = fontColorIndexConfig != undefined ? Number(fontColorIndexConfig) : 0;
            this.originalBgColorIndex = originalBgColorIndexConfig != undefined ? Number(originalBgColorIndexConfig) : 0;
            this.translationBgColorIndex = translationBgColorIndexConfig != undefined ? Number(translationBgColorIndexConfig) : 1;
            this.globalSwitch = globalSwitch == undefined ? true : globalSwitch;
            // padding
            this.padding = paddingConfig || '';
            this.bilingualHighlighting = bilingualHighlighting == undefined ? true : bilingualHighlighting;
            this.defaultStrategy = defaultStrategy || 'auto';
            console.log('defaultStrategy', defaultStrategy)
            // set translation demo style
            let ele = document.querySelector("#showDemoTranslated") as HTMLElement
            ele.style.backgroundColor = this.bgColor
            ele.style.color = this.fontColor
            console.log('bgColorIndex', bgColorConfig)
            this.$watch('bgColor', this.bgColorChanged)
            this.$watch('fontColor', this.fontColorChanged)
            this.$watch('style', this.styleChanged)
            this.$watch('bilingualHighlighting', this.bilingualHighlightingChanged)
            this.$watch('originalBgColor', this.originalBgColorChanged)
            this.$watch('translationBgColor', this.translationBgColorChanged)

            this.$watch('defaultStrategy', this.defaultStrategyChanged)
            this.$watch('domainStrategyAlwaysTranslate', this.alwaysDomainStrategyChanged)
            this.$watch('domainStrategyNeverTranslate', this.neverDomainStrategyChanged)
            this.$watch('translateToggle', this.translateToggleChanged)
        } catch (e) {
            // console.log(e)
        }
        this.isFirstLoad = false;
    },

}
</script>
<template>
    <div class="main">
        <div class="login">
            <div class="helpBtn" @click="openHelpPage">
                <el-tooltip :content="t('helpDocument')" placement="bottom" effect="customized" :showAfter="500">
                    <img src="@/public/icon/help.svg" alt="">
                </el-tooltip>
                <div class="login-message">

                </div>
            </div>
            <div class="setting" @click="openSettingPage">
                <el-tooltip :content="t('setting')" placement="bottom" effect="customized" :showAfter="500">
                    <img src="../public/icon/setting.svg" alt="">
                </el-tooltip>
            </div>
            <div>
                <el-tooltip :content="t('globalSwitch')" placement="top" effect="customized" :showAfter="200">
                    <el-switch

                        v-model="globalSwitch"
                        size="large"
                    >
                        <template #active-action>
                            <span class="custom-active-action">G</span>
                        </template>
                        <template #inactive-action>
                            <span class="custom-inactive-action">G</span>
                        </template>
                    </el-switch>
                </el-tooltip>
            </div>

            <el-tooltip :content="t('specifyAreasNotToBeTranslated')" placement="top" effect="customized"
                        :showAfter='500'>
                <div class="btn-rule" @click="toggleSelectionMode">
                    <div class="leading-icon">
                        <svg
                            class="group"
                            width="16"
                            height="13"
                            viewBox="0 0 16 13"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <path
                                d="M8.00029 9.16532C9.4725 9.16532 10.666 7.97186 10.666 6.49965C10.666 5.02744 9.4725 3.83398 8.00029 3.83398C6.52809 3.83398 5.33463 5.02744 5.33463 6.49965C5.33463 7.97186 6.52809 9.16532 8.00029 9.16532Z"
                                fill="white"
                            />
                            <path
                                d="M15.5112 4.77983C14.4776 3.09645 12.1265 0.272156 7.99998 0.272156C3.87352 0.272156 1.52239 3.09645 0.488772 4.77983C-0.162924 5.8339 -0.162924 7.16578 0.488772 8.21989C1.52239 9.90327 3.87352 12.7276 7.99998 12.7276C12.1265 12.7276 14.4776 9.90327 15.5112 8.21989C16.1629 7.16578 16.1629 5.8339 15.5112 4.77983ZM7.99998 10.4984C5.79168 10.4984 4.00147 8.70815 4.00147 6.49984C4.00147 4.29154 5.79168 2.50133 7.99998 2.50133C10.2083 2.50133 11.9985 4.29154 11.9985 6.49984C11.9963 8.70724 10.2074 10.4961 7.99998 10.4984Z"
                                fill="white"
                            />
                        </svg>
                    </div>
                    <div class="button-text">
                        <!-- rule mode -->
                        <marquee-text :text="t('ruleMode')" width="70px"></marquee-text>
                    </div>
                </div>
            </el-tooltip>
        </div>
        <div class="main-function">
            <div class="translate-select">
                <el-tooltip :content="t('displayMode')" placement="top" effect="customized" :showAfter="500">
                    <div class="btn-strategy">
                        <el-dropdown @command="changeViewStrategy" trigger="click" size="large">
                            <div class="select-strategy">
                                <div class="button-text">{{ t(viewStrategy) }}</div>
                                <svg
                                    class="trailing-icon"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 16 16"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                >
                                    <g clip-path="url(#clip0_86_5059)">
                                        <path
                                            d="M1.00695 4.05283C1.13828 4.05266 1.26833 4.07849 1.38962 4.12883C1.51091 4.17918 1.62103 4.25305 1.71362 4.34617L6.82895 9.46083C6.98372 9.61565 7.16748 9.73845 7.36971 9.82224C7.57195 9.90602 7.78871 9.94915 8.00762 9.94915C8.22653 9.94915 8.44329 9.90602 8.64553 9.82224C8.84777 9.73845 9.03152 9.61565 9.18629 9.46083L14.2936 4.35283C14.3859 4.25732 14.4962 4.18114 14.6182 4.12873C14.7402 4.07632 14.8714 4.04874 15.0042 4.04758C15.137 4.04643 15.2687 4.07173 15.3916 4.12201C15.5145 4.17229 15.6261 4.24655 15.72 4.34044C15.8139 4.43433 15.8882 4.54598 15.9384 4.66888C15.9887 4.79178 16.014 4.92346 16.0129 5.05624C16.0117 5.18901 15.9841 5.32024 15.9317 5.44224C15.8793 5.56424 15.8031 5.67459 15.7076 5.76683L10.6003 10.8748C9.91223 11.5616 8.97978 11.9473 8.00762 11.9473C7.03546 11.9473 6.10302 11.5616 5.41495 10.8748L0.299621 5.76017C0.159677 5.62031 0.064363 5.44209 0.0257402 5.24805C-0.0128825 5.05401 0.00692157 4.85287 0.0826466 4.67009C0.158372 4.48731 0.286614 4.3311 0.451146 4.22122C0.615679 4.11134 0.809107 4.05274 1.00695 4.05283Z"
                                            fill="white"
                                        />
                                    </g>
                                    <defs>
                                        <clipPath id="clip0_86_5059">
                                            <rect width="16" height="16" fill="white"/>
                                        </clipPath>
                                    </defs>
                                </svg>
                            </div>
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <el-dropdown-item v-for="(viewStrategy,index) in viewStrategies"
                                                      :command="viewStrategy">
                                        {{ t(viewStrategy.title) }}
                                    </el-dropdown-item>
                                </el-dropdown-menu>
                            </template>
                        </el-dropdown>

                    </div>
                </el-tooltip>
                <el-tooltip :content="t('targetLanguage')" placement="top" effect="customized" :showAfter="500">
                    <div class="btn-target">
                        <el-dropdown @command="changeTargetLanguage" trigger="click" size="large" max-height="420px">
                            <div class="select-target">
                                <div class="button-text">{{ t(targetLanguage) }}</div>
                                <svg
                                    class="trailing-icon2"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 16 16"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                >
                                    <g clip-path="url(#clip0_86_5065)">
                                        <path
                                            d="M1.00698 4.05283C1.13831 4.05266 1.26836 4.07849 1.38965 4.12883C1.51094 4.17918 1.62106 4.25305 1.71365 4.34617L6.82898 9.46083C6.98375 9.61565 7.16751 9.73845 7.36974 9.82224C7.57198 9.90602 7.78874 9.94915 8.00765 9.94915C8.22656 9.94915 8.44332 9.90602 8.64556 9.82224C8.8478 9.73845 9.03155 9.61565 9.18632 9.46083L14.2937 4.35283C14.3859 4.25732 14.4962 4.18114 14.6182 4.12873C14.7403 4.07632 14.8715 4.04874 15.0043 4.04758C15.137 4.04643 15.2687 4.07173 15.3916 4.12201C15.5145 4.17229 15.6262 4.24655 15.72 4.34044C15.8139 4.43433 15.8882 4.54598 15.9385 4.66888C15.9888 4.79178 16.0141 4.92346 16.0129 5.05624C16.0117 5.18901 15.9842 5.32024 15.9318 5.44224C15.8793 5.56424 15.8032 5.67459 15.7077 5.76683L10.6003 10.8748C9.91226 11.5616 8.97981 11.9473 8.00765 11.9473C7.03549 11.9473 6.10305 11.5616 5.41498 10.8748L0.299651 5.76017C0.159707 5.62031 0.0643935 5.44209 0.0257707 5.24805C-0.012852 5.05401 0.00695209 4.85287 0.0826771 4.67009C0.158402 4.48731 0.286644 4.3311 0.451177 4.22122C0.61571 4.11134 0.809137 4.05274 1.00698 4.05283Z"
                                            fill="white"
                                        />
                                    </g>
                                    <defs>
                                        <clipPath id="clip0_86_5065">
                                            <rect width="16" height="16" fill="white"/>
                                        </clipPath>
                                    </defs>
                                </svg>
                            </div>
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <el-dropdown-item v-for="(targetLanguage,index) in targetLanguages"
                                                      :command="targetLanguage">
                                        {{ t(targetLanguage.title) }}
                                    </el-dropdown-item>
                                </el-dropdown-menu>
                            </template>
                        </el-dropdown>

                    </div>
                </el-tooltip>
            </div>
            <el-tooltip :content="t('translateService')" placement="top" effect="customized" :showAfter="500">
                <div class="translate-service">
                    <el-dropdown @command="changeTranslateService" trigger="click" size="large">

                        <div class="btn-trans">
                            <div class="leading-icon2">
                                <img
                                    :src="'fi-brands-'+ getItemByTitle(translateServices,translateService).value + '.svg'"
                                    :alt="translateService">
                            </div>
                            <div class="button-text-large">{{ t(translateService) }}</div>
                            <svg
                                class="trailing-icon3"
                                width="20"
                                height="21"
                                viewBox="0 0 20 21"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                            >
                                <g clip-path="url(#clip0_86_5071)">
                                    <path
                                        d="M1.25868 5.566C1.42284 5.56578 1.58541 5.59806 1.73702 5.661C1.88863 5.72393 2.02628 5.81626 2.14202 5.93266L8.53618 12.326C8.72965 12.5195 8.95934 12.673 9.21213 12.7777C9.46493 12.8825 9.73588 12.9364 10.0095 12.9364C10.2832 12.9364 10.5541 12.8825 10.8069 12.7777C11.0597 12.673 11.2894 12.5195 11.4829 12.326L17.867 5.941C17.9823 5.82161 18.1203 5.72638 18.2728 5.66087C18.4253 5.59536 18.5893 5.56088 18.7553 5.55943C18.9212 5.55799 19.0858 5.58962 19.2395 5.65247C19.3931 5.71532 19.5326 5.80814 19.65 5.9255C19.7674 6.04287 19.8602 6.18243 19.923 6.33605C19.9859 6.48968 20.0175 6.65427 20.0161 6.82025C20.0146 6.98622 19.9802 7.15025 19.9146 7.30275C19.8491 7.45526 19.7539 7.59319 19.6345 7.7085L13.2504 14.0935C12.3903 14.952 11.2247 15.4341 10.0095 15.4341C8.79432 15.4341 7.62876 14.952 6.76868 14.0935L0.374518 7.70016C0.199588 7.52535 0.0804461 7.30257 0.0321676 7.06002C-0.0161108 6.81746 0.00864433 6.56604 0.103301 6.33757C0.197957 6.10909 0.35826 5.91382 0.563925 5.77648C0.769591 5.63914 1.01138 5.56589 1.25868 5.566Z"
                                        fill="white"
                                    />
                                </g>
                                <defs>
                                    <clipPath id="clip0_86_5071">
                                        <rect
                                            width="20"
                                            height="20"
                                            fill="white"
                                            transform="translate(0 0.5)"
                                        />
                                    </clipPath>
                                </defs>
                            </svg>
                        </div>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item :command="translateService"
                                                  v-for="(translateService,index) in translateServices">
                                    {{ t(translateService.title) }}
                                </el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                </div>
            </el-tooltip>
            <div class="translate-toggle">
                <custom-switch v-model="translateToggle" class="my-custom-class" :swidth="'60'"
                               size="large"
                               :active-text="t('translate')"
                               :inactive-text="t('original')"
                               :bgColor="'#FFF8F7'"
                               :disabled="!globalSwitch||!translateToggleEnabled"
                               @change="toggleTranslation"
                ></custom-switch>
            </div>
        </div>
        <div class="style">
            <marquee-text style="font-weight: bold" :text="t('translationStyle')">

            </marquee-text>
            <div class="styleSetting">
                <marquee-text :text="t('border')" width="148px"></marquee-text>
            </div>
            <el-select v-model="style" placeholder="Select">
                <el-option-group
                    v-for="group in options"
                    :key="group.label"
                    :label="group.label"
                    :id="group.value"
                >
                    <el-option
                        v-for="item in group.options"
                        :key="item.value"
                        :label="item.label"
                        :value="item.value"
                        :class="item.value"
                    >

                        <span style="float: left" :id="item.value">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
                    </el-option>
                </el-option-group>
            </el-select>
            <div class="styleSetting">
                <marquee-text :text="t('backgroundColor')" width="148px"></marquee-text>
            </div>
            <custom-color-picker :class="'color-conflict'" v-model="bgColor" v-model:selectedIndex="bgColorIndex">

            </custom-color-picker>
            <div class="styleSetting">
                <marquee-text :text="t('fontColor')" width="148px"></marquee-text>
            </div>
            <custom-color-picker :class="'color-conflict'" v-model="fontColor"
                                 v-model:selectedIndex="fontColorIndex">

            </custom-color-picker>
        </div>

        <div class="style-highlight">
            <marquee-text style="font-weight: bold" :text="t('bilingualHighlighting')">
            </marquee-text>
            <div class="styleSetting">
                <marquee-text :text="t('originalBgColor')" width="136px"></marquee-text>
            </div>

            <custom-color-picker v-model="originalBgColor" v-model:selectedIndex="originalBgColorIndex"
                                 :color-items="['#FFF4E1', '#C8E6F5', '#CDC4B9', '#C4E0CA','#E8C3BD']">

            </custom-color-picker>

            <div class="styleSetting">
                <marquee-text :text="t('translationBgColor')" width="136px"></marquee-text>
            </div>
            <custom-color-picker :class="'color-conflict'" v-model="translationBgColor"
                                 v-model:selectedIndex="translationBgColorIndex"
                                 :color-items="['#FFF4E1', '#C8E6F5', '#CDC4B9', '#C4E0CA','#E8C3BD']">

            </custom-color-picker>
        </div>

        <div class="style-show">

            <div class="flex items-center text-sm">
                <el-radio-group v-model="defaultStrategy" class="ml-0">
                    <el-radio @change="changeDefaultStrategy" v-for="(strategy,index) in defaultStrategies"
                              :value="strategy.value" size="default">
                        <marquee-text :text="t(strategy.title)" width="135px"></marquee-text>

                    </el-radio>
                </el-radio-group>
                <div class="domainStrategy">
                    <marquee-text :text="t('neverTranslateThisSite')" width="130px"></marquee-text>
                    <el-switch v-model="domainStrategyNeverTranslate">

                    </el-switch>
                </div>
                <div class="domainStrategy">
                    <marquee-text :text="t('alwaysTranslateThisSite')" width="100px"></marquee-text>
                    <el-switch v-model="domainStrategyAlwaysTranslate">
                    </el-switch>
                </div>

                <div class="domainStrategy">
                    <marquee-text :text="t('bilingualHighlighting')" width="100px"></marquee-text>
                    <el-switch
                        v-model="bilingualHighlighting"
                        size=""/>
                </div>


            </div>
            <div class="this-is-text"><p><span id="origin-1" @mouseover="highlightMouseOverDemo"
                                               @mouseleave="highlightMouseLeaveDemo">
                {{
                    nativeLanguage.startsWith('en') ? "Donne du temps à la civilisation." : "give time to civilization. "
                }}</span>
                <span
                    @mouseover="highlightMouseOverDemo" @mouseleave="highlightMouseLeaveDemo"
                    id="origin-2">{{
                        nativeLanguage.startsWith('en') ? 'et non la civilisation au temps.' : 'not civilization to time.'
                    }}</span>
            </p></div>
            <div class="show this-is-text">

                <p id="showDemoTranslated">
              <span id="translation-1" @mouseover="highlightMouseOverDemo" @mouseleave="highlightMouseLeaveDemo">
          {{ t('giveTimeToCivilization') }}
                 </span>
                    <span id="translation-2" @mouseover="highlightMouseOverDemo" @mouseleave="highlightMouseLeaveDemo">
          {{ t('notCivilizationToTime') }}
                 </span>
                </p>

                <!--                test button-->
                <!--                <v-btn @click="test">test</v-btn>-->
            </div>
        </div>
    </div>


</template>

<style>
* {
    user-select: none; /* disable text is selected */
    -moz-user-select: none; /* for Firefox */
}

.el-popper.is-customized {
    /* Set padding to ensure the height is 32px */
    padding: 6px 12px;
    background: linear-gradient(90deg, rgb(159, 229, 151), rgb(204, 229, 129));
}

.el-popper.is-customized .el-popper__arrow::before {
    background: linear-gradient(45deg, #b2e68d, #bce689);
    right: 0;
}

.translate-service .el-dropdown {
    width: 100%;
}

.el-radio-group {
    margin-left: 0 !important;
}

.el-slider--small {
    margin-left: 8px !important;
    /* margin: auto; */
    width: 120px !important;
}

.bg-color-pick-list {
    width: 132px;
    box-sizing: border-box;
    padding: 1px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    backface-visibility: hidden;
}


.color-item.active::before {
    content: "";

    width: 0px;
    height: 0px;
    color: #64748b;
    border-width: 0px 0px 2px 2px;
    padding: 3px 3px 3px 6px;
    border-style: solid;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -78%) rotate(-45deg);
}

.solidBorder {
    height: 35px !important;
}

#colorPicker {
    display: none;
}


.el-color-picker__panel {
    position: absolute;
    top: 165px !important;
}

#solidBorder {
    margin-top: 5px;
    height: 25px !important;
    border: 2px solid;
}

.dottedBorder {
    height: 30px !important;
}

#dottedBorder {
    margin-top: 5px;
    height: 25px !important;
    border: 2px dotted;
}

.dashedBorder {
    height: 30px !important;
}

#dashedBorder {
    margin-top: 5px;
    height: 25px !important;
    border: 2px dashed;
}


.wavyLine {
    height: 30px !important;
}

#underlineStyleSelect span {
    margin-top: -9px;
}

#wavyLine {
    text-align: center;
    text-decoration: wavy underline;
    text-underline-offset: 0.2em;
    height: 25px !important;
}

.doubleLine {
    height: 30px !important;
}

#doubleLine {
    text-align: center;
    text-decoration: underline double;
}

.underLine {
    height: 30px !important;
}

#underLine {
    text-decoration: underline;
}

.dottedLine {
    height: 30px !important;
}

#dottedLine {
    text-decoration: underline dotted;
}

.dashedLine {
    height: 30px !important;
}

#dashedLine {
    text-decoration: underline dashed;
}

.main,
.main * {
    box-sizing: border-box;
}

.main {
    background: linear-gradient(to left, #eaf2f5, #eaf2f5),
    linear-gradient(to left, #ffffff, #ffffff);
    height: 600px;
    position: relative;
    overflow: hidden;
}

.help {
    margin-left: 1px;
    margin-bottom: 6px;
    width: 4.8%;
    height: 3.31%;
    position: absolute;
    right: 4%;
    left: 91.2%;
    bottom: 88.79%;
    /*top: 7.9%;*/
    overflow: visible;
}

.login {
    display: flex;
    flex-direction: row;
    /*gap: 3px;*/
    align-items: center;
    justify-content: space-between;
    width: 309px;
    height: 71px;
    position: absolute;
    left: 33px;
    top: 17px;
}

.helpBtn {
    width: 30px;
}


.avatar-image {
    display: flex;
    flex-shrink: 0;
    width: 100%;
    height: 100%;
    /*position: absolute;*/
    /*object-fit: cover;*/
}

.login-message {
    display: flex;
    flex-direction: column;
    gap: 4px;
    /*align-items: flex-start;*/
    /*justify-content: flex-start;*/
    flex-shrink: 0;
    width: 100px;
    /*position: relative;*/
}

.logged-in {
    color: #262626;
    text-align: left;
    font-family: "Cabin-Regular", sans-serif;
    font-size: 16px;
    font-weight: 400;
    position: relative;
    align-self: stretch;
}

.div {
    color: rgba(38, 38, 38, 0.34);
    text-align: left;
    font-family: "Cabin-Regular", sans-serif;
    font-size: 10px;
    font-weight: 400;
    position: relative;
    align-self: stretch;
}

.btn-rule {
    background: var(--component-fill-component-fill-warning, #ffc14a);
    border-radius: var(--radius-radius-sm-4x, 8px);
    padding: var(--padding-padding-12px, 12px) 12px var(--padding-padding-12px, 12px) 12px;
    display: flex;
    flex-direction: row;
    gap: 11px;
    align-items: center;
    justify-content: flex-start;
    flex-shrink: 0;
    width: 130px;
    height: 33px;
    position: relative;
    cursor: pointer;
    /*margin-right: 10px;*/
}

.leading-icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    position: relative;
    overflow: hidden;
}

.group {
    width: 100%;
    height: 77.85%;
    position: absolute;
    right: 0%;
    left: 0%;
    bottom: 11.08%;
    top: 11.08%;
    overflow: visible;
}

/*@keyframes marquee {*/
/*  to {*/
/*    transform: translateX(min(100cqw - 100%, 0px));*/
/*  }*/
/*}*/

.button-text {
    user-select: none;
    color: var(--component-text-component-text-light-fixed, #ffffff);
    text-align: center;
    font-family: var(
        --body-xs-regular-normal-font-family,
        "Poppins-Regular",
        sans-serif
    );
    font-size: var(--body-xs-regular-normal-font-size, 14px);
    line-height: var(--body-xs-regular-normal-line-height, 20px);
    font-weight: var(--body-xs-regular-normal-font-weight, 400);
    position: relative;
    width: 80px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /*animation: marquee 6s linear infinite both alternate;*/
    /*overflow-x: auto;*/
}

.button-text-large {
    user-select: none;
    color: var(--component-text-component-text-light-fixed, #ffffff);
    text-align: center;
    font-family: var(
        --body-xs-regular-normal-font-family,
        "Poppins-Regular",
        sans-serif
    );
    font-size: var(--body-xs-regular-normal-font-size, 14px);
    line-height: var(--body-xs-regular-normal-line-height, 20px);
    font-weight: var(--body-xs-regular-normal-font-weight, 400);
    position: relative;
    width: 150px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    animation: marquee 6s linear infinite both alternate;
    /*overflow-x: auto;*/
}

.main-function {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    width: 309px;
    height: 179px;
    position: absolute;
    left: 33px;
    top: 97px;
}

.translate-select {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
    flex-shrink: 0;
    width: 309px;
    height: 50px;
    position: relative;
}

.select-strategy {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    height: 50px;
    position: relative;
    gap: 14px;
}

.btn-strategy {
    background: var(--component-fill-component-fill-positive, #23c965);
    border-radius: var(--radius-radius-sm-4x, 8px);
    padding: var(--padding-padding-12px, 12px) 18px var(--padding-padding-12px, 12px) 18px;
    display: flex;
    flex-direction: row;
    gap: 14px;
    align-items: center;
    justify-content: flex-start;
    flex-shrink: 0;
    height: 50px;
    position: relative;
}

.trailing-icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    position: relative;
    overflow: visible;
}

.select-target {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    height: 50px;
    position: relative;
    gap: 14px;
}

.btn-target {
    background: var(--component-fill-component-fill-tertiary, #3994ff);
    border-radius: var(--radius-radius-sm-4x, 8px);
    padding: var(--padding-padding-12px, 12px) 18px var(--padding-padding-12px, 12px) 18px;
    display: flex;
    flex-direction: row;
    gap: 14px;
    align-items: center;
    justify-content: flex-start;
    flex-shrink: 0;
    height: 50px;
    position: relative;
}

.trailing-icon2 {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    position: relative;
    overflow: visible;
}

.translate-service {
    /*width: 309px;*/
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
    align-self: stretch;
    flex-shrink: 0;
    height: 50px;
    position: relative;
}

.btn-trans {
    background: var(--component-hover-component-hover-primary, #6236cc);
    border-radius: var(--radius-radius-sm-4x, 8px);
    padding: var(--padding-padding-12px, 12px) var(--padding-padding-24px, 24px) var(--padding-padding-12px, 12px) var(--padding-padding-24px, 24px);
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    flex: 1;
    /*width: 309px;*/
    height: 50px;
    position: relative;
}

.leading-icon2 {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    position: relative;
    overflow: hidden;
}

.group2 {
    width: 97.43%;
    height: 100%;
    position: absolute;
    right: 1.28%;
    left: 1.28%;
    bottom: 0%;
    top: 0%;
    overflow: visible;
}

.button-text2 {
    color: var(--component-text-component-text-light-fixed, #ffffff);
    text-align: center;
    font-family: var(
        --body-sm-regular-normal-font-family,
        "Poppins-Regular",
        sans-serif
    );
    font-size: var(--body-sm-regular-normal-font-size, 16px);
    line-height: var(--body-sm-regular-normal-line-height, 24px);
    font-weight: var(--body-sm-regular-normal-font-weight, 400);
    position: relative;
}

.trailing-icon3 {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    position: relative;
    overflow: visible;
}

.translate-toggle {
    padding: 0px 10px 0px 10px;
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
    align-self: stretch;
    flex-shrink: 0;
    position: relative;
}

.btn-toggle {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    width: 195px;
    height: 34px;
    position: relative;
}

.div2 {
    color: #000000;
    text-align: left;
    font-family: var(
        --typography-typeface-change-font-here-body,
        "Poppins-Regular",
        sans-serif
    );
    font-size: 16px;
    line-height: var(--typography-height-2xs, 20px);
    font-weight: var(--typography-weight-regular, 400);
    position: relative;
}

.toggle {
    background: var(--component-fill-component-fill-negative-soft, #fff8f7);
    border-radius: var(--radius-radius-infinity, 9999px);
    padding: 4px;
    display: flex;
    flex-direction: row;
    gap: 10px;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
    width: 40px;
    height: 24px;
    position: relative;
}

.ellipse {
    background: var(--component-fill-component-fill-positive, #23c965);
    border-radius: 50%;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    position: relative;
    box-shadow: var(
        --shadow-background-xsm-box-shadow,
        0px 2px 2px 2px rgba(0, 0, 0, 0.16)
    );
}

.div3 {
    color: #3994ff;
    text-align: left;
    font-family: var(
        --typography-typeface-change-font-here-body,
        "Poppins-Regular",
        sans-serif
    );
    font-size: 16px;
    line-height: var(--typography-height-2xs, 20px);
    font-weight: var(--typography-weight-regular, 400);
    position: relative;
}

.style {
    background: #fff9ed;
    padding: 4px 8px 4px 8px;
    /*padding-top: 4px;*/
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    width: 148px;
    height: 180px;
    position: absolute;
    left: 33px;
    top: 289px;
    overflow: hidden;
}

.style-highlight {
    background: #fff9ed;
    padding: 4px 8px 4px 8px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    width: 148px;
    height: 116px;
    position: absolute;
    left: 33px;
    top: 475px;
    overflow: hidden;
}

.styleSetting {
    color: #000000;
    text-align: left;
    /*font-family: var(--presets-body2-font-family, "Inter-Regular", sans-serif);*/
    font-size: var(--presets-body2-font-size, 14px);
    line-height: var(--presets-body2-line-height, 24px);
    font-weight: var(--presets-body2-font-weight, 400);
    position: relative;
}

.style-select {
    background: var(--light-theme-rest-background-default-background, #ffffff);
    border-radius: 3px;
    padding: 0px 4px 0px 4px;
    flex-shrink: 0;
    width: 130px;
    height: 32px;
    position: relative;
}

.field-text {
    color: var(--light-theme-rest-foreground-default-foreground-242424, #242424);
    text-align: left;
    font-family: var(--medium-400-font-family, "SegoeUi-Regular", sans-serif);
    font-size: var(--medium-400-font-size, 14px);
    line-height: var(--medium-400-line-height, 20px);
    font-weight: var(--medium-400-font-weight, 400);
    position: absolute;
    right: 36px;
    left: 12px;
    top: 6px;
}

.icon {
    color: var(--text-secondary, #484644);
    text-align: left;
    font-family: var(
        --icon-medium-stroke-font-family,
        "TeamsAssets-Light",
        sans-serif
    );
    font-size: var(--icon-medium-stroke-font-size, 16px);
    line-height: var(--icon-medium-stroke-line-height, 16px);
    font-weight: var(--icon-medium-stroke-font-weight, 300);
    position: absolute;
    right: 12px;
    top: 8px;
}

.input-field-01-default-in-focus-indicator-rounded {
    height: 2px;
    position: absolute;
    right: 0px;
    left: 0px;
    bottom: 0px;
}

.in-focus {
    background: var(--light-theme-rest-background-brand-background, #5b5fc7);
    border-radius: 0px 0px 2px 2px;
    position: absolute;
    right: 0px;
    left: 0px;
    bottom: 0px;
    top: 0px;
}

.bg-color-select {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
    flex-shrink: 0;
    width: 132px;
    height: auto;
    position: relative;
    overflow: visible;
}

.color-select {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
    flex-shrink: 0;
    width: 130px;
    height: 16px;
    position: relative;
    overflow: visible;
}

._20240526202532-1 {
    flex-shrink: 0;
    width: 143px;
    height: 14px;
    position: relative;
    object-fit: cover;
}

.style-show {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    width: 168px;
    height: 270px;
    position: absolute;
    left: 196px;
    top: 297px;
}

.bilingual-highlighting {
    display: flex;
    flex-direction: row;
    align-items: center;
    /*align-items: flex-start;*/
    justify-content: space-between;
    /*position: absolute;*/
    margin-top: -8px;
    width: 160px;
    /*left: 33px;*/
    /*top: 530px;*/
}

.domainStrategy {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    width: 160px;
}

.radio-button {
    padding: 4px 0px 4px 0px;
    display: flex;
    flex-direction: row;
    gap: 12px;
    align-items: flex-start;
    justify-content: flex-start;
    flex-shrink: 0;
    position: relative;
}

.margin-radio-stack {
    display: flex;
    flex-direction: column;
    gap: 0px;
    align-items: flex-start;
    justify-content: flex-start;
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
}

.margin-top {
    flex-shrink: 0;
    width: 16px;
    height: 3px;
    position: relative;
}

.base {
    border-radius: 16px;
    border-style: solid;
    border-color: var(
        --light-theme-rest-foreground-default-foreground-2,
        #616161
    );
    border-width: 1px;
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    position: relative;
    overflow: hidden;
}

.string {
    color: var(--light-theme-rest-foreground-default-foreground-2, #616161);
    text-align: center;
    font-family: "SegoeUi-Regular", sans-serif;
    font-size: 14px;
    line-height: 20px;
    font-weight: 400;
    position: relative;
}

.this-is-text {
    color: #000000;
    width: 170px !important;
    text-align: left;
    font-family: var(--presets-body2-font-family, "Inter-Regular", sans-serif);
    font-size: var(--presets-body2-font-size, 15px);
    line-height: var(--presets-body2-line-height, 24px);
    font-weight: var(--presets-body2-font-weight, 400);
    position: relative;
    cursor: pointer;
}

.show {
    /*flex-shrink: 0;*/
    /*width: 103px;*/
    height: 50px;
    /*position: relative;*/
}

.rectangle-1523 {
    background: rgba(217, 217, 217, 0);
    border-style: dashed;
    border-color: #9a4aff;
    border-width: 2px;
    width: 100%;
    height: 100%;
    position: absolute;
    right: 0%;
    left: 0%;
    bottom: 0%;
    top: 0%;
}

.div5 {
    color: #3994ff;
    text-align: center;
    font-family: var(--presets-body2-font-family, "Inter-Regular", sans-serif);
    font-size: var(--presets-body2-font-size, 16px);
    line-height: var(--presets-body2-line-height, 24px);
    font-weight: var(--presets-body2-font-weight, 400);
    position: absolute;
    right: 11.65%;
    left: 10.68%;
    width: 77.67%;
    bottom: 15.15%;
    top: 12.12%;
    height: 72.73%;
}

#showDemoTranslated {
    margin-top: 6px;
    font-size: 14px;
    /*white-space: nowrap;*/
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
}

</style>
