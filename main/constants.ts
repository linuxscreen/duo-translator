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

export const APP_NAME = import.meta.env.VITE_APP_NAME;
export const APP_NAME_WITH_SUFFIX = APP_NAME + ' - ';
export const APP_NAME_KEBAB_CASE = import.meta.env.VITE_APP_NAME_KEBAB_CASE;

export const STATUS_SUCCESS = '200';
export const STATUS_FAIL = '500';

export const TRANSLATE_STATUS_KEY = 'tabTranslateStatus#'

export const AI_PREFIX = "ai:";

export enum DB_ACTION {
    RULE_ADD = 'addRule',
    RULE_DEL = 'deleteRule',
    RULE_GET_ALL = 'getAllRule',
    RULE_LIST = 'listRule',
    RULE_SEARCH = 'searchRule',
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
    REMOTE_INFO = 'remoteInfo',
    REMOTE_DOWNLOAD = 'remoteDownload',
    REMOTE_DELETE = 'remoteDelete',
    // Options notifies background after toggling auto-sync / changing the
    // interval so the background can reschedule its alarms.
    AUTO_CONFIG_CHANGED = 'autoSyncConfigChanged',
    // Read the persisted WebDAV credentials back so the config form can be
    // pre-filled (the options page is part of the extension, so exposing the
    // locally-stored password to it is fine).
    WEBDAV_CONFIG_GET = 'webdavConfigGet',
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
    ["google", new TranslateServiceMeta("Google", "google", "googleTranslate", "GoogleTranslateDescription", false)],
    ["deepl", new TranslateServiceMeta("DeepL", "deepl", "deepl", "DeeplTranslateDescription", true)],
]);

export const DEFAULT_STRATEGY_OPTIONS: { value: DEFAULT_STRATEGY; title: string; fallback: string }[] = [
    { value: DEFAULT_STRATEGY.AUTO, title: 'automaticallyDetermine', fallback: 'Automatically determine' },
    { value: DEFAULT_STRATEGY.ALWAYS, title: 'translateAllWebsites', fallback: 'Translate all websites' },
    { value: DEFAULT_STRATEGY.NEVER, title: 'notTranslateAllWebsites', fallback: "Don't translate all websites" },
];

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
    TRANSLATE_SELECTION = 'translateSelection',
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
    // Test a built-in translation service (google/microsoft/deepl) from Options.
    TRANSLATE_SERVICE_TEST = 'translateServiceTest',
    // DeepL request proxy. DeepL's API has no CORS headers, so the content
    // script cannot fetch it directly — background performs the fetch and
    // returns the raw JSON payload. content reshapes it into TranslateResult[].
    DEEPL_REQUEST = 'deeplRequest',
    // One-shot (non-streaming) page-translation request to an AI provider.
    // Unlike PORT_NAME.AI_TRANSLATE (port-based, abortable), this uses a plain
    // sendMessage round-trip: background calls chatComplete and returns the
    // full translations array. Preferred for page translation where streaming
    // is unnecessary. The port path is kept as `streamTranslateText`.
    AI_TRANSLATE_TEXT = 'aiTranslateText',
    // Out-of-band cancellation for AI_TRANSLATE_TEXT. sendMessage has no native
    // abort, so content fires this with the same requestId on signal abort;
    // background aborts the in-flight fetch for that request.
    AI_TRANSLATE_ABORT = 'aiTranslateAbort',
    OPEN_OPTIONS_PAGE = 'openOptionsPage',
    // Open the toolbar action popup (popup.html) anchored to the extension
    // icon — same surface/position as a manual icon click. Requested from the
    // float ball's settings button; background calls chrome.action.openPopup().
    OPEN_POPUP = 'openPopup',
    // Broadcast from Options when the user picks a UI language. Background
    // listens to update context menu; other extension UIs listen to swap i18n.
    INTERFACE_LANG_CHANGE = 'interfaceLangChange',
    SHOW_TRANSLATE_RESTORE_PARA_MENU = 'showTranslateRestoreParaMenu',
    HIDE_TRANSLATE_RESTORE_PARA_MENU = 'hideTranslateRestoreParaMenu',
    // Persistent translation-result cache (LRU, IndexedDB in background).
    // GET: batch-lookup translations for (service, targetLang, texts[]).
    // PUT: batch-store freshly fetched translations.
    // CLEAR: wipe the whole cache (from the Options "clear cache" button).
    TRANSLATION_CACHE_GET = 'translationCacheGet',
    TRANSLATION_CACHE_PUT = 'translationCachePut',
    TRANSLATION_CACHE_CLEAR = 'translationCacheClear',
    // Current approximate cache size in bytes (for the Options "clear cache"
    // confirmation prompt).
    TRANSLATION_CACHE_SIZE = 'translationCacheSize',
    // Broadcast from Options when the cache switch toggles so content scripts
    // drop their memoized enabled-flag.
    TRANSLATION_CACHE_SWITCH_CHANGE = 'translationCacheSwitchChange',
    // Top-frame → sub-frames fan-out. The top-frame content script sends this to
    // background with `data` = an inner Message; background re-broadcasts that
    // inner message to every frame of the sender's tab. Used to drive iframe
    // translation on manual toggles / float-ball clicks, which the top frame
    // cannot deliver to cross-origin iframes itself.
    RELAY_FRAMES = 'relayFrames',
    UPDATE_ACTIVE_TRANSLATE_SERVICE = "updateActiveTranslateService",
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
    TARGET_LANGUAGE = 'targetLanguage',
    SOURCE_LANGUAGE = 'sourceLanguage',
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
    // Persistent translation-result cache toggle (LRU, 100MB cap). Default on.
    TRANSLATION_CACHE_SWITCH = 'translationCacheSwitch',
    GLOBAL_SWITCH = 'globalSwitch',
    TRANSLATE_SERVICE = 'translateService',
    MICROSOFT_TOKEN = 'microsoftToken',
    FLOAT_BALL_POSITION = 'floatBallPosition',
    FLOAT_BALL_SWITCH = 'floatBallSwitch',
    CONTEXT_MENU_SWITCH = 'contextMenuSwitch',
    DISABLED_TRANSLATE_SERVICES = 'disabledTranslateServices',
    // AI Writing
    AI_WRITING_SWITCH = 'aiWritingDotSwitch',
    AI_PROVIDERS = 'aiProviders',
    AI_ACTIVE_PROVIDER_ID = 'aiActiveProviderId', //which AI provider Better-Writing uses.
    AI_TARGET_LANGUAGE = 'aiTargetLanguage',
    // When true, the floating dot only mounts on domains explicitly added to
    // the enabled list (DomainStorage.aiWritingEnabled). When false (default),
    // it mounts everywhere except domains on the disabled list.
    AI_WRITING_WHITELIST_MODE = 'aiWritingWhitelistMode',
    AI_DEFAULT_ENHANCE_MODE = 'aiDefaultEnhanceMode',
    // Per-task service selection for the floating dot.
    // AI_TRANSLATE_SERVICE: either a TRANS_SERVICE value ('microsoft' |
    // 'google' | 'deepl') or `ai:<providerId>` to route translate through an
    // AI provider. Default: 'microsoft'.
    AI_TRANSLATE_SERVICE = 'aiTranslateService',
    // UI language override for popup/options/context menu. Empty/undefined
    // means "auto-detect from browser UI language".
    INTERFACE_LANGUAGE = 'interfaceLanguage',
    // When enabled, configured AI providers also surface as page-translation
    // services (in the popup/options Translation Service picker). Off ⇒ AI
    // providers are only usable inside the AI Writing flows.
    AI_USE_FOR_TRANSLATE_PAGE = 'aiUseForTranslatePage',
    // User-supplied DeepL API key (free-tier keys end with ":fx"). When empty,
    // DeepL translation is unavailable until configured in Options.
    DEEPL_API_KEY = 'deeplApiKey',
    // When true, cloud sync includes API keys (AI providers + DeepL) in the
    // synced snapshot. Off by default so secrets stay on-device unless the user
    // opts in. Separate from the per-export "include keys" checkbox.
    SYNC_INCLUDE_SECRETS = 'syncIncludeSecrets',
    // Automatic sync: when on, sync runs on startup, 30s-debounced after any
    // config change, and on a periodic alarm. Off by default. Per-device pref
    // (excluded from the synced snapshot).
    SYNC_AUTO = 'syncAuto',
    // Periodic auto-sync interval in minutes (5..60, default 15). Per-device.
    SYNC_INTERVAL_MINUTES = 'syncIntervalMinutes',
}

export const DEFAULT_VALUE = {
    GLOBAL_SWITCH: true,
    BILINGUAL_HIGHLIGHTING_SWITCH: true,
    FLOAT_BALL_SWITCH: true,
    CONTEXT_MENU_SWITCH: true,
    VIEW_STRATEGY: 'double',
    DEFAULT_STRATEGY: 'auto',
    AI_WRITING_SWITCH: true,
    AI_DEFAULT_ENHANCE_MODE: 'polish',
    AI_TRANSLATE_SERVICE: 'microsoft',
    AI_USE_FOR_TRANSLATE_PAGE: true,
    BILINGUAL_HIGHLIGHTING_MIN_SENTENCES: 2,
    DOMAIN_STRATEGY: 'auto',
    TRANSLATION_LINE_BREAK_MIN_CHARS: 40,
    TRANSLATION_CACHE_SWITCH: true,
    SYNC_INTERVAL_MINUTES: 15,
    HIGHLIGHT_STYLE: 'underLine',
    HIGHLIGHT_BORDER_COLOR: '#df5f47',
    HIGHLIGHT_BORDER_COLOR_INDEX: 1,
    DISABLED_TRANSLATE_SERVICES: ['deepl'],
    AI_TARGET_LANGUAGE: 'en',
} as const;

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
    // "footer"
];

export const EXCLUDE_CHILD_ELEMENT_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', "IMAGE"]);

export const iso6393To1Map: Map<string, string> = new Map(Object.entries(iso6393To1));

export const excludedTagSet: Set<string> = new Set(EXCLUDE_TAGS)

