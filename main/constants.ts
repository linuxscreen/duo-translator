// UI metadata for a translate service shown in settings/popup. Not the runtime
// translation client — for that see TranslateService in entrypoints/translateService.ts.
export class TranslateServiceMeta {
    name: string;
    value: string;
    title: string;
    description: string;
    editable: boolean
    api: string | undefined;
    token: string | undefined;
    constructor(name: string, value: string, title: string, description: string, editable?: boolean, api?: string | undefined, token?: string | undefined) {
        this.value = value;
        this.name = name;
        this.title = title
        this.description = description;
        this.editable = editable === undefined ? true : editable;
        this.api = api;
        this.token = token;
    }
}

export const APP_NAME = 'DuoTranslator';
export const APP_NAME_WITH_SUFFIX = APP_NAME + ' - ';

export const STATUS_SUCCESS = '200';
export const STATUS_FAIL = '500';

export const TRANSLATE_STATUS_KEY = 'tabTranslateStatus#'

export const DEFAULT_VALUE = {
    GLOBAL_SWITCH: true,
    BILINGUAL_HIGHLIGHTING_SWITCH: true,
    FLOAT_BALL_SWITCH: true,
    CONTEXT_MENU_SWITCH: true,
    VIEW_STRATEGY: 'double',
    TARGET_LANG: 'en',
    TRANSLATE_SERVICE: 'microsoft',
    TRANSLATE_SERVICE_TITLE: 'microsoftTranslator',
    AI_WRITING_DOT_SWITCH: true,
    AI_TARGET_LANG: 'en',
    AI_DEFAULT_ENHANCE_MODE: 'polish',
    AI_DOT_TRANSLATE_SERVICE: 'microsoft',
    AI_USE_FOR_TRANSLATE_PAGE: true,
    BILINGUAL_HIGHLIGHTING_MIN_SENTENCES: 2,
    DOMAIN_STRATEGY: 'auto',
    TRANSLATION_LINE_BREAK_MIN_CHARS: 40,
    HIGHLIGHT_STYLE: 'underLine',
    HIGHLIGHT_BORDER_COLOR: '#df5f47',
    HIGHLIGHT_BORDER_COLOR_INDEX: 1
} as const;

export enum DB_ACTION {
    RULES_ADD = 'addRule',
    RULES_DEL = 'deleteRule',
    RULES_GET_ALL = 'getAllRule',
    RULES_LIST = 'listRule',
    RULES_SEARCH = 'searchRule',
    DOMAIN_INSERT = 'insertDomain',
    DOMAIN_UPDATE = 'updateDomain',
    DOMAIN_GET = 'getDomain',
    DOMAIN_DELETE = 'deleteDomain',
    DOMAIN_LIST = 'listDomain',
    CONFIG_GET = 'getConfig',
    CONFIG_SET = 'setConfig',
    BACKUP_EXPORT = 'backupExport',
    BACKUP_IMPORT = 'backupImport',
}

export enum SYNC_ACTION {
    SYNC_NOW = 'syncNow',
    SYNC_STATUS = 'syncStatus',
    AUTH_GDRIVE = 'authGdrive',
    AUTH_WEBDAV = 'authWebdav',
    DISCONNECT_PROVIDER = 'disconnectProvider',
    SET_ACTIVE_PROVIDER = 'setActiveProvider',
    GET_ACTIVE_PROVIDER = 'getActiveProvider',
}

export enum SYNC_PROVIDER_ID {
    GDRIVE = 'gdrive',
    WEBDAV = 'webdav',
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

export enum ELEMENT_STATUS {
    ORIGINAL,
    PENDING,
    TRANSLATED,
}

export enum DOMAIN_STRATEGY {
    NEVER = 'never',
    ALWAYS = 'always',
    AUTO = 'auto',
    ASK = 'ask',
}

export enum DEFAULT_STRATEGY {
    NEVER = 'never',
    ALWAYS = 'always',
    AUTO = 'auto',
}

export enum VIEW_STRATEGY {
    DOUBLE = 'double',
    SINGLE = 'single',
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
    DEEPL = 'deepl',
}

export const TRANSLATE_SERVICES: Map<string, TranslateServiceMeta> = new Map([
    ["microsoft", new TranslateServiceMeta("Microsoft", "microsoft", "microsoftTranslator", "MicrosoftTranslateDescription", false)],
    ["google", new TranslateServiceMeta("Google", "google", "googleTranslator", "GoogleTranslateDescription", false)],
    ["deepl", new TranslateServiceMeta("DeepL", "deepl", "deeplTranslator", "DeeplTranslateDescription", true)],
]);

// translation action
export enum TRANS_ACTION {
    TRANSLATE = 'translate',
    DOUBLE = 'doubleTranslate',
    SINGLE = 'singleTranslate',
    TOGGLE = 'toggleTranslate',
    SHOW_ORIGINAL = 'showOriginal',
    TRANSLATE_STATUS_CHANGE = "translateStatusChange",
    TRANSLATE_TEXT_BOX = 'translateTextBox',
    TRANSLATE_PARA = 'translatePara',
    SHOW_ORIGINAL_PARA = 'showOriginalPara',
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
    AI_OPEN_WORKBENCH = 'aiOpenWorkbench',
    AI_PROVIDER_TEST = 'aiProviderTest',
    OPEN_OPTIONS_PAGE = 'openOptionsPage',
    // Broadcast from Options when the user picks a UI language. Background
    // listens to update context menu; other extension UIs listen to swap i18n.
    INTERFACE_LANG_CHANGE = 'interfaceLangChange',
    SHOW_TRANSLATE_RESTORE_PARA_MENU = 'showTranslateRestoreParaMenu',
    HIDE_TRANSLATE_RESTORE_PARA_MENU = 'hideTranslateRestoreParaMenu',
}

/**
 * Long-lived port names used for streaming background <-> content traffic.
 * For OpenAI-compatible SSE we tunnel deltas over a runtime port instead of
 * one-shot sendMessage so the content side can consume with `for await`.
 */
export enum PORT_NAME {
    AI_CHAT_STREAM = 'aiChatStream',
    // Page-translation request to an AI provider. Port-based (not sendMessage)
    // so the content script can disconnect to abort the in-flight fetch in
    // background — `runtime.sendMessage` has no native cancellation path.
    AI_TRANSLATE = 'aiTranslate',
}

/** What the AI writing pipeline is being asked to do. */
export enum AI_TASK {
    TRANSLATE = 'translate',
    GRAMMAR = 'grammar',
    POLISH = 'polish',
    FORMAL = 'formal',
    CASUAL = 'casual',
    CUSTOM = 'custom',
    /** Page-translation: AI receives a JSON-stringified array of paragraph
     *  texts (with <bN> placeholder tags) and must return a JSON array of the
     *  same length with translations preserving the placeholders. */
    PAGE_TRANSLATE = 'pageTranslate',
}

export enum CONFIG_KEY {
    DEFAULT_STRATEGY = 'defaultStrategy',
    VIEW_STRATEGY = 'viewStrategy',
    TARGET_LANG = 'targetLanguage',
    SOURCE_LANG = 'sourceLanguage',
    STYLE = 'style',
    BG_COLOR = 'bgColor',
    FONT_COLOR = 'fontColor',
    BORDER_COLOR = 'borderColor',
    PADDING = 'padding',
    BG_COLOR_INDEX = 'bgColorIndex',
    FONT_COLOR_INDEX = 'fontColorIndex',
    BORDER_COLOR_INDEX = 'borderColorIndex',
    // Bilingual highlighting style (used for both original + translation hover).
    HIGHLIGHT_BG_COLOR = 'highlightBgColor',
    HIGHLIGHT_BG_COLOR_INDEX = 'highlightBgColorIndex',
    HIGHLIGHT_FONT_COLOR = 'highlightFontColor',
    HIGHLIGHT_FONT_COLOR_INDEX = 'highlightFontColorIndex',
    HIGHLIGHT_STYLE = 'highlightStyle',
    HIGHLIGHT_BORDER_COLOR = 'highlightBorderColor',
    HIGHLIGHT_BORDER_COLOR_INDEX = 'highlightBorderColorIndex',
    BILINGUAL_HIGHLIGHTING_SWITCH = 'bilingualHighlightingSwitch',
    // Minimum number of sentences in a paragraph for sentence-by-sentence
    // highlighting to apply. Paragraphs with fewer sentences are skipped.
    BILINGUAL_HIGHLIGHTING_MIN_SENTENCES = 'bilingualHighlightingMinSentences',
    // Minimum character count of a translated paragraph for a line-break
    // divider to be inserted between the original and translation. 0 means
    // always break (the divider is always a <br>).
    TRANSLATION_LINE_BREAK_MIN_CHARS = 'translationLineBreakMinChars',
    GLOBAL_SWITCH = 'globalSwitch',
    TARGET_LANGUAGE = 'targetLanguage',
    TRANSLATE_SERVICE = 'translateService',
    MICROSOFT_TOKEN = 'microsoftToken',
    FLOAT_BALL_POSITION = 'floatBallPosition',
    FLOAT_BALL_SWITCH = 'floatBallSwitch',
    CONTEXT_MENU_SWITCH = 'contextMenuSwitch',
    DISABLED_TRANSLATE_SERVICE = 'disabledTranslateService',
    // AI Writing
    AI_WRITING_DOT_SWITCH = 'aiWritingDotSwitch',
    AI_PROVIDERS = 'aiProviders',
    AI_ACTIVE_PROVIDER_ID = 'aiActiveProviderId',
    AI_TARGET_LANG = 'aiTargetLang',
    // When true, the floating dot only mounts on domains explicitly added to
    // the enabled list (DomainStorage.aiWritingEnabled). When false (default),
    // it mounts everywhere except domains on the disabled list.
    AI_WRITING_WHITELIST_MODE = 'aiWritingWhitelistMode',
    AI_DEFAULT_ENHANCE_MODE = 'aiDefaultEnhanceMode',
    // Per-task service selection for the floating dot.
    // AI_DOT_TRANSLATE_SERVICE: either a TRANS_SERVICE value ('microsoft' |
    // 'google' | 'deepl') or `ai:<providerId>` to route translate through an
    // AI provider. Default: 'microsoft'.
    AI_DOT_TRANSLATE_SERVICE = 'aiDotTranslateService',
    // AI_DOT_ENHANCE_PROVIDER_ID: which AI provider Better-Writing uses.
    // Falls back to AI_ACTIVE_PROVIDER_ID when unset.
    AI_DOT_ENHANCE_PROVIDER_ID = 'aiDotEnhanceProviderId',
    // UI language override for popup/options/context menu. Empty/undefined
    // means "auto-detect from browser UI language".
    INTERFACE_LANG = 'interfaceLang',
    // When enabled, configured AI providers also surface as page-translation
    // services (in the popup/options Translation Service picker). Off ⇒ AI
    // providers are only usable inside the AI Writing flows.
    AI_USE_FOR_TRANSLATE_PAGE = 'aiUseForTranslatePage',
}

// CONFIG_KEY value -> enum key name. Lets us look up a default for any config
// key whose enum-key name also exists on DEFAULT_VALUE (e.g. CONFIG_KEY.GLOBAL_SWITCH
// = 'globalSwitch' → 'GLOBAL_SWITCH' → DEFAULT_VALUE.GLOBAL_SWITCH).
export const CONFIG_VALUE_TO_KEY: Record<string, string> = Object.fromEntries(
    Object.entries(CONFIG_KEY).map(([k, v]) => [v as string, k])
);

export type InterfaceLang = 'en' | 'zh-CN';

export const INTERFACE_LANGUAGES: { value: InterfaceLang; title: string }[] = [
    { value: 'en', title: 'English' },
    { value: 'zh-CN', title: '简体中文' },
];

export const LANGUAGES = [
    {
        "name": "Simplified Chinese",
        "title": "simplifiedChinese",
        "value": "zh-CN"
    },
    {
        "name": "Traditional Chinese",
        "title": "traditionalChinese",
        "value": "zh-TW"
    },
    {
        "name": "English",
        "title": "english",
        "value": "en"
    },
    {
        "name": "French",
        "title": "french",
        "value": "fr"
    },
    {
        "name": "Russian",
        "title": "russian",
        "value": "ru"
    },
    {
        "name": "German",
        "title": "german",
        "value": "de"
    },
    {
        "name": "Japanese",
        "title": "japanese",
        "value": "ja"
    },
    {
        "name": "Italian",
        "title": "italian",
        "value": "it"
    },
    {
        "name": "Spanish",
        "title": "spanish",
        "value": "es"
    },
    {
        "name": "Korean",
        "title": "korean",
        "value": "ko"
    },
    {
        "name": "Portuguese",
        "title": "portuguese",
        "value": "pt"
    },
    {
        "name": "Indonesian",
        "title": "indonesian",
        "value": "id"
    },
    {
        "name": "Arabic",
        "title": "arabic",
        "value": "ar"
    },
    {
        "name": "Bengali",
        "title": "bengali",
        "value": "bn"
    },
    {
        "name": "Hindi",
        "title": "hindi",
        "value": "hi"
    },
    {
        "name": "Afrikaans",
        "title": "afrikaans",
        "value": "af"
    },
    {
        "name": "Albanian",
        "title": "albanian",
        "value": "sq"
    },
    {
        "name": "Amharic",
        "title": "amharic",
        "value": "am"
    },
    {
        "name": "Armenian",
        "title": "armenian",
        "value": "hy"
    },
    {
        "name": "Assamese",
        "title": "assamese",
        "value": "as"
    },
    {
        "name": "Aymara",
        "title": "aymara",
        "value": "ay"
    },
    {
        "name": "Azerbaijani",
        "title": "azerbaijani",
        "value": "az"
    },
    {
        "name": "Bambara",
        "title": "bambara",
        "value": "bm"
    },
    {
        "name": "Basque",
        "title": "basque",
        "value": "eu"
    },
    {
        "name": "Belarusian",
        "title": "belarusian",
        "value": "be"
    },
    {
        "name": "Bhojpuri",
        "title": "bhojpuri",
        "value": "bho"
    },
    {
        "name": "Bosnian",
        "title": "bosnian",
        "value": "bs"
    },
    {
        "name": "Bulgarian",
        "title": "bulgarian",
        "value": "bg"
    },
    {
        "name": "Catalan",
        "title": "catalan",
        "value": "ca"
    },
    {
        "name": "Cebuano",
        "title": "cebuano",
        "value": "ceb"
    },
    {
        "name": "Corsican",
        "title": "corsican",
        "value": "co"
    },
    {
        "name": "Croatian",
        "title": "croatian",
        "value": "hr"
    },
    {
        "name": "Czech",
        "title": "czech",
        "value": "cs"
    },
    {
        "name": "Danish",
        "title": "danish",
        "value": "da"
    },
    {
        "name": "Divehi",
        "title": "divehi",
        "value": "dv"
    },
    {
        "name": "Dogri",
        "title": "dogri",
        "value": "doi"
    },
    {
        "name": "Dutch",
        "title": "dutch",
        "value": "nl"
    },
    {
        "name": "Esperanto",
        "title": "esperanto",
        "value": "eo"
    },
    {
        "name": "Estonian",
        "title": "estonian",
        "value": "et"
    },
    {
        "name": "Filipino",
        "title": "filipino",
        "value": "fil"
    },
    {
        "name": "Finnish",
        "title": "finnish",
        "value": "fi"
    },
    {
        "name": "Frisian",
        "title": "frisian",
        "value": "fy"
    },
    {
        "name": "Galician",
        "title": "galician",
        "value": "gl"
    },
    {
        "name": "Georgian",
        "title": "georgian",
        "value": "ka"
    },
    {
        "name": "Greek",
        "title": "greek",
        "value": "el"
    },
    {
        "name": "Guarani",
        "title": "guarani",
        "value": "gn"
    },
    {
        "name": "Gujarati",
        "title": "gujarati",
        "value": "gu"
    },
    {
        "name": "Haitian Creole",
        "title": "haitianCreole",
        "value": "ht"
    },
    {
        "name": "Hawaiian",
        "title": "hawaiian",
        "value": "haw"
    },
    {
        "name": "Hebrew",
        "title": "hebrew",
        "value": "he"
    },
    {
        "name": "Hmong",
        "title": "hmong",
        "value": "hmn"
    },
    {
        "name": "Hungarian",
        "title": "hungarian",
        "value": "hu"
    },
    {
        "name": "Icelandic",
        "title": "icelandic",
        "value": "is"
    },
    {
        "name": "Igbo",
        "title": "igbo",
        "value": "ig"
    },
    {
        "name": "Ilocano",
        "title": "ilocano",
        "value": "ilo"
    },
    {
        "name": "Irish",
        "title": "irish",
        "value": "ga"
    },
    {
        "name": "Javanese",
        "title": "javanese",
        "value": "jv"
    },
    {
        "name": "Kannada",
        "title": "kannada",
        "value": "kn"
    },
    {
        "name": "Kazakh",
        "title": "kazakh",
        "value": "kk"
    },
    {
        "name": "Khmer",
        "title": "khmer",
        "value": "km"
    },
    {
        "name": "Kinyarwanda",
        "title": "kinyarwanda",
        "value": "rw"
    },
    {
        "name": "Kurdish",
        "title": "kurdish",
        "value": "ku"
    },
    {
        "name": "Kyrgyz",
        "title": "kyrgyz",
        "value": "ky"
    },
    {
        "name": "Lao",
        "title": "lao",
        "value": "lo"
    },
    {
        "name": "Latin",
        "title": "latin",
        "value": "la"
    },
    {
        "name": "Latvian",
        "title": "latvian",
        "value": "lv"
    },
    {
        "name": "Lingala",
        "title": "lingala",
        "value": "ln"
    },
    {
        "name": "Lithuanian",
        "title": "lithuanian",
        "value": "lt"
    },
    {
        "name": "Luganda",
        "title": "luganda",
        "value": "lg"
    },
    {
        "name": "Luxembourgish",
        "title": "luxembourgish",
        "value": "lb"
    },
    {
        "name": "Macedonian",
        "title": "macedonian",
        "value": "mk"
    },
    {
        "name": "Maithili",
        "title": "maithili",
        "value": "mai"
    },
    {
        "name": "Malagasy",
        "title": "malagasy",
        "value": "mg"
    },
    {
        "name": "Malay",
        "title": "malay",
        "value": "ms"
    },
    {
        "name": "Malayalam",
        "title": "malayalam",
        "value": "ml"
    },
    {
        "name": "Maltese",
        "title": "maltese",
        "value": "mt"
    },
    {
        "name": "Maori",
        "title": "maori",
        "value": "mi"
    },
    {
        "name": "Marathi",
        "title": "marathi",
        "value": "mr"
    },
    {
        "name": "Mizo",
        "title": "mizo",
        "value": "lus"
    },
    {
        "name": "Mongolian",
        "title": "mongolian",
        "value": "mn"
    },
    {
        "name": "Myanmar",
        "title": "myanmar",
        "value": "my"
    },
    {
        "name": "Nepali",
        "title": "nepali",
        "value": "ne"
    },
    {
        "name": "Norwegian",
        "title": "norwegian",
        "value": "no"
    },
    {
        "name": "Nyanja",
        "title": "nyanja",
        "value": "ny"
    },
    {
        "name": "Odia",
        "title": "odia",
        "value": "or"
    },
    {
        "name": "Oromo",
        "title": "oromo",
        "value": "om"
    },
    {
        "name": "Pashto",
        "title": "pashto",
        "value": "ps"
    },
    {
        "name": "Persian",
        "title": "persian",
        "value": "fa"
    },
    {
        "name": "Polish",
        "title": "polish",
        "value": "pl"
    },
    {
        "name": "Punjabi",
        "title": "punjabi",
        "value": "pa"
    },
    {
        "name": "Quechua",
        "title": "quechua",
        "value": "qu"
    },
    {
        "name": "Romanian",
        "title": "romanian",
        "value": "ro"
    },
    {
        "name": "Samoan",
        "title": "samoan",
        "value": "sm"
    },
    {
        "name": "Sanskrit",
        "title": "sanskrit",
        "value": "sa"
    },
    {
        "name": "Scots Gaelic",
        "title": "scotsGaelic",
        "value": "gd"
    },
    {
        "name": "Sepedi",
        "title": "sepedi",
        "value": "nso"
    },
    {
        "name": "Serbian",
        "title": "serbian",
        "value": "sr"
    },
    {
        "name": "Sesotho",
        "title": "sesotho",
        "value": "st"
    },
    {
        "name": "Shona",
        "title": "shona",
        "value": "sn"
    },
    {
        "name": "Sindhi",
        "title": "sindhi",
        "value": "sd"
    },
    {
        "name": "Sinhala",
        "title": "sinhala",
        "value": "si"
    },
    {
        "name": "Slovak",
        "title": "slovak",
        "value": "sk"
    },
    {
        "name": "Slovenian",
        "title": "slovenian",
        "value": "sl"
    },
    {
        "name": "Somali",
        "title": "somali",
        "value": "so"
    },
    {
        "name": "Sundanese",
        "title": "sundanese",
        "value": "su"
    },
    {
        "name": "Swahili",
        "title": "swahili",
        "value": "sw"
    },
    {
        "name": "Swedish",
        "title": "swedish",
        "value": "sv"
    },
    {
        "name": "Tagalog",
        "title": "tagalog",
        "value": "tl"
    },
    {
        "name": "Tajik",
        "title": "tajik",
        "value": "tg"
    },
    {
        "name": "Tamil",
        "title": "tamil",
        "value": "ta"
    },
    {
        "name": "Tatar",
        "title": "tatar",
        "value": "tt"
    },
    {
        "name": "Telugu",
        "title": "telugu",
        "value": "te"
    },
    {
        "name": "Thai",
        "title": "thai",
        "value": "th"
    },
    {
        "name": "Tigrinya",
        "title": "tigrinya",
        "value": "ti"
    },
    {
        "name": "Turkish",
        "title": "turkish",
        "value": "tr"
    },
    {
        "name": "Turkmen",
        "title": "turkmen",
        "value": "tk"
    },
    {
        "name": "Twi",
        "title": "twi",
        "value": "ak"
    },
    {
        "name": "Ukrainian",
        "title": "ukrainian",
        "value": "uk"
    },
    {
        "name": "Urdu",
        "title": "urdu",
        "value": "ur"
    },
    {
        "name": "Uyghur",
        "title": "uyghur",
        "value": "ug"
    },
    {
        "name": "Uzbek",
        "title": "uzbek",
        "value": "uz"
    },
    {
        "name": "Vietnamese",
        "title": "vietnamese",
        "value": "vi"
    },
    {
        "name": "Welsh",
        "title": "welsh",
        "value": "cy"
    },
    {
        "name": "Xhosa",
        "title": "xhosa",
        "value": "xh"
    },
    {
        "name": "Yiddish",
        "title": "yiddish",
        "value": "yi"
    },
    {
        "name": "Yoruba",
        "title": "yoruba",
        "value": "yo"
    },
    {
        "name": "Zulu",
        "title": "zulu",
        "value": "zu"
    }
]

export const LANGUAGES_MAP = new Map(LANGUAGES.map((lang) => [lang.value, lang]))

// Border / underline style preset used by translation style + bilingual highlighting.
// The value strings double as CSS class names in the popup demo so legacy code can match by id.
export const STYLE_NONE = 'noneStyleSelect';

export type TranslationStyleOption = { value: string; title: string };
// `groupTitle === null` renders the option(s) at the top level without a section header.
export type TranslationStyleGroup = { groupTitle: string | null; options: TranslationStyleOption[] };

export const STYLE_GROUPS: TranslationStyleGroup[] = [
    {
        groupTitle: null,
        options: [{ value: STYLE_NONE, title: 'none' }],
    },
    {
        groupTitle: 'bottom',
        options: [
            { value: 'wavyLine', title: 'wavyLine' },
            { value: 'doubleLine', title: 'doubleUnderline' },
            { value: 'underLine', title: 'underLine' },
            { value: 'dottedLine', title: 'dottedLine' },
            { value: 'dashedLine', title: 'dashedLine' },
        ],
    },
    {
        groupTitle: 'wrap',
        options: [
            { value: 'solidBorder', title: 'solidBorder' },
            { value: 'dottedBorder', title: 'dottedBorder' },
            { value: 'dashedBorder', title: 'dashedBorder' },
        ],
    },
];

// Preset color palettes. Empty string = "no color" (transparent slot rendered as a checker swatch).
export const TRANSLATION_BG_COLORS = ['', '#df5f47', '#57a0ee', '#faec63', '#73b364'];
export const TRANSLATION_FONT_COLORS = ['', '#df5f47', '#57a0ee', '#faec63', '#73b364'];
export const HIGHLIGHT_COLORS = ['', '#df5f47', '#57a0ee', '#faec63', '#73b364'];

export const VIEW_STRATEGIES = [
    {
        "title": "bilingual",
        "value": "double"
    },
    {
        "title": "translationOnly",
        "value": "single"
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
    // 'textarea', // todo
    "iron-a11y-announcer", // accessibility-labels
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
    "footer"
];

export const EXCLUDE_CHILD_ELEMENT_TAGS = new Set([
        'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', "IMAGE"]);

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

