export default defineUnlistedScript({
    main(): void | Promise<void> {
    }
})

export class TranslateService {
    name: string;
    value:string;
    title: string;
    description: string;
    editable :boolean
    api: string | undefined;
    token: string | undefined;
    constructor(name: string, value:string, title: string, description: string,editable? :boolean, api?: string|undefined, token?: string|undefined) {
        this.value = value;
        this.name = name;
        this.title = title
        this.description = description;
        if (editable === undefined) {
            this.editable = true;
        }else {
            this.editable = editable

        }
        this.api = api;
        this.token = token;
    }
}

export const STATUS_SUCCESS = '200';
export const STATUS_FAIL = '500';

export const TRANSLATE_STATUS_KEY = 'tabTranslateStatus#'

export enum DEFAULT_VALUE {
    GLOBAL_SWITCH = 1,
    BILINGUAL_HIGHLIGHTING_SWITCH = 0,
    FLOAT_BALL_SWITCH = 1,
    CONTEXT_MENU_SWITCH = 1,
    VIEW_STRATEGY = 'double',
    TARGET_LANG = 'zh-CN',
    TRANSLATE_SERVICE = 'microsoft',
    TRANSLATE_SERVICE_TITLE = 'microsoftTranslator',
}

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
    LANG_GET = 'getTabLanguage',
    TAB_DOMAIN_GET = 'getTabDomain',
    ID_GET = 'getTabId',
    CONTEXT_MENU_SHOW = 'showContextMenu',
    CONTEXT_MENU_SWITCH = 'contextMenuSwitch',
    FLOAT_BALL_SWITCH = "floatBallSwitch",
    NATIVE_LANGUAGE_GET = "getNativeLanguage",

}

export enum DOMAIN_STRATEGY {
    NEVER = 'never',
    ALWAYS = 'always',
    AUTO = 'auto',
    ASK = 'ask',
}

export enum VIEW_STRATEGY {
    DOUBLE = 'double',
    SINGLE = 'single',
    BUTTON = 'button',
}

export enum COMMON {
    ENABLE = 'enable',
    DISABLE = 'disable',
    AUTO = 'auto',
}

// Translation service
export enum TRANS_SERVICE {
    MICROSOFT = 'microsoft',
    GOOGLE = 'google',
}

export const TRANSLATE_SERVICES: Map<string, TranslateService> = new Map([
    ["microsoft", new TranslateService("Microsoft","microsoft", "microsoftTranslator","MicrosoftTranslateDescription",false)],
    ["google", new TranslateService("Google","google", "googleTranslator", "GoogleTranslateDescription",false)],
]);

// translation action
export enum TRANS_ACTION {
    TRANSLATE = 'translate',
    DOUBLE = 'doubleTranslate',
    SINGLE = 'singleTranslate',
    TOGGLE = 'toggleTranslate',
    ORIGIN = 'showOrigin',
    TRANSLATE_STATUS_CHANGE = "translateStatusChange",
}

export enum ACTION {
    ACCESS_TOKEN_GET = 'getAccessToken',
    TRANSLATE_HTML = 'translateHtml',
    STYLE_CHANGE = 'styleChange',
    DOMAIN_STRATEGY_CHANGE = 'domainStrategyChange',
    DEFAULT_STRATEGY_CHANGE = 'defaultStrategyChange',
    GLOBAL_SWITCH_CHANGE = 'globalSwitchChange',
    VIEW_STRATEGY_CHANGE = 'viewStrategyChange',
    TARGET_LANG_CHANGE = 'targetLangChange',
    TOGGLE_SELECTION_MODE = 'toggleSelectionMode',
    TRANSLATE_SERVICE_CHANGE = 'translateChange',
    LEAVE_SELECTION_MODE = 'leaveSelectionMode',
}

export enum CONFIG_KEY {
    DEFAULT_STRATEGY = 'defaultStrategy',
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
    FLOAT_BALL_POSITION = 'floatBallPosition',
    FLOAT_BALL_SWITCH = 'floatBallSwitch',
    CONTEXT_MENU_SWITCH = 'contextMenuSwitch',
    DISABLED_TRANSLATE_SERVICE = 'disabledTranslateService',
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

// export const TRANSLATE_SERVICES = [
//     {
//         "title": "microsoftTranslator",
//         "value": "microsoft"
//     },
//     {
//         "title": "googleTranslator",
//         "value": "google"
//     },
// ]

export const VIEW_STRATEGIES = [
    {
        "title": "monolingual",
        "value": "single"
    },
    {
        "title": "bilingual",
        "value": "double"
    },
    
]

export const iso6393To1 = {
    aar: 'aa',
    abk: 'ab',
    afr: 'af',
    aka: 'ak',
    amh: 'am',
    ara: 'ar',
    arg: 'an',
    asm: 'as',
    ava: 'av',
    ave: 'ae',
    aym: 'ay',
    aze: 'az',
    bak: 'ba',
    bam: 'bm',
    bel: 'be',
    ben: 'bn',
    bis: 'bi',
    bod: 'bo',
    bos: 'bs',
    bre: 'br',
    bul: 'bg',
    cat: 'ca',
    ces: 'cs',
    cha: 'ch',
    che: 'ce',
    chu: 'cu',
    chv: 'cv',
    cor: 'kw',
    cos: 'co',
    cre: 'cr',
    cym: 'cy',
    dan: 'da',
    deu: 'de',
    div: 'dv',
    dzo: 'dz',
    ell: 'el',
    eng: 'en',
    epo: 'eo',
    est: 'et',
    eus: 'eu',
    ewe: 'ee',
    fao: 'fo',
    fas: 'fa',
    fij: 'fj',
    fin: 'fi',
    fra: 'fr',
    fry: 'fy',
    ful: 'ff',
    gla: 'gd',
    gle: 'ga',
    glg: 'gl',
    glv: 'gv',
    grn: 'gn',
    guj: 'gu',
    hat: 'ht',
    hau: 'ha',
    hbs: 'sh',
    heb: 'he',
    her: 'hz',
    hin: 'hi',
    hmo: 'ho',
    hrv: 'hr',
    hun: 'hu',
    hye: 'hy',
    ibo: 'ig',
    ido: 'io',
    iii: 'ii',
    iku: 'iu',
    ile: 'ie',
    ina: 'ia',
    ind: 'id',
    ipk: 'ik',
    isl: 'is',
    ita: 'it',
    jav: 'jv',
    jpn: 'ja',
    kal: 'kl',
    kan: 'kn',
    kas: 'ks',
    kat: 'ka',
    kau: 'kr',
    kaz: 'kk',
    khm: 'km',
    kik: 'ki',
    kin: 'rw',
    kir: 'ky',
    kom: 'kv',
    kon: 'kg',
    kor: 'ko',
    kua: 'kj',
    kur: 'ku',
    lao: 'lo',
    lat: 'la',
    lav: 'lv',
    lim: 'li',
    lin: 'ln',
    lit: 'lt',
    ltz: 'lb',
    lub: 'lu',
    lug: 'lg',
    mah: 'mh',
    mal: 'ml',
    mar: 'mr',
    mkd: 'mk',
    mlg: 'mg',
    mlt: 'mt',
    mon: 'mn',
    mri: 'mi',
    msa: 'ms',
    mya: 'my',
    nau: 'na',
    nav: 'nv',
    nbl: 'nr',
    nde: 'nd',
    ndo: 'ng',
    nep: 'ne',
    nld: 'nl',
    nno: 'nn',
    nob: 'nb',
    nor: 'no',
    nya: 'ny',
    oci: 'oc',
    oji: 'oj',
    ori: 'or',
    orm: 'om',
    oss: 'os',
    pan: 'pa',
    pli: 'pi',
    pol: 'pl',
    por: 'pt',
    pus: 'ps',
    que: 'qu',
    roh: 'rm',
    ron: 'ro',
    run: 'rn',
    rus: 'ru',
    sag: 'sg',
    san: 'sa',
    sin: 'si',
    slk: 'sk',
    slv: 'sl',
    sme: 'se',
    smo: 'sm',
    sna: 'sn',
    snd: 'sd',
    som: 'so',
    sot: 'st',
    spa: 'es',
    sqi: 'sq',
    srd: 'sc',
    srp: 'sr',
    ssw: 'ss',
    sun: 'su',
    swa: 'sw',
    swe: 'sv',
    tah: 'ty',
    tam: 'ta',
    tat: 'tt',
    tel: 'te',
    tgk: 'tg',
    tgl: 'tl',
    tha: 'th',
    tir: 'ti',
    ton: 'to',
    tsn: 'tn',
    tso: 'ts',
    tuk: 'tk',
    tur: 'tr',
    twi: 'tw',
    uig: 'ug',
    ukr: 'uk',
    urd: 'ur',
    uzb: 'uz',
    ven: 've',
    vie: 'vi',
    vol: 'vo',
    wln: 'wa',
    wol: 'wo',
    xho: 'xh',
    yid: 'yi',
    yor: 'yo',
    zha: 'za',
    zho: 'zh',
    zul: 'zu'
}

export const EXCLUDE_TAGS = [
    'script',
    'style',
    'comment',
    'code',
    'noscript',
    'template',
    'meta',
    'link',
    'object',
    'svg',
    'audio',
    'video',
    'img',
    'progress',
    'meter',
    'summary',
    // 'textarea',
    "iron-a11y-announcer" // accessibility-labels
    // 'form',
    // 'datalist',
    // 'output',
    // 'details',
    // 'iframe',
    // 'input',
    // 'select',
    // 'option',
    // 'label',
    // 'button',
];

export const iso6393To1Map: Map<string, string> = new Map(Object.entries(iso6393To1));

export const excludedTagSet: Set<string> = new Set(EXCLUDE_TAGS)

export const svgAddCursor = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12 0C5.37259 0 0 5.37259 0 12C0 18.6274 5.37259 24 12 24C18.6274 24 24 18.6274 24 12C24 5.37259 18.6274 0 12 0Z" fill="white"/>
<path d="M12 0C5.37259 0 0 5.37259 0 12C0 18.6274 5.37259 24 12 24C18.6274 24 24 18.6274 24 12C24 5.37259 18.6274 0 12 0ZM17.7664 13.3668H13.377V17.7674C13.377 18.5248 12.7574 19.1445 12 19.1445C11.2426 19.1445 10.623 18.5248 10.623 17.7674V13.3668H6.23161C5.47423 13.3668 4.85456 12.7471 4.85456 11.9898C4.85456 11.2324 5.47423 10.6127 6.23161 10.6127H10.623V6.23266C10.623 5.47528 11.2426 4.85561 12 4.85561C12.7574 4.85561 13.377 5.47528 13.377 6.23266V10.6127H17.7664C18.5237 10.6127 19.1434 11.2324 19.1434 11.9898C19.1434 12.7471 18.5237 13.3668 17.7664 13.3668Z" fill="#48BE78"/>
</svg>`;

export const svgTrashCursor = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M21 3.99998H17.9C17.4215 1.67358 15.3751 0.003 13 0H10.9999C8.62483 0.003 6.57836 1.67358 6.09995 3.99998H2.99997C2.44769 3.99998 1.99998 4.44769 1.99998 4.99997C1.99998 5.55225 2.44769 6 2.99997 6H3.99995V19C4.00328 21.76 6.23992 23.9967 8.99997 24H15C17.76 23.9967 19.9967 21.76 20 19V6H21C21.5523 6 22 5.5523 22 5.00002C22 4.44773 21.5523 3.99998 21 3.99998Z" fill="white"/>
<path d="M21 3.99998H17.9C17.4215 1.67358 15.3751 0.003 13 0H11C8.62484 0.003 6.57837 1.67358 6.09997 3.99998H2.99998C2.4477 3.99998 2 4.44769 2 4.99997C2 5.55225 2.4477 6 2.99998 6H3.99997V19C4.0033 21.76 6.23994 23.9967 8.99998 24H15C17.76 23.9967 19.9967 21.76 20 19V6H21C21.5523 6 22 5.5523 22 5.00002C22 4.44773 21.5523 3.99998 21 3.99998ZM11 17C11 17.5523 10.5523 18 10 18C9.44769 18 8.99998 17.5523 8.99998 17V11C8.99998 10.4477 9.44769 10 9.99997 10C10.5522 10 11 10.4477 11 11V17H11ZM15 17C15 17.5523 14.5523 18 14 18C13.4477 18 13 17.5523 13 17V11C13 10.4477 13.4477 10 14 10C14.5523 10 15 10.4477 15 11V17ZM8.171 3.99998C8.59634 2.80228 9.72903 2.00152 11 1.99997H13C14.271 2.00152 15.4037 2.80228 15.829 3.99998H8.171Z" fill="#FF554A"/>
</svg>`

export const floatBallHtml = `<div class="duo-float-ball" id="duo-float-ball">
    <div class="duo-tool">
        <div class="duo-close-button">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M15.5051 4.58459L14.764 5.32621C15.6138 6.64036 15.9873 8.20617 15.8222 9.76241C15.6571 11.3187 14.9634 12.7712 13.8567 13.8778C12.7501 14.9844 11.2975 15.678 9.74122 15.8431C8.18497 16.0081 6.61919 15.6345 5.30508 14.7846L4.56399 15.5256C5.87389 16.4274 7.42728 16.909 9.01758 16.9065C13.3632 16.9065 16.8861 13.3837 16.8861 9.03818C16.8886 7.44788 16.4069 5.89449 15.5051 4.58459ZM15.3134 1.77385L14.076 3.01135C12.6603 1.81939 10.8683 1.16698 9.01758 1.16969C4.67192 1.16969 1.14909 4.6934 1.14909 9.03818C1.14638 10.8889 1.79879 12.6809 2.99075 14.0966L1.65815 15.4292L2.57081 16.3419L16.2262 2.68668L15.3134 1.77385ZM2.71442 11.7002C2.11848 10.2924 2.01131 8.72559 2.41003 7.24978C2.80875 5.77397 3.69037 4.47426 4.91417 3.55812C6.13796 2.64198 7.63339 2.16221 9.16176 2.19539C10.6901 2.22857 12.1633 2.77279 13.3462 3.74119L3.72059 13.3666C3.30705 12.8623 2.96819 12.301 2.71442 11.7002Z" fill="#BFBFBF"/>
            </svg>
        </div>

        <div data-layer="switch" class="duo-switch">
            <div data-layer="button" class="duo-button"></div>
        </div>

    </div>
    <div class="duo-tooltip"><p></p></div>
</div>`

export const floatBallStyle = `.duo-switch {
            display: flex;
            width: 50px;
            height: 30px;
            //position: absolute;
            background: #ED6C35;
            border-radius: 214px;
            transition: background 0.3s;
            opacity: 0.35;
        }
        .duo-switch.active {
            background: #23C965;
        }
        .duo-switch:hover {
            opacity: 1;
        }
        .duo-switch .duo-button {
            display: flex;
            flex-direction: row;
            width: 22px;
            height: 22px;
            margin-left: 2px;
            margin-top: 2px;
            //left: 2px;
            //top: 2px;
            position: absolute;
            background: #ECECEC;
            border-radius: 9999px;
            border: 2px white solid;
            transform: translateX(0); /* initial position */
            transition: transform 0.2s ease; /* add animation  */
        }
        .duo-switch.active .duo-button {
            left: auto;
            //right: 2px;
            transform: translateX(21px);
        }
        .duo-tooltip{
            display: flex;
            opacity: 0;
            //cursor: pointer;
            user-select: none; /* Prevent text selection */
            -webkit-user-select: none; /* For Safari */
            -moz-user-select: none; /* For Firefox */
            -ms-user-select: none; /* For Internet Explorer/Edge */
            //-webkit-user-select: none;
        }
        .duo-float-ball {
            display: flex;
            opacity: 0;
            flex-direction: row;
            align-items: center;
            //justify-content: center;
            position: fixed;
            // margin-top: 20px;
            // margin-left: 20px;
            z-index: 9999;
            //transform: translate(-50%, -50%);
        }
        .duo-tool {
            display: flex;
            flex-direction: row;
            align-items: center;
            //justify-content: center;
            position: relative;
        }
        .duo-close-button {
            display: flex;
            opacity: 0;
            margin-right: 5px;
        }`

