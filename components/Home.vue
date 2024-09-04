<script lang="ts">
import {ref} from 'vue';
import CustomColorPicker from "@/components/CustomColorPicker.vue";
import CustomSwitch from "@/components/CustomSwitch.vue";
import {rgbToHex, sendMessageToBackground, sendMessageToTab} from "@/entrypoints/utils";
import {
  COMMON,
  CONFIG_KEY,
  DB_ACTION,
  DOMAIN_STRATEGY,
  LANG_CODE,
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
// import {useUserStore} from "@/utils/userStorage";
import {getUserList, getUserInfo} from "@/api/user";

const title = import.meta.env.VITE_APP_TITLE
const env = import.meta.env.VITE_ENV
export default {
  computed: {
    translationServices() {
      return translationServices
    }
  },
  setup() {
    // const userStorage = useUserStore()
    const bgColorIndex = ref(0); // 默认选中颜色的索引
    const {t} = useI18n();
    const colorPickerComponent = ref(null)
    const padding = ref(3)
    const callInternalMethod = () => {
      if (colorPickerComponent.value) {
        colorPickerComponent.value.show();
      }
    };
    return {
      // userStorage,
      colorPickerComponent,
      callInternalMethod,
      padding: padding,
      t,
      // bgColorIndex,
    };
  },
  watch: {
    bgColor(newVal, oldVal) {
      // 储存当前颜色到配置文件

      console.log("bgColor saved")
      sendMessageToBackground({action: DB_ACTION.CONFIG_SET, data: {name: CONFIG_KEY.BG_COLOR, value: newVal}});
      let ele = document.querySelector("#showDemoTranslated") as HTMLElement
      ele.style.backgroundColor = newVal
      console.log('selectedColor', newVal, 'oldVal', oldVal)
    },
    fontColor(newVal, oldVal) {
      // 储存当前颜色到配置文件
      sendMessageToBackground({action: DB_ACTION.CONFIG_SET, data: {name: CONFIG_KEY.FONT_COLOR, value: newVal}});
      let ele = document.querySelector("#showDemoTranslated") as HTMLElement
      ele.style.color = newVal
    },
    bgColorIndex(newVal) {
      // 储存当前颜色到配置文件
      sendMessageToBackground({action: DB_ACTION.CONFIG_SET, data: {name: CONFIG_KEY.BG_COLOR_INDEX, value: newVal}})
      console.log('bgColorIndex', newVal)
    },
    fontColorIndex(newVal) {
      // 储存当前颜色到配置文件
      sendMessageToBackground({action: DB_ACTION.CONFIG_SET, data: {name: CONFIG_KEY.FONT_COLOR_INDEX, value: newVal}})
    },
    async padding(newVal) {
      console.log('padding', newVal)
      // 储存配置到数据库
      await sendMessageToBackground({
        action: DB_ACTION.CONFIG_SET,
        data: {name: CONFIG_KEY.PADDING, value: newVal}
      })
      let ele = document.querySelector("#showDemoTranslated") as HTMLElement
      //设置文字和下划线的间距
      if (this.style.endsWith("Line")) {
        ele.style.textUnderlineOffset = `${newVal}px`
      } else if (this.style.endsWith("Border")) {
        ele.style.padding = `${newVal}px`
      }
      // ele.style.textUnderlineOffset = `${newVal}px`
    },
    async style(newVal) {
      // 储存配置到数据库
      await sendMessageToBackground({
        action: DB_ACTION.CONFIG_SET,
        data: {name: CONFIG_KEY.STYLE, value: newVal}
      })
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
      console.log(newVal)
    },
    // bgColor(newVal, oldVal) {
    //   if (newVal == this.fontColor) {
    //     this.bgColor = oldVal
    //   }
    // },
    // fontColorPicked(newVal) {
    //
    // }

  },
  components: {MarqueeText, CustomSwitch, CustomColorPicker},
  data() {
    const userStorage = useUserStore
    // const userInfo = getUserInfo
    return {
      globalSwitch:true,
      isPopupWindow: false, // 默认假设不是弹出窗口
      // userInfo,
      // userStorage,
      bgColorIndex: -1,
      fontColorIndex: -1,
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
      domainStrategy: "automaticallyDetermineWhetherToTranslate",
      // strategySelected: {title: "displayBilingual", value: VIEW_STRATEGY.DOUBLE, action: TRANS_ACTION.DOUBLE},
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
      bgColor: undefined,
      fontColor: undefined,
      style: 'noneStyleSelect',
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
    openInWindow() {
      window.open('/popup.html', '_blank', 'width=404,height=635,scrollbars=no,resizable=no,location=no,status=no');

      // browser.windows.create({
      //   url: "/popup.html",
      //   type: "popup",
      //   width: 375,
      //   height: 700,
      // })
    },
    async test() {
      const res = await getUserInfo()
      console.log("ffddfffffff")
      // console.log("testssss",res)
      // console.log("testssss",res)
      // this.userStorage.setToken('123')
      // console.log('get token',this.userStorage.token)
      // service.get("/test").then((res) => {
      //   console.log(res);
      // });
      // console.log('bgColor',this.bgColor)
      // console.log('app',title)
      // console.log('env',env)
      // console.log('process path',process.env.VITE_APP_TITLE)
    },
    changeDomainStrategy(selected) {
      // 获取到域名,然后保存策略到数据库
      sendMessageToBackground({
        action: DB_ACTION.DOMAIN_UPDATE,
        data: {domain: this.domain, strategy: this.getItemByTitle(this.domainStrategies, selected)?.value}
      }).then((response) => {
        //修改前端显示的策略
        this.domainStrategy = selected;
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
      this.translateService = selected.title
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
      this.viewStrategy = selected.title
    },
    async changeTargetLanguage(selected) {
      //保存到数据库
      await sendMessageToBackground({
        action: DB_ACTION.CONFIG_SET,
        data: {name: CONFIG_KEY.TARGET_LANG, value: selected.value}
      })
      this.targetLanguage = selected.title
    },
    handleColorChecked() {
      return {bgColor: this.bgColor, fontColor: this.fontColor}
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
    // async handleBgColorChanged(newColor) {
    //   this.bgColor = newColor;
    //   // 储存当前颜色到配置文件
    //   await sendMessageToBackground({action: DB_ACTION.CONFIG_SET, data: {name: CONFIG_KEY.BG_COLOR, value: newColor}});
    //   // await sendMessageToBackground({action:DB_ACTION.CONFIG_SET,data:{name:CONFIG_KEY.BG_COLOR_INDEX,value:this.bgColorIndex}})
    //   this.bgColor = newColor;
    //   let ele = document.querySelector("#showDemoTranslated") as HTMLElement
    //   ele.style.backgroundColor = newColor
    //
    //   // await this.timeSlice()
    //   // console.log("handleBgColorChanged")
    // },
    timeSlice() {
      return new Promise(resolve => {
        setTimeout(() => {
          console.log('timeSlice')
          resolve(null)
        }, 2000)
      })
    },
    // async handleFontColorChanged(newColor) {
    //   this.fontColor = newColor;
    //   // 储存当前颜色到配置文件
    //   await sendMessageToBackground({
    //     action: DB_ACTION.CONFIG_SET,
    //     data: {name: CONFIG_KEY.FONT_COLOR, value: newColor}
    //   });
    //   let ele = document.querySelector("#showDemoTranslated") as HTMLElement
    //   ele.style.color = newColor
    //   console.log("handleFontColorChanged")
    // },
    changeSourceLanguage(item) {
      this.sourceLanguage = item.title
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
      this.targetLanguage = item.title
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
    async toggleTranslation(translateStatus: boolean) {
      console.log("enter toggleTranslation", translateStatus)
      //设置当前翻译状态
      await sendMessageToBackground({
        action: STORAGE_ACTION.SESSION_SET,
        data: {key: "tabTranslateStatus#" + this.tabs[0].id, value: translateStatus}
      })
      if (translateStatus) {
        // 向content script发送消息,执行特定的翻译行为
        let action = this.viewStrategies.find(value => value.title == this.viewStrategy)?.action
        await sendMessageToTab({
          action: action,
          data: {
            targetLanguage: this.getItemByTitle(this.targetLanguages, this.targetLanguage)?.value,
            sourceLanguage: undefined,
            translateService: this.getItemByTitle(this.translateServices, this.translateService)?.value
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
      this.translateService = selected.title
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
    // 检查是否为弹出窗口
    this.isPopupWindow = !!window.opener;
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
        this.translateService = this.getItemByValue(this.translateServices, translateServiceConfigValue)?.title;
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
        this.viewStrategy = this.getItemByValue(this.viewStrategies, viewStrategyConfigValue)?.title;
      }
      // 获取当前域名的翻译策略
      this.domain = await sendMessageToBackground({action: TB_ACTION.TAB_DOMAIN_GET});
      let domainData = await sendMessageToBackground({action: DB_ACTION.DOMAIN_GET, data: {domain: this.domain}});
      if (domainData) {
        //根据strategy value获取title
        this.domainStrategies.forEach(strategy => {
          if (strategy.value == domainData.strategy) {
            this.domainStrategy = strategy.title;
          }
        })
        // 样式初始化
        // 赋值style
        this.style = await sendMessageToBackground({
          action: DB_ACTION.CONFIG_GET,
          data: {name: CONFIG_KEY.STYLE}
        })
        // 赋值颜色
        let bgColorConfig = await sendMessageToBackground({
          action: DB_ACTION.CONFIG_GET,
          data: {name: CONFIG_KEY.BG_COLOR}
        })
        if (bgColorConfig) {
          this.bgColor = bgColorConfig
        }
        let fontColorConfig = await sendMessageToBackground({
          action: DB_ACTION.CONFIG_GET,
          data: {name: CONFIG_KEY.FONT_COLOR}
        })
        if (fontColorConfig) {
          this.fontColor = fontColorConfig
        }
        let bgColorIndexConfig = await sendMessageToBackground({
          action: DB_ACTION.CONFIG_GET,
          data: {name: CONFIG_KEY.BG_COLOR_INDEX}
        })
        if (bgColorIndexConfig != undefined) {
          this.bgColorIndex = Number(bgColorIndexConfig)
        } else {
          this.bgColorIndex = 0;
        }
        let fontColorIndexConfig = await sendMessageToBackground({
          action: DB_ACTION.CONFIG_GET,
          data: {name: CONFIG_KEY.FONT_COLOR_INDEX}
        })
        if (fontColorIndexConfig != undefined) {
          this.fontColorIndex = Number(fontColorIndexConfig)
        } else {
          this.fontColorIndex = 0;
        }
        this.padding = await sendMessageToBackground({
          action: DB_ACTION.CONFIG_GET,
          data: {name: CONFIG_KEY.PADDING}
        })
        // this.viewStrategies.forEach((vs) => {
        //   if (vs.value == domainData.viewStrategy) {
        //     this.domainStrategySelected = vs.title;
        //   }
        // })
        // this.strategySelectedTitle = domain.strategy;
      }
      console.log("domain", this.domainStrategy)
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
      <div class="avatar" @click="openInWindow">
        <el-tooltip :content="t('popUpToANewWindow')" placement="bottom" effect="customized" showAfter="500">
          <div class="btn-window" v-if="!isPopupWindow">
            <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 25 25" fill="none">
              <g clip-path="url(#clip0_251_936)">
                <path d="M24.1455 15.0024C23.6743 15.0024 23.291 15.3857 23.291 15.8569V21.543C23.291 22.5073 22.5073 23.291 21.543 23.291H3.45703C3.29346 23.291 3.13477 23.2666 2.9834 23.2251L11.8652 14.3433V18.8721C11.8652 19.3433 12.2485 19.7266 12.7197 19.7266C13.1909 19.7266 13.5742 19.3433 13.5742 18.8721V12.2388C13.5742 12.2314 13.5742 12.2266 13.5718 12.2192C13.5718 12.2119 13.5718 12.2046 13.5693 12.1973C13.5693 12.1899 13.5669 12.1802 13.5669 12.1729C13.5669 12.168 13.5645 12.1631 13.5645 12.1558C13.562 12.146 13.562 12.1387 13.5596 12.1289C13.5596 12.124 13.5571 12.1191 13.5571 12.1143C13.5547 12.1045 13.5522 12.0972 13.5522 12.0874C13.5522 12.0825 13.5498 12.0776 13.5498 12.0728C13.5474 12.063 13.5449 12.0557 13.5425 12.0459C13.54 12.041 13.54 12.0361 13.5376 12.0312C13.5352 12.0239 13.5327 12.0166 13.5303 12.0068C13.5278 12.002 13.5278 11.9971 13.5254 11.9897L13.5181 11.9678C13.5156 11.9604 13.5132 11.9556 13.5107 11.9482C13.5083 11.9409 13.5059 11.936 13.5034 11.9312C13.501 11.9238 13.4961 11.9165 13.4937 11.9116L13.4863 11.897C13.4814 11.8896 13.479 11.8823 13.4741 11.875C13.4717 11.8701 13.4692 11.8652 13.4668 11.8628C13.4619 11.8555 13.457 11.8481 13.4521 11.8384C13.4497 11.8335 13.4473 11.8311 13.4448 11.8262C13.4399 11.8188 13.4351 11.8115 13.4302 11.8018C13.4277 11.7969 13.4253 11.7944 13.4229 11.7896L13.4082 11.7676C13.4058 11.7627 13.4009 11.7603 13.3984 11.7554C13.3936 11.748 13.3887 11.7432 13.3838 11.7358C13.3789 11.731 13.374 11.7261 13.3691 11.7188C13.3643 11.7139 13.3594 11.709 13.3569 11.7041C13.3472 11.6943 13.3374 11.6846 13.3276 11.6724C13.3179 11.6626 13.3081 11.6528 13.2959 11.6431C13.291 11.6382 13.2861 11.6333 13.2812 11.6309C13.2764 11.626 13.269 11.6211 13.2642 11.6162C13.2568 11.6113 13.252 11.6064 13.2446 11.6016C13.2397 11.5991 13.2349 11.5942 13.2324 11.5918L13.2104 11.5771C13.2056 11.5747 13.2031 11.5723 13.1982 11.5698L13.1763 11.5552C13.1714 11.5527 13.1689 11.5503 13.1641 11.5479C13.1567 11.543 13.1494 11.5381 13.1396 11.5356C13.1348 11.5332 13.1299 11.5308 13.1274 11.5283C13.1201 11.5234 13.1128 11.521 13.1055 11.5161L13.0908 11.5088C13.0835 11.5063 13.0762 11.5015 13.0713 11.499C13.0664 11.4966 13.0591 11.4941 13.0542 11.4917C13.0469 11.4893 13.042 11.4868 13.0347 11.4844L13.0127 11.4771C13.0078 11.4746 13.0005 11.4722 12.9956 11.4722C12.9883 11.4697 12.981 11.4673 12.9712 11.4648C12.9663 11.4624 12.9614 11.4624 12.9565 11.46C12.9492 11.4575 12.9395 11.4551 12.9297 11.4526C12.9248 11.4526 12.9199 11.4502 12.915 11.4502C12.9053 11.4478 12.8979 11.4453 12.8882 11.4453C12.8833 11.4453 12.8784 11.4429 12.8735 11.4429C12.8638 11.4404 12.8564 11.4404 12.8467 11.438C12.8418 11.438 12.8345 11.4355 12.8296 11.4355C12.8223 11.4355 12.8125 11.4331 12.8052 11.4331C12.7979 11.4331 12.7905 11.4331 12.7832 11.4307C12.7759 11.4307 12.771 11.4307 12.7637 11.4282H6.12793C5.65674 11.4282 5.27344 11.8115 5.27344 12.2827C5.27344 12.7539 5.65674 13.1372 6.12793 13.1372H10.6567L1.7749 22.0166C1.7334 21.8652 1.70898 21.7065 1.70898 21.543V3.45703C1.70898 2.49268 2.49268 1.70898 3.45703 1.70898H9.14307C9.61426 1.70898 9.99756 1.32568 9.99756 0.854492C9.99756 0.383301 9.61426 0 9.14307 0H3.45703C1.55029 0 0 1.55029 0 3.45703V21.543C0 23.4497 1.55029 25 3.45703 25H21.543C23.4497 25 25 23.4497 25 21.543V15.8569C25 15.3857 24.6167 15.0024 24.1455 15.0024Z" fill="#8A8A8A"/>
                <path d="M21.9653 0H18.269C16.5942 0 15.2344 1.35986 15.2344 3.03467V6.73096C15.2344 8.4082 16.5942 9.76562 18.269 9.76562H21.9653C23.6426 9.76562 25 8.40576 25 6.73096V3.03467C25 1.35986 23.6401 0 21.9653 0ZM23.291 6.73096C23.291 7.46338 22.6953 8.05664 21.9653 8.05664H18.269C17.5366 8.05664 16.9434 7.46094 16.9434 6.73096V3.03467C16.9434 2.30225 17.5391 1.70898 18.269 1.70898H21.9653C22.6978 1.70898 23.291 2.30469 23.291 3.03467V6.73096Z" fill="#8A8A8A"/>
              </g>
              <defs>
                <clipPath id="clip0_251_936">
                  <rect width="25" height="25" fill="white"/>
                </clipPath>
              </defs>
            </svg>
<!--            <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30" fill="none">-->
<!--              <path d="M16.45 15.5002C16.45 15.2502 16.35 15.0002 16.15 14.8002L4.65002 3.30025L13 3.30025C13.55 3.30025 14 2.85024 14 2.30024C14 1.75024 13.55 1.30024 13 1.30024L2.15002 1.30024C1.60002 1.30024 1.15002 1.75024 1.15002 2.30024L1.15002 13.1502C1.15002 13.7002 1.60002 14.1502 2.15002 14.1502C2.70002 14.1502 3.15002 13.7002 3.15002 13.1502L3.15002 4.60024L14.75 16.2002C15.15 16.6002 15.75 16.6002 16.15 16.2002C16.35 16.0002 16.45 15.7502 16.45 15.5002Z" fill="#64748B"/>-->
<!--              <path d="M17.4 2.20029C17.4 2.75029 17.85 3.20029 18.4 3.20029L27.25 3.20029L27.25 27.3003L3.15002 27.3003L3.15002 19.0503C3.15002 18.5003 2.70002 18.0503 2.15002 18.0503C1.60002 18.0503 1.15002 18.5003 1.15002 19.0503L1.15002 28.3003C1.15002 28.8503 1.60002 29.3003 2.15002 29.3003L28.25 29.3003C28.8 29.3003 29.25 28.8503 29.25 28.3003L29.25 2.20029C29.25 1.65029 28.8 1.20029 28.25 1.20029L18.4 1.20029C17.85 1.20029 17.4 1.65029 17.4 2.20029Z" fill="#64748B"/>-->
<!--            </svg>-->
            <!--            <marquee-text @click="openInWindow" :text="'open in window'" width="90px"></marquee-text>-->
            <!--          <img src="@/public/avatar.png" class="avatar-image"  alt="avatar" style="width: 60px;height: 60px"/>-->
          </div>
        </el-tooltip>
        <div class="login-message">

        </div>
      </div>
      <div>
        <el-tooltip :content="t('globalSwitch')" placement="bottom" effect="customized" showAfter="200">
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

      <el-tooltip :content="t('specifyAreasNotToBeTranslated')" placement="bottom" effect="customized" showAfter="500">
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
      </el-tooltip>
    </div>
    <div class="main-function">
      <div class="translate-select">
        <el-tooltip :content="t('displayMode')" placement="bottom" effect="customized" showAfter="500">
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
                  <el-dropdown-item v-for="(viewStrategy,index) in viewStrategies" :command="viewStrategy">
                    {{ t(viewStrategy.title) }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>

          </div>
        </el-tooltip>
        <el-tooltip :content="t('targetLanguage')" placement="bottom" effect="customized" showAfter="500">
          <div class="btn-target">
          <el-dropdown @command="changeTargetLanguage" trigger="click" size="large">
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
                <el-dropdown-item v-for="(targetLanguage,index) in targetLanguages" :command="targetLanguage">
                  {{ t(targetLanguage.title) }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>

        </div>
        </el-tooltip>
      </div>
      <el-tooltip :content="t('translateService')" placement="bottom" effect="customized" showAfter="500">
      <div class="translate-service">
        <el-dropdown @command="changeTranslateService" trigger="click" size="large">

          <div class="btn-trans">
            <div class="leading-icon2">
              <img :src="'fi-brands-'+ getItemByTitle(translateServices,translateService).value + '.svg'"
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
              <el-dropdown-item :command="translateService" v-for="(translateService,index) in translateServices">
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
      <p>译文样式</p>
      <div class="styleSetting">
        <marquee-text :text="t('border')" width="148px"></marquee-text>
        <!--        {{t('border')}}-->
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
        <!--        {{t('backgroundColor')}}-->
        <marquee-text :text="t('backgroundColor')" width="148px"></marquee-text>
      </div>
      <custom-color-picker v-model="bgColor" v-model:selectedIndex="bgColorIndex">

      </custom-color-picker>
      <div class="styleSetting">
        <marquee-text :text="t('fontColor')" width="148px"></marquee-text>
      </div>
      <!-- font-color -->
      <!--      @color-changed="handleFontColorChanged"-->
      <custom-color-picker v-model="fontColor"
                           v-model:selectedIndex="fontColorIndex">

      </custom-color-picker>
<!--      <div class="styleSetting">-->
<!--        &lt;!&ndash;        {{t('padding')}}&ndash;&gt;-->
<!--        <marquee-text :text="t('padding')" width="148px"></marquee-text>-->
<!--      </div>-->
<!--      <el-slider v-model="padding" size="small" input-size="small" :min="1" :max="10"/>-->
      <p>对照高亮</p>
      <div class="styleSetting">
        <!--        {{t('backgroundColor')}}-->
        <marquee-text :text="t('backgroundColor')" width="148px"></marquee-text>
      </div>
      <custom-color-picker v-model="bgColor" v-model:selectedIndex="bgColorIndex">

      </custom-color-picker>
      <div class="styleSetting">
        <!--        {{t('backgroundColor')}}-->
        <marquee-text :text="t('backgroundColor')" width="148px"></marquee-text>
      </div>
      <custom-color-picker v-model="bgColor" v-model:selectedIndex="bgColorIndex">

      </custom-color-picker>
    </div>

    <div class="style-show">
      <div class="mb-2 flex items-center text-sm">
        <el-radio-group v-model="domainStrategy" class="ml-0">
          <el-radio @change="changeDomainStrategy" v-for="(domainStrategy,index) in domainStrategies"
                    :value="domainStrategy.title" size="large">
            <marquee-text :text="t(domainStrategy.title)" width="135px"></marquee-text>
            <!--            <marquee-text text="Here is the original fff ssf ff"></marquee-text>-->
            <!--            {{t(domainStrategy.title)}}-->
          </el-radio>
        </el-radio-group>
      </div>
      <div class="bilingual-highlighting">
        <marquee-text :text="t('bilingual Highlighting')" width="90px"></marquee-text>
        <el-switch
            v-model="bilingualHighlighting"
            size="large"/>
      </div>
      <div class="this-is-text">I'm a little bird. How can I fly high.</div>
<!--      <div class="showDemoTranslated">I'm a little bird, how can I fly high</div>-->
      <div class="show">
        <!--        <div class="rectangle-1523"></div>-->

           <p id="showDemoTranslated">
              <span>
          我是一只小小鸟。
             <!--          {{ t('hereIsTheTranslation') }}-->
                 </span>
             <span>
          怎么飞都飞不高。
               <!--          {{ t('hereIsTheTranslation') }}-->
                 </span>
        </p>


<!--        <v-btn @click="test">test</v-btn>-->
      </div>
    </div>

  </div>


</template>

<style>
.el-popper.is-customized {
  /* Set padding to ensure the height is 32px */
  padding: 6px 12px;
  background: linear-gradient(90deg, rgb(159, 229, 151), rgb(204, 229, 129));
}

.el-popper.is-customized .el-popper__arrow::before {
  background: linear-gradient(45deg, #b2e68d, #bce689);
  right: 0;
}

.btn-window {
  /*background: var(--component-fill-component-fill-warning, rgb(223, 95, 71));*/
  /*border-radius: var(--radius-radius-sm-4x, 8px);*/
  /*padding: var(--padding-padding-12px, 12px) 12px var(--padding-padding-12px, 12px) 12px;*/
  /*display: flex;*/
  /*flex-direction: row;*/
  /*gap: 11px;*/
  /*align-items: center;*/
  /*justify-content: flex-start;*/
  /*flex-shrink: 0;*/
  /*width: 110px;*/
  /*height: 33px;*/
  /*position: relative;*/
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

.avatar {
  /*padding: 10px;*/
  cursor: pointer;
  width: 33px;
  display: flex;
  flex-direction: row;
  /*gap: 10px;*/
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  /*position: relative;*/
}

/*.ellipse-583 {*/
/*  background: #c8f7dc;*/
/*  border-radius: 50%;*/
/*  flex-shrink: 0;*/
/*  width: 84.9%;*/
/*  height: 84.9%;*/
/*  position: absolute;*/
/*  right: 6.52%;*/
/*  left: 8.58%;*/
/*  bottom: 8.82%;*/
/*  top: 6.28%;*/
/*}*/

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
  margin-right: 10px;
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
  /*height: 232px;*/
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

.bilingual-highlighting{
  display: flex;
  flex-direction: row;
  align-items: center;
  /*align-items: flex-start;*/
  justify-content: space-between;
  /*position: absolute;*/
  width: 150px;
  /*left: 33px;*/
  /*top: 530px;*/
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
  margin-top: 10px;
  font-size: 14px;
  /*white-space: nowrap;*/
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}

</style>
