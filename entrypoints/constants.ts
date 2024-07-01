// chrome api message status code

export default defineUnlistedScript({
    main(): void | Promise<void> {
    }
})
export const STATUS_SUCCESS = '200';
export const STATUS_FAIL = '500';
export enum DB_ACTION {
    RULES_ADD = 'addRule',
    RULES_DEL = 'deleteRule',
    RULES_GET_ALL = 'getAllRule',
    RULES_SEARCH = 'searchRule',
    DOMAIN_INSERT= 'insertDomain',
    DOMAIN_UPDATE= 'updateDomain',
    DOMAIN_GET = 'getDomain',
    CONFIG_GET = 'getConfig',
    CONFIG_SET = 'setConfig',
}
export enum STORAGE_ACTION {
    SESSION_GET = 'getSessionStorage',
    SESSION_SET = 'setSessionStorage',
    LOCAL_SET = 'setLocalStorage',
    LOCAL_GET = 'getLocalStorage',
    SYNC_SET = 'setSyncStorage',
    SYNC_GET = 'getSyncStorage',
}
//针对标签页的操作，获取域名，获取页面语言等
export enum TB_ACTION  {
    TAB_LANG_GET = 'getTabLanguage',
    TAB_DOMAIN_GET = 'getTabDomain',
    TAB_ID_GET = 'getTabId',
}

export const NONE = 'none'
export const DEFAULT = 'default'

export enum DOMAIN_STRATEGY{
    NEVER = 'never',
    ALWAYS = 'always',
    AUTO = 'auto',
    ASK = 'ask',
    NON_TARGET = 'nonTarget',
}

export enum VIEW_STRATEGY{
    NEVER = 'never',
    DOUBLE = 'double',
    SINGLE = 'single',
    BUTTON = 'button',
}
export enum COMMON{
    ENABLE = 'enable',
    DISABLE = 'disable',
    AUTO = 'auto',
}

//语言代码
export enum LANG_CODE {
    EN = 'en',
    ZH_CN = 'zh-CN',
    ZH_TW = 'zh-TW',
    JA = 'ja',
    KO = 'ko',
    FR = 'fr',
    DE = 'de',
    ES = 'es',
    IT = 'it',
    PT = 'pt',
    RU = 'ru',
    AR = 'ar',
    TR = 'tr',
    VI = 'vi',
    TH = 'th',
    ID = 'id',
    MS = 'ms',
    HI = 'hi',
    BN = 'bn',
    TE = 'te',
    TA = 'ta',
    UR = 'ur',
    FA = 'fa',
    HE = 'he',
    PL = 'pl',
    HU = 'hu',
    CS = 'cs',
    SK = 'sk',
    UK = 'uk',
    NL = 'nl',
    SV = 'sv',
    DA = 'da',
    NO = 'no',
    FI = 'fi',
    ET = 'et',
    LV = 'lv',
    LT = 'lt',
    MT = 'mt',
    RO = 'ro',
    BG = 'bg',
    EL = 'el',
    SL = 'sl',
    HR = 'hr',
    SR = 'sr',
    MK = 'mk',
    SQ = 'sq',
    HY = 'hy',
    KA = 'ka',
    IS = 'is',
    EU = 'eu',
    CY = 'cy',
    GA = 'ga',
    MI = 'mi',
    SM = 'sm',
    TO = 'to',
    HAW = 'haw',
    TL = 'tl',
    GSW = 'gsw',
    LB = 'lb',
    KL = 'kl',
    FO = 'fo',
    GL = 'gl',
    CA = 'ca',
    AST = 'ast',
    AN = 'an',
    OC = 'oc',
    CO = 'co',
    BR = 'br',
    FRP = 'frp',
    MRJ = 'mrj',
    SAH = 'sah',
    ME = 'me',
    UDM = 'udm',
    BE = 'be',
    BE_BY = 'be_BY',
    UK_UA = 'uk_UA',
    RU_RU = 'ru_RU',
    RU_UA = 'ru_UA',
    BG_BG = 'bg_BG  }'
}

//翻译方式
export enum TRANS_SERVICE {
    GOOGLE = 'google',
    BAIDU = 'baidu',
    YOUDAO = 'youdao',
    SUGGEST = 'suggest',
    DEEPL = 'deepl',
    TENCENT = 'tencent',
    ALI = 'ali',
    MICROSOFT = 'microsoft',
    PAPAGO = 'papago',
    WATSON = 'watson',
    YANDEX = 'yandex',
    DEFAULT = 'default',
}

//翻译页面
export enum TRANS_ACTION{
    DOUBLE = 'doubleTranslate',
    SINGLE = 'singleTranslate',
    TOGGLE = 'toggleTranslate',
    ORIGIN = 'showOrigin',
}

export enum CONFIG_KEY {
    DOMAIN_STRATEGY = 'domainStrategy',
    VIEW_STRATEGY = 'viewStrategy',
    TARGET_LANG = 'targetLanguage',
    SOURCE_LANG = 'sourceLanguage',
    TRANS_SERVICE = 'transService',
    STYLE = 'style',
    BG_COLOR = 'bgColor',
    FONT_COLOR = 'fontColor',
    PADDING = 'padding',
    BG_COLOR_INDEX = 'bgColorIndex',
    FONT_COLOR_INDEX = 'fontColorIndex',
}

