// UI metadata for a translate service shown in settings/popup. Not the runtime
// translation client — for that see TranslateService in main/translateClient.ts.
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
export const APP_NAME_PASCAL_CASE = import.meta.env.VITE_APP_NAME_PASCAL_CASE;

export const STATUS_SUCCESS = '200';
export const STATUS_FAIL = '500';

export const TRANSLATE_STATUS_KEY = 'tabTranslateStatus#'

export const AI_PREFIX = "ai:";

// Request-timeout budgets for content → background round-trips. Two categories,
// because only one of them waits on a language model:
//   - AI provider: the model generates the whole answer/batch.
//   - conventional API: one HTTP round-trip.
// Both are far above the 5s `sendMessageToBackground` default, which is sized
// for storage/config reads, not network calls.
export const AI_REQUEST_TIMEOUT = 120_000;
export const API_REQUEST_TIMEOUT = 30_000;
export const IS_FIREFOX = import.meta.env.FIREFOX;

export enum DB_ACTION {
    RULE_ADD = 'addRule',
    RULE_DEL = 'deleteRule',
    RULE_GET_ALL = 'getAllRule',
    RULE_LIST = 'listRule',
    RULE_SEARCH = 'searchRule',
    DOMAIN_UPSERT = 'upsertDomain',
    DOMAIN_GET = 'getDomain',
    DOMAIN_DELETE = 'deleteDomain',
    DOMAIN_LIST = 'listDomain',
    CONFIG_GET = 'getConfig',
    CONFIG_SET = 'setConfig',
    BACKUP_EXPORT = 'backupExport',
    BACKUP_IMPORT = 'backupImport',
}

/**
 * Website translation rules (main/siteRules/). A separate enum from DB_ACTION
 * on purpose: `RULE_*` above is the OLD per-host no-translate selector list
 * (`rule_<host>`, ruleMode.ts), which this feature neither replaces nor touches.
 * Two namespaces, no shared identifiers.
 */
export enum SITE_RULE_ACTION {
    // Content → background: merge all three tiers for one URL. Called once at
    // content start and again when an SPA changes the URL.
    RESOLVE = 'siteRuleResolve',
    // Options → background: everything the rules page renders (bundles per tier
    // + subscription metadata), in one round trip.
    OVERVIEW = 'siteRuleOverview',
    // Options → background: fetch/refresh one subscription (or all of them when
    // no url is given) and return the updated subscription metadata.
    SUBSCRIPTION_REFRESH = 'siteRuleSubscriptionRefresh',
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
    AUTO_SYNC_CONFIG_CHANGED = 'autoSyncConfigChanged',
    // Read the persisted WebDAV credentials back so the config form can be
    // pre-filled (the options page is part of the extension, so exposing the
    // locally-stored password to it is fine).
    WEBDAV_CONFIG_GET = 'getWebdavConfig',
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
export enum TAB_ACTION {
    LANGUAGE_GET = 'getTabLanguage',
    TAB_DOMAIN_GET = 'getTabDomain',
    ID_GET = 'getTabId',
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

export enum TRANSLATE_SERVICE {
    MICROSOFT = 'microsoft',
    GOOGLE = 'google',
    DEEPL = 'deepl',
}

/** Text-to-speech provider for the selection-translate popup's play buttons. */
export enum TTS_SERVICE {
    GOOGLE = 'google',
    BING = 'bing',
}

export const TTS_SERVICE_OPTIONS: { value: TTS_SERVICE; label: string }[] = [
    { value: TTS_SERVICE.GOOGLE, label: 'Google' },
    { value: TTS_SERVICE.BING, label: 'Bing' },
];

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

export enum TRANSLATE_ACTION {
    TRANSLATE = 'translate',
    TOGGLE = 'toggleTranslate',
    SHOW_ORIGINAL = 'showOriginal',
    TRANSLATE_STATUS_CHANGED = "translateStatusChanged",
    TRANSLATE_INPUT_BOX = 'translateInputBox',
    TRANSLATE_PARA = 'translatePara',
    SHOW_ORIGINAL_PARA = 'showOriginalPara',
    TOGGLE_TRANSLATE_PARA = 'toggleTranslatePara',
    TRANSLATE_SELECTION = 'translateSelection',
    TRANSLATE_SELECTION_INPUT_BOX = 'translateSelectionInputBox',
}

export enum ACTION {
    // One-shot text translation. Content sends { service, texts, targetLang };
    // background picks the provider, serves the cache and performs the request,
    // replying with a 1:1 result array. The provider classes live in background
    // (main/translateService.ts) — content never builds a provider request, so
    // there is no URL proxy and no API key on the content side.
    TRANSLATE_TEXTS = 'translateTexts',
    // Out-of-band cancellation for TRANSLATE_TEXTS. sendMessage has no native
    // abort, so content fires this with the same requestId on signal abort;
    // background aborts the in-flight fetch for that request.
    TRANSLATE_TEXTS_ABORT = 'translateTextsAbort',
    // Provider-backed language detection (Microsoft detect endpoint), used when
    // local franc detection is inconclusive.
    DETECT_LANGUAGE = 'detectLanguage',
    STYLE_CHANGED = 'styleChanged',
    DOMAIN_STRATEGY_CHANGED = 'domainStrategyChanged',
    ENTER_SELECTION_MODE = 'enterSelectionMode',
    LEAVE_SELECTION_MODE = 'leaveSelectionMode',
    AI_OPEN_WORKBENCH = 'aiOpenWorkbench',
    AI_PROVIDER_TEST = 'aiProviderTest',
    // Test a built-in translation service (google/microsoft/deepl) from Options.
    TRANSLATE_SERVICE_TEST = 'translateServiceTest',
    // Generic one-shot (non-streaming) AI completion: content sends a task +
    // payload, background builds the prompt, calls chatCompleteNonStream and
    // returns the whole answer. For callers that have nothing to show until the
    // answer is complete (subtitle sentence segmentation), where streaming only
    // adds per-delta port traffic and keeps a port open for the whole request.
    AI_COMPLETE = 'aiComplete',
    // Out-of-band cancellation for AI_COMPLETE (same requestId mechanism as
    // AI_TRANSLATE_ABORT).
    AI_COMPLETE_ABORT = 'aiCompleteAbort',
    OPEN_OPTIONS_PAGE = 'openOptionsPage',
    // Open the toolbar action popup (popup.html) anchored to the extension
    // icon — same surface/position as a manual icon click. Requested from the
    // float ball's settings button; background calls chrome.action.openPopup().
    OPEN_POPUP = 'openPopup',
    // Broadcast from Options when the user picks a UI language. Background
    // listens to update context menu; other extension UIs listen to swap i18n.
    INTERFACE_LANGUAGE_CHANGED = 'interfaceLanguageChanged',
    SHOW_TRANSLATE_RESTORE_PARA_MENU = 'showTranslateRestoreParaMenu',
    HIDE_TRANSLATE_RESTORE_PARA_MENU = 'hideTranslateRestoreParaMenu',
    // Persistent translation-result cache (LRU, IndexedDB in background).
    // GET: batch-lookup translations for (service, targetLang, texts[]).
    // PUT: batch-store freshly fetched translations.
    // CLEAR: wipe the whole cache (from the Options "clear cache" button).
    TRANSLATION_CACHE_CLEAR = 'translationCacheClear',
    // Current approximate cache size in bytes (for the Options "clear cache"
    // confirmation prompt).
    TRANSLATION_CACHE_SIZE = 'translationCacheSize',
    // Top-frame → sub-frames fan-out. The top-frame content script sends this to
    // background with `data` = an inner Message; background re-broadcasts that
    // inner message to every frame of the sender's tab. Used to drive iframe
    // translation on manual toggles / float-ball clicks, which the top frame
    // cannot deliver to cross-origin iframes itself.
    RELAY_FRAMES = 'relayFrames',
    ACTIVE_TRANSLATE_SERVICE_CHANGED = "activeTranslateServiceChanged",
    CONFIG_CHANGED = "configChanged",
    // Text-to-speech synthesis. content sends { text, lang, service }; background
    // fetches the audio from Google / Bing (their endpoints have no CORS headers
    // and Bing needs a page-scraped token, so the fetch must live in background)
    // and returns an array of base64 `data:` URLs (one per <=170-char chunk) that
    // the content script plays sequentially through an <audio> element.
    TTS_SYNTHESIZE = 'ttsSynthesize',
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
    // Text-to-speech provider used by the selection-translate popup's play
    // buttons: 'google' | 'bing'. Default 'google'.
    TTS_SERVICE = 'ttsService',
    // Selection-translate popup header overrides. Empty/undefined means "follow
    // the page translation" (the default); a concrete value pins that service /
    // target language for the popup, persisted across opens.
    SELECTION_TRANSLATE_SERVICE = 'selectionTranslateService',
    SELECTION_TARGET_LANGUAGE = 'selectionTargetLanguage',
    GLOBAL_SWITCH = 'globalSwitch',
    TRANSLATE_SERVICE = 'translateService',
    MICROSOFT_TOKEN = 'microsoftToken',
    FLOAT_BALL_POSITION = 'floatBallPosition',
    FLOAT_BALL_SWITCH = 'floatBallSwitch',
    CONTEXT_MENU_SWITCH = 'contextMenuSwitch',
    DISABLED_TRANSLATE_SERVICES = 'disabledTranslateServices',
    // When true, the one-time hint shown on entering "Set no-translate area"
    // (rule mode) is suppressed — the user checked "don't remind me again".
    RULE_MODE_HINT_HIDDEN = 'ruleModeHintHidden',
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
    // AI_TRANSLATE_SERVICE: either a TRANSLATE_SERVICE value ('microsoft' |
    // 'google' | 'deepl') or `ai:<providerId>` to route translate through an
    // AI provider. Default: 'microsoft'.
    AI_TRANSLATE_SERVICE = 'aiTranslateService',
    // UI language override for popup/options/context menu. Empty/undefined
    // means "auto-detect from browser UI language".
    INTERFACE_LANGUAGE = 'interfaceLanguage',
    // UI color theme: 'system' | 'light' | 'dark'. Applies to popup/options
    // and every extension-owned Shadow DOM surface. Default 'dark'.
    THEME = 'theme',
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
    AUTO_SYNC_CONFIG_SWITCH = 'autoSyncConfigSwitch',
    // Periodic auto-sync interval in minutes (5..60, default 15). Per-device.
    SYNC_INTERVAL_MINUTES = 'syncIntervalMinutes',
    // Double-tap shortcuts: double-tapping a modifier key runs a quick action.
    // DOUBLE_TAP_MODIFIER: which modifier triggers it ('ctrl' | 'alt', default
    // 'ctrl'). The three toggles below gate which action fires (checked in
    // priority order: selection → input box → mouse-over paragraph); all default on.
    DOUBLE_TAP_MODIFIER = 'doubleTapModifier',
    DOUBLE_TAP_TRANSLATE_SELECTION = 'doubleTapTranslateSelection',
    DOUBLE_TAP_TOGGLE_PARAGRAPH = 'doubleTapToggleParagraph',
    DOUBLE_TAP_TRANSLATE_INPUT = 'doubleTapTranslateInput',
    // Video bilingual subtitles (currently YouTube only).
    // Global feature switch — the player quick-menu's "Disable permanently"
    // and the Options tab's master toggle both write this. Default on.
    VIDEO_SUBTITLE_SWITCH = 'videoSubtitleSwitch',
    // Auto-enable bilingual subtitles when a video with captions loads.
    VIDEO_SUBTITLE_AUTO_ENABLE = 'videoSubtitleAutoEnable',
    // 'bilingual' (original + translation) | 'translation' (translation only).
    VIDEO_SUBTITLE_DISPLAY_MODE = 'videoSubtitleDisplayMode',
    // Translate service for subtitles — same key scheme as AI_TRANSLATE_SERVICE
    // (a TRANSLATE_SERVICE value or `ai:<providerId>`), stored separately.
    VIDEO_SUBTITLE_TRANSLATE_SERVICE = 'videoSubtitleTranslateService',
    // Subtitle target language. Empty/undefined means "follow the page
    // translation target language" (CONFIG_KEY.TARGET_LANGUAGE).
    VIDEO_SUBTITLE_TARGET_LANGUAGE = 'videoSubtitleTargetLanguage',
    // Pause playback while the user selects subtitle text. Default off.
    VIDEO_SUBTITLE_PAUSE_ON_SELECT = 'videoSubtitlePauseOnSelect',
    // VideoSubtitleStyle object (colors / sizes / weights / background).
    VIDEO_SUBTITLE_STYLE = 'videoSubtitleStyle',
    // Use the AI provider to re-segment auto-generated captions into
    // sentences (falls back to rule-based segmentation on failure).
    VIDEO_SUBTITLE_AI_SEGMENT = 'videoSubtitleAiSegment',
    // Vertical position of the subtitle overlay, percent of player height
    // measured from the bottom edge (user-draggable, persisted).
    VIDEO_SUBTITLE_POSITION = 'videoSubtitlePosition',

    // --- Website translation rules (main/siteRules/) ------------------------
    // Master switch for the whole rule system. Default on.
    SITE_RULE_SWITCH = 'siteRuleSwitch',
    // SiteRule[] — the user's own rules, in full. The only tier whose content
    // is cloud-synced; system/subscription rules sync only their on/off state.
    SITE_RULE_USER = 'siteRuleUser',
    // Whether the built-in (system) rule package participates at all.
    SITE_RULE_SYSTEM_ENABLED = 'siteRuleSystemEnabled',
    // refKey strings (`<source>#<id>`) the user switched off. One flat list
    // across system and subscription tiers — a bare id is not unique across
    // sources, see main/siteRules/types.ts.
    SITE_RULE_DISABLED_IDS = 'siteRuleDisabledIds',
    // SiteRuleSubscription[] — subscription URLs plus their on/off state and
    // last-fetch metadata. The fetched rule text itself is NOT here (and not
    // synced): it lives under the `__site_rule_cache` internal key.
    SITE_RULE_SUBSCRIPTIONS = 'siteRuleSubscriptions',
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
    TTS_SERVICE: 'google',
    SYNC_INTERVAL_MINUTES: 15,
    HIGHLIGHT_STYLE: 'underLine',
    HIGHLIGHT_BORDER_COLOR: '#df5f47',
    HIGHLIGHT_BORDER_COLOR_INDEX: 1,
    DISABLED_TRANSLATE_SERVICES: ['deepl'],
    AI_TARGET_LANGUAGE: 'en',
    THEME: 'dark',
    DOUBLE_TAP_MODIFIER: 'ctrl',
    DOUBLE_TAP_TRANSLATE_SELECTION: true,
    DOUBLE_TAP_TOGGLE_PARAGRAPH: true,
    DOUBLE_TAP_TRANSLATE_INPUT: true,
    VIDEO_SUBTITLE_SWITCH: true,
    VIDEO_SUBTITLE_AUTO_ENABLE: true,
    VIDEO_SUBTITLE_DISPLAY_MODE: 'bilingual',
    VIDEO_SUBTITLE_TRANSLATE_SERVICE: 'microsoft',
    VIDEO_SUBTITLE_AI_SEGMENT: false,
    VIDEO_SUBTITLE_PAUSE_ON_SELECT: false,
    // Percent of player height from the bottom edge. 0 means "as low as it is
    // allowed to go": clampPct lifts it to the measured floor (the top of the
    // progress bar), so the default sits right above the controls and keeps
    // tracking them as the player is resized — which a fixed percentage could
    // not do, the control bar being a different share of the height at every
    // player size.
    VIDEO_SUBTITLE_POSITION: 8,
    SITE_RULE_SWITCH: true,
    SITE_RULE_SYSTEM_ENABLED: true,
    // Module-level constants, not inline literals: `useConfig` feeds its default
    // straight into useSyncExternalStore, where a fresh array per render loops.
    SITE_RULE_USER: [] as unknown[],
    SITE_RULE_DISABLED_IDS: [] as string[],
    SITE_RULE_SUBSCRIPTIONS: [] as unknown[],
} as const;

/**
 * The official rule package, offered as a built-in subscription that cannot be
 * removed (only disabled). The bundled baseline in assets/rules/system.jsonc
 * keeps the feature working offline and on first install; a successful fetch of
 * a NEWER package replaces the baseline wholesale, so "System rules" always
 * shows exactly one package rather than a merge of two.
 */
export const SITE_RULE_OFFICIAL_URL =
    'https://raw.githubusercontent.com/linuxscreen/duo-translator-rules/main/rules.jsonc';

/** How often background refreshes every enabled subscription. */
export const SITE_RULE_REFRESH_MINUTES = 24 * 60;

/** Display modes for video bilingual subtitles. */
export enum VIDEO_SUBTITLE_DISPLAY_MODE {
    BILINGUAL = 'bilingual',
    TRANSLATION = 'translation',
}

// CONFIG_KEY value -> enum key name. Lets us look up a default for any config
// key whose enum-key name also exists on DEFAULT_VALUE (e.g. CONFIG_KEY.GLOBAL_SWITCH
// = 'globalSwitch' → 'GLOBAL_SWITCH' → DEFAULT_VALUE.GLOBAL_SWITCH).
export const CONFIG_VALUE_TO_KEY: Record<string, string> = Object.fromEntries(
    Object.entries(CONFIG_KEY).map(([k, v]) => [v as string, k])
);

/**
 * The shipped default for a config key, or `undefined` for keys that have no
 * entry in DEFAULT_VALUE (their "unset" state is meaningful — e.g. a target
 * language the user has never chosen).
 *
 * The single source of defaults: every reader (`configRepo`, `readConfig`)
 * resolves through here, so an unset key reads the same everywhere and a
 * default is changed in exactly one place.
 */
export function configDefault(name: string): unknown {
    const enumKey = CONFIG_VALUE_TO_KEY[name];
    if (enumKey && enumKey in DEFAULT_VALUE) {
        return (DEFAULT_VALUE as Record<string, unknown>)[enumKey];
    }
    return undefined;
}

/**
 * Long-lived port names used for streaming background <-> content traffic.
 * For OpenAI-compatible SSE we tunnel deltas over a runtime port instead of
 * one-shot sendMessage so the content side can consume with `for await`.
 */
export enum PORT_NAME {
    AI_CHAT_STREAM = 'aiChatStream',
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

export type InterfaceLang =
    | 'en'
    | 'zh-CN'
    | 'zh-TW'
    | 'ja'
    | 'ko'
    | 'fr'
    | 'de'
    | 'es'
    | 'pt'
    | 'it'
    | 'ru'
    | 'hi';

// Every entry must have a matching assets/locales/<value>.json (generated by
// .dev/generateI18nJsonFile.ts) — the dictionaries are wired up in
// utils/interfaceLang.ts. Titles are the language's own native name.
export const INTERFACE_LANGUAGES: { value: InterfaceLang; title: string }[] = [
    { value: 'en', title: 'English' },
    { value: 'zh-CN', title: '简体中文' },
    { value: 'zh-TW', title: '繁體中文' },
    { value: 'ja', title: '日本語' },
    { value: 'ko', title: '한국어' },
    { value: 'fr', title: 'Français' },
    { value: 'de', title: 'Deutsch' },
    { value: 'es', title: 'Español' },
    { value: 'pt', title: 'Português' },
    { value: 'it', title: 'Italiano' },
    { value: 'ru', title: 'Русский' },
    { value: 'hi', title: 'हिन्दी' },
];

/**
 * Reduce any BCP-47 tag (`en-US`, `pt-BR`, `zh-Hant`, `cmn-Hans-CN`…) to the
 * codes used as translate targets in `LANGUAGES`. Empty tag → "".
 *
 * The bare base tag is wrong for Chinese: `LANGUAGES` has no `zh`, only
 * `zh-CN` / `zh-TW`. Script is what matters, not region — Singapore is
 * simplified, Hong Kong/Macau traditional — so the region test mirrors
 * `detectInterfaceLang` in utils/interfaceLang.ts (`zh-Hant` and `zh-MO`
 * included for the same reason). Everything else keeps the plain base tag.
 *
 * Use this for ANY comparison between language tags of different origin (a
 * caption track's code vs. the configured target, say). Raw tags do not
 * compare: `zh-Hans` and `zh-CN` are the same language, `en` and `en-US` too.
 */
export function normalizeLanguageTag(tag: string | undefined | null): string {
    const t = (tag || '').toLowerCase().trim();
    if (t === '') return '';
    // `cmn` (Mandarin, ISO-639-3) shows up in franc output and some tracks.
    if (t.startsWith('zh') || t.startsWith('cmn')) {
        return /-(tw|hk|mo|hant)\b/.test(t) ? 'zh-TW' : 'zh-CN';
    }
    return t.split('-')[0];
}

/**
 * Default TRANSLATE-TARGET language for a user who has never picked one,
 * derived from the browser UI language. Every fallback in the codebase goes
 * through this — do not re-inline `navigator.language.split('-')[0]`.
 */
export function browserTargetLanguage(): string {
    return normalizeLanguageTag(globalThis.navigator?.language) || 'en';
}

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
    // 'summary',
    // 'textarea', // todo
    "iron-a11y-announcer", // accessibility-labels
    "pre",
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
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', "IMAGE", "svg"]);

// Block-level HTML tags — the static fallback for logical-paragraph
// segmentation when computed style is unavailable (detached nodes, jsdom).
// See main/dom/segments.ts `isBlockBoundary`.
export const BLOCK_TAGS = [
    'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'dd',
    'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li',
    'main', 'menu', 'nav', 'ol', 'p', 'section', 'summary', 'table',
    'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'td',
    'th', 'ul',
];

export const blockTagSet: Set<string> = new Set(BLOCK_TAGS);

export const BLOCK_SELECTOR = BLOCK_TAGS.join(',');

// Minimum run of consecutive <br>s that splits a logical paragraph; a single
// <br> is treated as a soft line break inside the unit.
export const SEGMENT_BR_SPLIT_MIN = 2;

export const iso6393To1Map: Map<string, string> = new Map(Object.entries(iso6393To1));

export const excludedTagSet: Set<string> = new Set(EXCLUDE_TAGS)

