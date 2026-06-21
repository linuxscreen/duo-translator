import { AiProvider, normalizeProvider } from "@/main/aiService";
import { ACTION, AI_PREFIX, CONFIG_KEY, TRANS_SERVICE, TRANSLATE_SERVICES, TranslateServiceMeta } from "@/main/constants";
import { getConfig } from "./db";
import { parseTranslateServiceKey } from "@/main/aiWriting/translateRunner";
import { sendMessageToAllTabs } from "./message";

/**
 * A flat, render-ready descriptor for one entry in a translate-service picker
 * (built-in translators + configured AI providers). Shared by the popup,
 * options pages, and the AI-writing surfaces so every dropdown looks/behaves
 * the same (icon + label, no grouping).
 */
export interface ServiceOption {
    /** Selection value — a TRANS_SERVICE value or `ai:<providerId>`. */
    value: string;
    /** `ServiceMark` id — the translator value, or the AI provider's type. */
    iconId: string;
    isAi: boolean;
    /** i18n key for built-in services; undefined for AI providers. */
    i18nKey?: string;
    /** Display fallback (built-in) or the AI provider's resolved title. */
    label: string;
}

/**
 * Resolve which service should be selected, given the persisted config value
 * and the currently-available translators / AI providers. Falls back to the
 * first enabled translator when the saved value is missing or no longer valid
 * (e.g. its AI provider was deleted, or the translator was disabled).
 */
export function resolveActiveService(
    configValue: string | undefined,
    enabledTranslateServices: TranslateServiceMeta[],
    enabledAiProviders: AiProvider[],
): string {
    const firstEnabled = enabledTranslateServices.length > 0
        ? enabledTranslateServices[0].value
        : TRANS_SERVICE.MICROSOFT;
    if (!configValue) return firstEnabled;
    if (configValue.startsWith(AI_PREFIX)) {
        const id = configValue.slice(AI_PREFIX.length);
        return enabledAiProviders.some((p) => p.id === id) ? configValue : firstEnabled;
    }
    return enabledTranslateServices.some((s) => s.value === configValue) ? configValue : firstEnabled;
}

/**
 * Build the flat (ungrouped) option list shared by every service picker:
 * built-in translators first, then AI providers using the `ai:<id>` scheme.
 */
export function buildServiceOptions(
    enabledTranslateServices: TranslateServiceMeta[],
    enabledAiProviders: AiProvider[],
): ServiceOption[] {
    return [
        ...enabledTranslateServices.map((s): ServiceOption => ({
            value: s.value,
            iconId: s.value,
            isAi: false,
            i18nKey: s.title,
            label: s.name,
        })),
        ...enabledAiProviders.map((p): ServiceOption => ({
            value: `${AI_PREFIX}${p.id}`,
            iconId: p.type as string,
            isAi: true,
            label: p.getTitle(),
        })),
    ];
}

/**
 * Page-translation service context (popup + Options › Translation). AI
 * providers are surfaced only when the global "Also used for translating pages"
 * toggle is on.
 */
export async function getTranslateService(configValue: string | undefined): Promise<{
    activeService: string,
    enabledTranslateServices: TranslateServiceMeta[],
    enabledAiProviders: AiProvider[],
    aiUsedForTranslatePage?: boolean
}> {
    const [disabledTranslateServices, aiProviders, aiUsedForTranslatePage]: [string[], AiProvider[], boolean] = await Promise.all([
        getConfig(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES),
        getConfig(CONFIG_KEY.AI_PROVIDERS),
        getConfig(CONFIG_KEY.AI_USE_FOR_TRANSLATE_PAGE),
    ]);
    const enabledTranslateServices = filterEnabledTranslateServices(disabledTranslateServices);
    const allProviders = (Array.isArray(aiProviders) ? aiProviders : []).map(normalizeProvider);
    const enabledAiProviders = aiUsedForTranslatePage ? allProviders.filter((p) => p.enabled !== false) : [];

    return {
        activeService: resolveActiveService(configValue, enabledTranslateServices, enabledAiProviders),
        enabledTranslateServices,
        enabledAiProviders,
        aiUsedForTranslatePage,
    };
}

/**
 * AI-writing translate context (floating dot, workbench, Options › AI Writing).
 * Independent from page translation: it reads its own `AI_TRANSLATE_SERVICE`
 * value and never gates AI providers on the page-translate toggle.
 */
export interface AiTranslateService {
    activeService: string;
    enabledTranslateServices: TranslateServiceMeta[];
    enabledAiProviders: AiProvider[];
    /** Count of all configured AI providers, regardless of enabled state.
     * Lets callers tell "none configured" apart from "configured but disabled". */
    totalAiProviders: number;
}

/**
 * Pure resolver — given the three raw config values, produce the AI-writing
 * translate context. Split out from `getAiTranslateService` so reactive callers
 * (e.g. the floating dot, watching config via `useConfig`) can recompute
 * synchronously without re-reading storage.
 */
export function buildAiTranslateService(
    configValue: string | undefined,
    aiProviders: unknown,
    disabledTranslateServices: unknown,
): AiTranslateService {
    const disabled = Array.isArray(disabledTranslateServices) ? (disabledTranslateServices as string[]) : [];
    const enabledTranslateServices = filterEnabledTranslateServices(disabled);
    const allAiProviders = (Array.isArray(aiProviders) ? aiProviders : []).map(normalizeProvider);
    const enabledAiProviders = allAiProviders.filter((p) => p.enabled !== false);

    return {
        activeService: resolveActiveService(configValue, enabledTranslateServices, enabledAiProviders),
        enabledTranslateServices,
        enabledAiProviders,
        totalAiProviders: allAiProviders.length,
    };
}

export async function getAiTranslateService(configValue: string | undefined): Promise<AiTranslateService> {
    const [disabledTranslateServices, aiProviders] = await Promise.all([
        getConfig(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES),
        getConfig(CONFIG_KEY.AI_PROVIDERS),
    ]);
    return buildAiTranslateService(configValue, aiProviders, disabledTranslateServices);
}

function filterEnabledTranslateServices(disabled: string[] | undefined): TranslateServiceMeta[] {
    const disabledSet = new Set(Array.isArray(disabled) ? disabled : []);
    return Array.from(TRANSLATE_SERVICES.values()).filter((s) => !disabledSet.has(s.value));
}

export async function getActiveTranslateService() {
    const [translateServiceConfig, aiTranslateServiceConfig, disabledTranslateServices, aiProviders, aiUsedForTranslatePage]
        : [string | undefined, string | undefined, string[], AiProvider[], boolean] = await Promise.all([
            getConfig(CONFIG_KEY.TRANSLATE_SERVICE),
            getConfig(CONFIG_KEY.AI_TRANSLATE_SERVICE),
            getConfig(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES),
            getConfig(CONFIG_KEY.AI_PROVIDERS),
            getConfig(CONFIG_KEY.AI_USE_FOR_TRANSLATE_PAGE),
        ]);
    const enabledTranslateServices = filterEnabledTranslateServices(disabledTranslateServices);
    const allProviders = (Array.isArray(aiProviders) ? aiProviders : []).map(normalizeProvider);
    const enabledAiProviders = aiUsedForTranslatePage ? allProviders.filter((p) => p.enabled !== false) : [];
    const activeTranslateService = resolveActiveService(translateServiceConfig, enabledTranslateServices, enabledAiProviders)
    const activeAiTranslateService = resolveActiveService(aiTranslateServiceConfig, enabledTranslateServices, enabledAiProviders)
    let activeAiTranslateServiceChoice = parseTranslateServiceKey(activeAiTranslateService);
    return {
        activeTranslateService,
        activeAiTranslateService,
        activeAiTranslateServiceChoice
    };
}

export async function notifyUpdateActiveTranslateService() {
    let data = await getActiveTranslateService();
    await sendMessageToAllTabs({ action: ACTION.UPDATE_ACTIVE_TRANSLATE_SERVICE, data: data })
}