<script lang="ts">
import {ref, defineComponent} from 'vue';
import CustomColorPicker from "@/components/CustomColorPicker.vue";
import CustomSwitch from "@/components/CustomSwitch.vue";
import {rgbToHex, sendMessageToBackground, sendMessageToTab} from "@/entrypoints/utils";
import {
  COMMON, CONFIG_KEY,
  DB_ACTION,
  DEFAULT,
  DOMAIN_STRATEGY,
  LANG_CODE, STORAGE_ACTION, TB_ACTION,
  TRANS_ACTION,
  TRANS_SERVICE,
  VIEW_STRATEGY
} from "@/entrypoints/constants";
import useI18n from "@/composables/useI18n";
import {browser} from "wxt/browser";
import MarqueeText from "@/components/MarqueeText.vue";
import {translationServices} from "@/entrypoints/translateService";

export default {
  computed: {
    translationServices() {
      return translationServices
    }
  },
  setup() {
    const {t} = useI18n();
    const colorPickerComponent = ref(null)
    const stylePadding = ref(4)
    const callInternalMethod = () => {
      if (colorPickerComponent.value) {
        colorPickerComponent.value.show();
      }
    };
    return {
      colorPickerComponent,
      callInternalMethod,
      stylePadding,
      t
    };
  },
  watch: {
    stylePadding(newVal) {
      let ele = document.querySelector("#showDemoTranslated") as HTMLElement
      //设置文字和下划线的间距
      if (this.styleSelected.endsWith("Line")) {
        ele.style.textUnderlineOffset = `${newVal}px`
      } else if (this.styleSelected.endsWith("Border")) {
        ele.style.padding = `${newVal}px`
      }
      // ele.style.textUnderlineOffset = `${newVal}px`
    },
    styleSelected(newVal) {
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
      if (this.styleSelected.endsWith("Line")) {
        ele.style.textUnderlineOffset = `${this.stylePadding}px`
      } else {
        ele.style.padding = `${this.stylePadding}px`
      }
      console.log(newVal)
    },
    bgColorPicked(newVal, oldVal) {
      if (newVal == this.fontColorPicked) {
        this.bgColorPicked = oldVal

      }
    },
    fontColorPicked(newVal) {

    }

  },
  components: {MarqueeText, CustomSwitch, CustomColorPicker},
  data() {
    return {
      sourceLanguage: undefined,
      tabLanguage: undefined,
      tabs: undefined,
      tabTranslateStatus: "translate",
      domain: "",
      message: '',
      // items: urlStorage.searchAll(),
      //翻译状态

      //域名策略
      domainStrategies: [
        // {title: "default", value: NONE},
        {title: "automaticallyDetermineWhetherToTranslate", value: DOMAIN_STRATEGY.AUTO},
        {title: "neverTranslateThisSite", value: DOMAIN_STRATEGY.NEVER},
        {title: "alwaysTranslateThisSite", value: DOMAIN_STRATEGY.ALWAYS},
        // {title: "alwaysAskToTranslateThisSite", value: DOMAIN_STRATEGY.ASK},
        // {title: "translateAllNotTargetLanguageContent", value: DOMAIN_STRATEGY.NON_TARGET},
      ],
      //显示策略
      viewStrategies: [
        // {title: "default", value: NONE},
        {title: "bilingual", value: VIEW_STRATEGY.DOUBLE, action: TRANS_ACTION.DOUBLE},
        {title: "monolingual", value: VIEW_STRATEGY.SINGLE, action: TRANS_ACTION.SINGLE},
        // {title: "showToggleButton", value: VIEW_STRATEGY.BUTTON, action: TRANS_ACTION.TOGGLE},
      ],
      //翻译服务
      translateServices: [
        // {title: "default", value: DEFAULT},
        {title: "googleTranslator", value: TRANS_SERVICE.GOOGLE},
        {title: "microsoftTranslator", value: TRANS_SERVICE.MICROSOFT},
        {title: "youdaoTranslator", value: TRANS_SERVICE.YOUDAO},
      ],
      //目标语言
      targetLanguages: [
        {title: "simplifiedChinese", value: LANG_CODE.ZH_CN},
        {title: "traditionalChinese", value: LANG_CODE.ZH_TW},
        {title: "english", value: LANG_CODE.EN},
        {title: "french", value: LANG_CODE.FR},
        {title: "german", value: LANG_CODE.DE},
        {title: "japanese", value: LANG_CODE.JA},
      ],
      //源语言
      sourceLanguages: [
        {title: "automaticDetection", value: COMMON.AUTO},
        {title: "simplifiedChinese", value: LANG_CODE.ZH_CN},
        {title: "traditionalChinese", value: LANG_CODE.ZH_TW},
        {title: "english", value: LANG_CODE.EN},
        {title: "french", value: LANG_CODE.FR},
        {title: "german", value: LANG_CODE.DE},
        {title: "japanese", value: LANG_CODE.JA},
      ],
      domainStrategySelected: "automaticallyDetermineWhetherToTranslate",
      // strategySelected: {title: "displayBilingual", value: VIEW_STRATEGY.DOUBLE, action: TRANS_ACTION.DOUBLE},
      viewStrategySelected: "bilingual",
      selected: "default",
      targetLanguageSelected: "simplifiedChinese",
      translateServiceSelected: "microsoftTranslator",
      sourceLanguageSelected: "automaticDetection",
      switchAlwaysTranslate: false,
      switchNeverTranslate: false,
      switchAutoDetect: false,
      localStorageValue: undefined,
      translateToggle: false,
      bgColorPicked: '',
      fontColorPicked: '',
      styleSelected: 'noneStyleSelect',
      options: [
        {
          label: '包围',
          value: "borderStyleSelect",
          options: [
            {
              value: 'noneStyleSelect',
              label: '无',
            },
            {
              value: 'solidBorder',
              label: '实体边框',
            },
            {
              value: 'dottedBorder',
              label: '点虚线边框',
            },
            {
              value: 'dashedBorder',
              label: '短虚线边框',
            },
          ],
        },
        {
          label: '底部',
          value: 'underlineStyleSelect',
          options: [
            {
              value: 'wavyLine',
              label: '波浪线',
            },
            {
              value: 'doubleLine',
              label: '双下划线',
            },
            {
              value: 'underLine',
              label: '下划线',
            },
            {
              value: 'dottedLine',
              label: '点虚线',
            },
            {
              value: 'dashedLine',
              label: '短虚线',
            },
          ],
        },
      ]
    }
  },
  methods: {
    changeDomainStrategy(selected) {
      // 获取到域名,然后保存策略到数据库
      sendMessageToBackground({
        action: DB_ACTION.DOMAIN_UPDATE,
        data: {domain: this.domain, strategy: this.getItemByTitle(this.domainStrategies, selected)?.value}
      }).then((response) => {
        //修改前端显示的策略
        this.domainStrategySelected = selected;
      }).catch(
          // 上传报错信息
      )
    },
    async changeTranslateService(selected) {
      //保存到数据库
      await sendMessageToBackground({
        action: DB_ACTION.CONFIG_SET,
        data: {name: CONFIG_KEY.TRANS_SERVICE, value: selected.value}
      })
      this.translateServiceSelected = selected.title
    },
    async changeViewStrategy(selected) {
      //保存到数据库
      await sendMessageToBackground({
        action: DB_ACTION.CONFIG_SET,
        data: {name: CONFIG_KEY.VIEW_STRATEGY, value: selected.value}
      })
      // await sendMessageToBackground({
      //   action: DB_ACTION.DOMAIN_UPDATE,
      //   data: {domain: this.domain, viewStrategy: selected.value}
      // })
      this.viewStrategySelected = selected.title
    },
    async changeTargetLanguage(selected) {
      //保存到数据库
      await sendMessageToBackground({
        action: DB_ACTION.CONFIG_SET,
        data: {name: CONFIG_KEY.TARGET_LANG, value: selected.value}
      })
      this.targetLanguageSelected = selected.title
    },
    handleColorChecked() {
      return {bgColor: this.bgColorPicked, fontColor: this.fontColorPicked}
    },
    getIndexByColor(color) {
      let index = 0
      let pickList = this.$el.querySelector('.bg-color-pick-list')
      let elements = pickList.querySelectorAll('.color-item')
      elements.forEach((ele, i) => {
        if (i == 0) {
          return
        }
        if (rgbToHex(ele.style.color).toUpperCase() == color) {
          index = i;
        }
      });
      if (index == 0) {
        index = elements.length - 1
      }
      return index
    },
    async handleBgColorChanged(newColor) {
      this.bgColorPicked = newColor;
      let ele = document.querySelector("#showDemoTranslated") as HTMLElement
      ele.style.backgroundColor = newColor
      //储存当前颜色到配置文件
      // await sendMessageToBackground({action: DB_ACTION.CONFIG_SET, data: {name: "bgColor", value: newColor}});
      await this.timeSlice()
      console.log("handleBgColorChanged")
    },
    timeSlice() {
      return new Promise(resolve => {
        setTimeout(() => {
          console.log('timeSlice')
          resolve(null)
        }, 2000)
      })
    },
    async handleFontColorChanged(newColor) {
      this.fontColorPicked = newColor;
      let ele = document.querySelector("#showDemoTranslated") as HTMLElement
      ele.style.color = newColor
      console.log("handleFontColorChanged")
    },
    changeSourceLanguage(item) {
      this.sourceLanguageSelected = item.title
      // 保存到数据库
      sendMessageToBackground({
        action: DB_ACTION.CONFIG_SET,
        data: {name: "sourceLanguageSelected", value: item.value}
      })

    },
    toggleSelectionMode() {
      console.log("toggleSelectionMode")
      sendMessageToTab({action: "toggleSelectionMode"})
      window.close()
    },
    changeTargetLanguages(item) {
      this.targetLanguageSelected = item.title
      // 保存到数据库
      sendMessageToBackground({
        action: DB_ACTION.CONFIG_SET,
        data: {name: "targetLanguage", value: item.value}
      })
    },
    getItemByTitle(array: Array<any>, title: string) {
      return array.find(value => value.title == title)
    },
    getItemByValue(array: Array<any>, code: string) {
      return array.find(value => value.value == code)
    },
    async toggleTranslation(translateStatus :boolean) {
      console.log("enter toggleTranslation",translateStatus)
      //设置当前翻译状态
      await sendMessageToBackground({
        action: STORAGE_ACTION.SESSION_SET,
        data: {key: "tabTranslateStatus#" + this.tabs[0].id, value: translateStatus}
      })
      if (translateStatus) {
        // 向content script发送消息,执行特定的翻译行为
        let action = this.viewStrategies.find(value => value.title == this.viewStrategySelected)?.action
        await sendMessageToTab({
          action: action,
          data: {
            targetLanguage: this.getItemByTitle(this.targetLanguages, this.targetLanguageSelected)?.value,
            sourceLanguage: undefined,
            translateService: this.getItemByTitle(this.translateServices, this.translateServiceSelected)?.value
          }
        })
      } else {
        await sendMessageToTab({action: TRANS_ACTION.ORIGIN})
      }

      //关闭popup
      // window.close()
    },
    async changeTranslateServiceSelected(selected) {
      //保存到数据库
      await sendMessageToBackground({
        action: DB_ACTION.CONFIG_SET,
        data: {name: "translateService", value: selected.value}
      })
      this.translateServiceSelected = selected.title
    },
    switchAlwaysTranslateChanged(newVal) {
      console.log("Switch value changed to: ", newVal);
      if (newVal) {
        //获取当前页面的域名
        sendMessageToBackground({action: "getTabLanguage", data: null}).then((response) => {
          console.log("response", response)
          // if (response){
          //   //保存到数据库
          //   // urlStorage.add(response)
          //   // this.items = urlStorage.searchAll()
          // }
        })
      }
      // 在这里执行你的函数
    }
    ,
    selectItem(item: any) {
      this.selected = item.title
    },
    highlightElement(event: MouseEvent
    ) {
      console.log("document")
      const target = event.target as HTMLElement;
      target.style.outline = '2px solid red';
      target.style.outlineOffset = '2px';
    }
  },
  async mounted() {
    //添加样式设置 无样式
    let element = document.querySelector("#noneStyleSelect")
    if (element) {
      element.textContent = "无样式";
    }
    // 获取偏好的目标语言
    try {
      let targetLanguageConfigValue = await sendMessageToBackground({
        action: DB_ACTION.CONFIG_GET,
        data: {name: CONFIG_KEY.TARGET_LANG}
      });
      if (targetLanguageConfigValue) {
        // 根据code获取title 设置前端显示
        this.targetLanguages.forEach(language => {
          if (language.value == targetLanguageConfigValue) {
            this.targetLanguageSelected = language.title;
          }
        })
      } else {
        this.targetLanguages.forEach(language => {
          // get default browser language
          if (language.value == navigator.language) {
            this.targetLanguageSelected = language.title;
          }
        })
      }
      this.tabLanguage = await sendMessageToBackground({action: TB_ACTION.TAB_LANG_GET});
      //获取偏好的源语言
      // let sourceLanguageConfigValue = await sendMessageToBackground({
      //   action: DB_ACTION.CONFIG_GET,
      //   data: {name: "sourceLanguageSelected"}
      // });
      // if (sourceLanguageConfigValue && sourceLanguageConfigValue != COMMON.AUTO) {
      //   this.sourceLanguageSelected = this.getItemByValue(this.sourceLanguages, sourceLanguageConfigValue)?.title;
      //   this.sourceLanguage = sourceLanguageConfigValue;
      // } else {
      //   // get tab default language
      //   this.sourceLanguage = this.tabLanguage
      // }
      // 获取偏好的翻译服务
      let translateServiceConfigValue = await sendMessageToBackground({
        action: DB_ACTION.CONFIG_GET,
        data: {name: CONFIG_KEY.TRANS_SERVICE}
      });
      if (translateServiceConfigValue) {
        this.translateServiceSelected = this.getItemByValue(this.translateServices, translateServiceConfigValue)?.title;
      }
      //获取当前活动的tab
      this.tabs = await browser.tabs.query({active: true, currentWindow: true})
      console.log(this.tabs)
      //页面翻译状态
      let status = await sendMessageToBackground({
        action: STORAGE_ACTION.SESSION_GET,
        data: {key: "tabTranslateStatus#" + this.tabs[0].id}
      })
      if (status) {
        this.translateToggle = status
      }
      // 获取显示策略
      let viewStrategyConfigValue = await sendMessageToBackground({
        action: DB_ACTION.CONFIG_GET,
        data: {name: CONFIG_KEY.VIEW_STRATEGY}
      });
      if (viewStrategyConfigValue) {
        this.viewStrategySelected = this.getItemByValue(this.viewStrategies, viewStrategyConfigValue)?.title;
      }
      // 获取当前域名的翻译策略
      this.domain = await sendMessageToBackground({action: TB_ACTION.TAB_DOMAIN_GET});
      let domainData = await sendMessageToBackground({action: DB_ACTION.DOMAIN_GET, data: {domain: this.domain}});
      if (domainData) {
        //根据strategy value获取title
        this.domainStrategies.forEach(strategy => {
          if (strategy.value == domainData.strategy) {
            this.domainStrategySelected = strategy.title;
          }
        })
        // this.viewStrategies.forEach((vs) => {
        //   if (vs.value == domainData.viewStrategy) {
        //     this.domainStrategySelected = vs.title;
        //   }
        // })
        // this.strategySelectedTitle = domain.strategy;
      }
      console.log("domain", this.domainStrategySelected)
    } catch (e) {
      console.log(e)
    }
  },

}
</script>
<template>
  <div class="main">
    <svg
        class="help"
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
    >
      <path
          d="M8.99902 13.5V13.5396M6.75 6.22999C6.75 4.96388 7.75736 3.9375 9 3.9375C10.2426 3.9375 11.25 4.96388 11.25 6.22999C11.25 7.4961 10.2426 8.52249 9 8.52249C9 8.52249 8.99902 9.20675 8.99902 10.0508M18 9C18 13.9706 13.9706 18 9 18C4.02944 18 0 13.9706 0 9C0 4.02944 4.02944 0 9 0C13.9706 0 18 4.02944 18 9Z"
          stroke="#9DA6CB"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
      />
    </svg>
    <div class="login">
      <div class="avatar">
        <div class="ellipse-583"></div>
        <img class="avatar-image" style="width: 60px;height: 60px"
             src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRCyB8Jms4jsegDW1tuOeFuA7XiN5p65ccZVDifwa85AA&s"/>
      </div>
      <div class="login-message">
        <div class="logged-in">Logged in</div>
        <div class="div">{{ t('loginToSynchronizeData') }}</div>
      </div>
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
          <!--          规则模式-->
          <marquee-text :text="t('modeOfRule')" width="70px"></marquee-text>
        </div>
      </div>
    </div>
    <div class="main-function">
      <div class="translate-select">
        <div class="btn-strategy">
          <el-dropdown @command="changeViewStrategy" trigger="click" size="large">
            <div class="select-strategy">
              <div class="button-text">{{ t(viewStrategySelected) }}</div>
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
                <el-dropdown-item v-for="(viewStrategy,index) in viewStrategies" :command="viewStrategy">
                  {{ t(viewStrategy.title) }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>

        </div>

        <div class="btn-target">
          <el-dropdown @command="changeTargetLanguage" trigger="click" size="large">
            <div class="select-target">
              <div class="button-text">{{ t(targetLanguageSelected) }}</div>
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
                <el-dropdown-item v-for="(targetLanguage,index) in targetLanguages" :command="targetLanguage">
                  {{ t(targetLanguage.title) }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>

        </div>
      </div>
      <div class="translate-service">
        <el-dropdown @command="changeTranslateService" trigger="click" size="large">

          <div class="btn-trans">
            <div class="leading-icon2">
              <img :src="'fi-brands-'+ getItemByTitle(translateServices,translateServiceSelected).value + '.svg'"
                   :alt="translateServiceSelected">
            </div>
            <div class="button-text-large">{{ t(translateServiceSelected) }}</div>
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
              <el-dropdown-item :command="translateService" v-for="(translateService,index) in translateServices">
                {{ t(translateService.title) }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <div class="translate-toggle">
        <custom-switch v-model="translateToggle" class="my-custom-class" :swidth="'60'"
                       size="large"
                       :active-text="t('translate')"
                       :inactive-text="t('original')"
                       :bgColor="'#FFF8F7'"
                       @change="toggleTranslation"
        ></custom-switch>
        <!--        <div class="btn-toggle">-->
        <!--          <div class="div2">原文</div>-->
        <!--          <div class="toggle">-->
        <!--            <div class="ellipse"></div>-->
        <!--          </div>-->
        <!--          <div class="div3">翻译</div>-->
        <!--        </div>-->
      </div>
    </div>
    <div class="style">
      <div class="styleSetting">
        <marquee-text :text="t('border')" width="148px"></marquee-text>
        <!--        {{t('border')}}-->
      </div>
      <el-select v-model="styleSelected" placeholder="Select">
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
        <!--        {{t('backgroundColor')}}-->
        <marquee-text :text="t('backgroundColor')" width="148px"></marquee-text>
      </div>
      <custom-color-picker @color-changed="handleBgColorChanged">

      </custom-color-picker>
      <!--      <section class=" bg-color-pick-list
      ">-->
      <!--        <span class="color-item" @click="checkedColor($event)">-->
      <!--          </span>-->
      <!--        <span class="color-item" style="color: #df5f47" @click="checkedColor($event)">-->
      <!--          </span>&lt;!&ndash;&ndash;&gt;-->
      <!--        <span class="color-item" style="color:#57a0ee;" @click="checkedColor($event)">-->
      <!--          </span>&lt;!&ndash;&ndash;&gt;-->
      <!--        <span class="color-item" style="color:#faec63;" @click="checkedColor($event)">-->
      <!--          </span>&lt;!&ndash;&ndash;&gt;-->
      <!--        <span class="color-item" style="color:#73b364;" @click="checkedColor($event)">-->
      <!--          </span>&lt;!&ndash;&ndash;&gt;-->
      <!--        <span class="color-item" id="bgColorPickBox" @click="showColorPicker()">-->
      <!--  <el-color-picker id="colorPicker" v-model="colorPicked" ref="colorPickerComponent"/>-->
      <!--        </span>-->
      <!--      </section>-->
      <div class="styleSetting">
        <!--        {{t('fontColor')}}-->
        <marquee-text :text="t('fontColor')" width="148px"></marquee-text>
      </div>
      <custom-color-picker @color-changed="handleFontColorChanged">

      </custom-color-picker>
      <div class="styleSetting">
        <!--        {{t('padding')}}-->
        <marquee-text :text="t('padding')" width="148px"></marquee-text>
      </div>
      <el-slider v-model="stylePadding" size="small" input-size="small" :min="1" :max="10"/>
    </div>

    <div class="style-show">
      <div class="mb-2 flex items-center text-sm">
        <el-radio-group v-model="domainStrategySelected" class="ml-0">
          <el-radio @change="changeDomainStrategy" v-for="(domainStrategy,index) in domainStrategies"
                    :value="domainStrategy.title" size="large">
            <marquee-text :text="t(domainStrategy.title)" width="135px"></marquee-text>
            <!--            <marquee-text text="Here is the original fff ssf ff"></marquee-text>-->
            <!--            {{t(domainStrategy.title)}}-->
          </el-radio>
        </el-radio-group>
      </div>
      <div class="this-is-text">Here is the original</div>
      <div class="show">
        <!--        <div class="rectangle-1523"></div>-->
        <p id="showDemoTranslated">
          {{ t('hereIsTheTranslation') }}
        </p>
      </div>
    </div>
  </div>


</template>

<style scoped>

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

.color-item:nth-last-child(1) {
  background-color: #EFEFEF;
  background-image: url("/colourfulRectangle.svg");

}

.color-item:nth-child(1) {
  background-color: #EFEFEF;
  background-image: url("/transparentRectangle.svg");
}

.color-item {
  display: inline-block;
  position: relative;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  background-color: currentcolor;

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
  height: 544px;
  position: relative;
  overflow: hidden;
}

.help {
  width: 4.8%;
  height: 3.31%;
  position: absolute;
  right: 4%;
  left: 91.2%;
  bottom: 88.79%;
  top: 7.9%;
  overflow: visible;
}

.login {
  display: flex;
  flex-direction: row;
  gap: 30px;
  align-items: center;
  justify-content: center;
  width: 309px;
  height: 71px;
  position: absolute;
  left: 33px;
  top: 17px;
}

.avatar {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
  justify-content: flex-start;
  flex-shrink: 0;
  position: relative;
}

.ellipse-583 {
  background: #c8f7dc;
  border-radius: 50%;
  flex-shrink: 0;
  width: 84.9%;
  height: 84.9%;
  position: absolute;
  right: 6.52%;
  left: 8.58%;
  bottom: 8.82%;
  top: 6.28%;
}

.avatar-image {
  flex-shrink: 0;
  width: 100%;
  height: 100%;
  position: absolute;
  right: 0%;
  left: 0%;
  bottom: 0%;
  top: 0%;
  object-fit: cover;
}

.login-message {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  justify-content: flex-start;
  flex-shrink: 0;
  width: 85px;
  height: 39px;
  position: relative;
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
  width: 120px;
  height: 33px;
  position: relative;
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
  padding: 8px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  width: 148px;
  height: 232px;
  position: absolute;
  left: 33px;
  top: 289px;
  overflow: hidden;
}

.styleSetting {
  color: #000000;
  text-align: left;
  font-family: var(--presets-body2-font-family, "Inter-Regular", sans-serif);
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
  height: 196px;
  position: absolute;
  left: 196px;
  top: 297px;
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
  text-align: left;
  font-family: var(--presets-body2-font-family, "Inter-Regular", sans-serif);
  font-size: var(--presets-body2-font-size, 16px);
  line-height: var(--presets-body2-line-height, 24px);
  font-weight: var(--presets-body2-font-weight, 400);
  position: relative;
}

.show {
  flex-shrink: 0;
  /*width: 103px;*/
  height: 33px;
  position: relative;
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
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

</style>
