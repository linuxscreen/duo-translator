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
    RULES_LIST = 'listRule',
    RULES_SEARCH = 'searchRule',
    DOMAIN_INSERT = 'insertDomain',
    DOMAIN_UPDATE = 'updateDomain',
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

// action for tab, get the domain, get the page language, etc.
export enum TB_ACTION {
    TAB_LANG_GET = 'getTabLanguage',
    TAB_DOMAIN_GET = 'getTabDomain',
    TAB_ID_GET = 'getTabId',
}

export enum TAB {
    TAB_TRANSLATE_STATUS = 'tabTranslateStatus',
}

export const NONE = 'none'
export const DEFAULT = 'default'

export enum DOMAIN_STRATEGY {
    NEVER = 'never',
    ALWAYS = 'always',
    AUTO = 'auto',
    ASK = 'ask',
    NON_TARGET = 'nonTarget',
}

export enum VIEW_STRATEGY {
    NEVER = 'never',
    DOUBLE = 'double',
    SINGLE = 'single',
    BUTTON = 'button',
}

export enum COMMON {
    ENABLE = 'enable',
    DISABLE = 'disable',
    AUTO = 'auto',
}

export const LANGUAGES = [
    {
        "title": "simplifiedChinese",
        "value": "zh-CN"
    },
    {
        "title": "traditionalChinese",
        "value": "zh-TW"
    },
    {
        "title": "english",
        "value": "en"
    },
    {
        "title": "french",
        "value": "fr"
    },
    {
        "title": "russian",
        "value": "ru"
    },
    {
        "title": "german",
        "value": "de"
    },
    {
        "title": "japanese",
        "value": "ja"
    },
    {
        "title": "italian",
        "value": "it"
    },
    {
        "title": "spanish",
        "value": "es"
    },
    {
        "title": "korean",
        "value": "ko"
    },
    {
        "title": "portuguese",
        "value": "pt"
    },
    {
        "title": "indonesian",
        "value": "id"
    },
    {
        "title": "arabic",
        "value": "ar"
    },
    {
        "title": "bengali",
        "value": "bn"
    },
    {
        "title": "hindi",
        "value": "hi"
    },
    {
        "title": "afrikaans",
        "value": "af"
    },
    {
        "title": "albanian",
        "value": "sq"
    },
    {
        "title": "amharic",
        "value": "am"
    },
    {
        "title": "armenian",
        "value": "hy"
    },
    {
        "title": "assamese",
        "value": "as"
    },
    {
        "title": "aymara",
        "value": "ay"
    },
    {
        "title": "azerbaijani",
        "value": "az"
    },
    {
        "title": "bambara",
        "value": "bm"
    },
    {
        "title": "basque",
        "value": "eu"
    },
    {
        "title": "belarusian",
        "value": "be"
    },
    {
        "title": "bhojpuri",
        "value": "bho"
    },
    {
        "title": "bosnian",
        "value": "bs"
    },
    {
        "title": "bulgarian",
        "value": "bg"
    },
    {
        "title": "catalan",
        "value": "ca"
    },
    {
        "title": "cebuano",
        "value": "ceb"
    },
    {
        "title": "corsican",
        "value": "co"
    },
    {
        "title": "croatian",
        "value": "hr"
    },
    {
        "title": "czech",
        "value": "cs"
    },
    {
        "title": "danish",
        "value": "da"
    },
    {
        "title": "divehi",
        "value": "dv"
    },
    {
        "title": "dogri",
        "value": "doi"
    },
    {
        "title": "dutch",
        "value": "nl"
    },
    {
        "title": "esperanto",
        "value": "eo"
    },
    {
        "title": "estonian",
        "value": "et"
    },
    {
        "title": "filipino",
        "value": "fil"
    },
    {
        "title": "finnish",
        "value": "fi"
    },
    {
        "title": "frisian",
        "value": "fy"
    },
    {
        "title": "galician",
        "value": "gl"
    },
    {
        "title": "georgian",
        "value": "ka"
    },
    {
        "title": "greek",
        "value": "el"
    },
    {
        "title": "guarani",
        "value": "gn"
    },
    {
        "title": "gujarati",
        "value": "gu"
    },
    {
        "title": "haitianCreole",
        "value": "ht"
    },
    {
        "title": "hawaiian",
        "value": "haw"
    },
    {
        "title": "hebrew",
        "value": "he"
    },
    {
        "title": "hmong",
        "value": "hmn"
    },
    {
        "title": "hungarian",
        "value": "hu"
    },
    {
        "title": "icelandic",
        "value": "is"
    },
    {
        "title": "igbo",
        "value": "ig"
    },
    {
        "title": "ilocano",
        "value": "ilo"
    },
    {
        "title": "irish",
        "value": "ga"
    },
    {
        "title": "javanese",
        "value": "jv"
    },
    {
        "title": "kannada",
        "value": "kn"
    },
    {
        "title": "kazakh",
        "value": "kk"
    },
    {
        "title": "khmer",
        "value": "km"
    },
    {
        "title": "kinyarwanda",
        "value": "rw"
    },
    {
        "title": "kurdish",
        "value": "ku"
    },
    {
        "title": "kyrgyz",
        "value": "ky"
    },
    {
        "title": "lao",
        "value": "lo"
    },
    {
        "title": "latin",
        "value": "la"
    },
    {
        "title": "latvian",
        "value": "lv"
    },
    {
        "title": "lingala",
        "value": "ln"
    },
    {
        "title": "lithuanian",
        "value": "lt"
    },
    {
        "title": "luganda",
        "value": "lg"
    },
    {
        "title": "luxembourgish",
        "value": "lb"
    },
    {
        "title": "macedonian",
        "value": "mk"
    },
    {
        "title": "maithili",
        "value": "mai"
    },
    {
        "title": "malagasy",
        "value": "mg"
    },
    {
        "title": "malay",
        "value": "ms"
    },
    {
        "title": "malayalam",
        "value": "ml"
    },
    {
        "title": "maltese",
        "value": "mt"
    },
    {
        "title": "maori",
        "value": "mi"
    },
    {
        "title": "marathi",
        "value": "mr"
    },
    {
        "title": "mizo",
        "value": "lus"
    },
    {
        "title": "mongolian",
        "value": "mn"
    },
    {
        "title": "myanmar",
        "value": "my"
    },
    {
        "title": "nepali",
        "value": "ne"
    },
    {
        "title": "norwegian",
        "value": "no"
    },
    {
        "title": "nyanja",
        "value": "ny"
    },
    {
        "title": "odia",
        "value": "or"
    },
    {
        "title": "oromo",
        "value": "om"
    },
    {
        "title": "pashto",
        "value": "ps"
    },
    {
        "title": "persian",
        "value": "fa"
    },
    {
        "title": "polish",
        "value": "pl"
    },
    {
        "title": "punjabi",
        "value": "pa"
    },
    {
        "title": "quechua",
        "value": "qu"
    },
    {
        "title": "romanian",
        "value": "ro"
    },
    {
        "title": "samoan",
        "value": "sm"
    },
    {
        "title": "sanskrit",
        "value": "sa"
    },
    {
        "title": "scotsGaelic",
        "value": "gd"
    },
    {
        "title": "sepedi",
        "value": "nso"
    },
    {
        "title": "serbian",
        "value": "sr"
    },
    {
        "title": "sesotho",
        "value": "st"
    },
    {
        "title": "shona",
        "value": "sn"
    },
    {
        "title": "sindhi",
        "value": "sd"
    },
    {
        "title": "sinhala",
        "value": "si"
    },
    {
        "title": "slovak",
        "value": "sk"
    },
    {
        "title": "slovenian",
        "value": "sl"
    },
    {
        "title": "somali",
        "value": "so"
    },
    {
        "title": "sundanese",
        "value": "su"
    },
    {
        "title": "swahili",
        "value": "sw"
    },
    {
        "title": "swedish",
        "value": "sv"
    },
    {
        "title": "tagalog",
        "value": "tl"
    },
    {
        "title": "tajik",
        "value": "tg"
    },
    {
        "title": "tamil",
        "value": "ta"
    },
    {
        "title": "tatar",
        "value": "tt"
    },
    {
        "title": "telugu",
        "value": "te"
    },
    {
        "title": "thai",
        "value": "th"
    },
    {
        "title": "tigrinya",
        "value": "ti"
    },
    {
        "title": "turkish",
        "value": "tr"
    },
    {
        "title": "turkmen",
        "value": "tk"
    },
    {
        "title": "twi",
        "value": "ak"
    },
    {
        "title": "ukrainian",
        "value": "uk"
    },
    {
        "title": "urdu",
        "value": "ur"
    },
    {
        "title": "uyghur",
        "value": "ug"
    },
    {
        "title": "uzbek",
        "value": "uz"
    },
    {
        "title": "vietnamese",
        "value": "vi"
    },
    {
        "title": "welsh",
        "value": "cy"
    },
    {
        "title": "xhosa",
        "value": "xh"
    },
    {
        "title": "yiddish",
        "value": "yi"
    },
    {
        "title": "yoruba",
        "value": "yo"
    },
    {
        "title": "zulu",
        "value": "zu"
    }
]

// Translation service
export enum TRANS_SERVICE {
    MICROSOFT = 'microsoft',
    GOOGLE = 'google',
    DEEPL = 'deepl',
    YANDEX = 'yandex',
    YOUDAO = 'youdao',
    TENCENT = 'tencent',
    ALI = 'ali',
    PAPAGO = 'papago',
    WATSON = 'watson',
    BAIDU = 'baidu',
    DEFAULT = 'default',
}

// translation action
export enum TRANS_ACTION {
    DOUBLE = 'doubleTranslate',
    SINGLE = 'singleTranslate',
    TOGGLE = 'toggleTranslate',
    ORIGIN = 'showOrigin',
}

export enum ACTION {
    STYLE_CHANGE = 'styleChange',
    DOMAIN_STRATEGY_CHANGE = 'domainStrategyChange',
    TOGGLE_SELECTION_MODE = 'toggleSelectionMode',
    TRANSLATE_CHANGE = 'translateChange',
    LEAVE_SELECTION_MODE = 'leaveSelectionMode',
}

export enum CONFIG_KEY {
    DOMAIN_STRATEGY = 'domainStrategy',
    VIEW_STRATEGY = 'viewStrategy',
    TARGET_LANG = 'targetLanguage',
    SOURCE_LANG = 'sourceLanguage',
    STYLE = 'style',
    BG_COLOR = 'bgColor',
    FONT_COLOR = 'fontColor',
    PADDING = 'padding',
    BG_COLOR_INDEX = 'bgColorIndex',
    FONT_COLOR_INDEX = 'fontColorIndex',
    ORIGINAL_BG_COLOR = 'originalBgColor',
    ORIGINAL_BG_COLOR_INDEX = 'originalBgColorIndex',
    TRANSLATION_BG_COLOR = 'translationBgColor',
    TRANSLATION_BG_COLOR_INDEX = 'translationBgColorIndex',
    BILINGUAL_HIGHLIGHTING_SWITCH = 'bilingualHighlightingSwitch',
    GLOBAL_SWITCH = 'globalSwitch',
    TARGET_LANGUAGE = 'targetLanguage',
    TRANSLATE_SERVICE = 'translateService',
    MICROSOFT_TOKEN = 'microsoftToken',
}

