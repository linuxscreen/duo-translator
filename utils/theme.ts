import { useSyncExternalStore } from "react";
import { storage, type StorageItemKey } from "wxt/utils/storage";
import { CONFIG_KEY, DEFAULT_VALUE } from "@/main/constants";
import { useConfig } from "@/utils/reactiveConfig";

/**
 * UI color theme plumbing, shared by the extension pages (popup/options) and
 * every extension-owned Shadow DOM surface (float ball, AI writing dot,
 * workbench, selection popup, rule-mode hint dialog).
 *
 * The setting itself is a regular config key (CONFIG_KEY.THEME) so it syncs
 * and broadcasts like any other config: reads/watches go straight through
 * chrome.storage (fires in every context), writes go through `setConfig` at
 * the call sites so cloud-sync bookkeeping stays intact.
 *
 * Styling contract: base design tokens are the DARK values; the light theme
 * is a token override block scoped to `[data-theme="light"]` (on <html> for
 * extension pages, on the `.duo-ai-root` mount for Shadow DOM surfaces).
 * "system" resolves via prefers-color-scheme and re-resolves live on change.
 */

export type ThemeSetting = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME = DEFAULT_VALUE.THEME as ThemeSetting;

export const THEME_OPTIONS: { value: ThemeSetting; i18nKey: string; fallback: string }[] = [
    { value: "system", i18nKey: "themeSystem", fallback: "System" },
    { value: "light", i18nKey: "themeLight", fallback: "Light" },
    { value: "dark", i18nKey: "themeDark", fallback: "Dark" },
];

const THEME_STORAGE_KEY = `local:config_${CONFIG_KEY.THEME}` as StorageItemKey;
// localStorage mirror so extension pages can re-apply the last resolved theme
// synchronously before the async storage read lands (no light→dark flash).
const THEME_CACHE_KEY = "duoResolvedTheme";

function prefersLightQuery(): MediaQueryList {
    return window.matchMedia("(prefers-color-scheme: light)");
}

function normalize(v: unknown): ThemeSetting {
    return v === "light" || v === "dark" || v === "system" ? v : DEFAULT_THEME;
}

export function resolveTheme(setting: ThemeSetting | undefined): ResolvedTheme {
    const s = normalize(setting);
    if (s === "system") return prefersLightQuery().matches ? "light" : "dark";
    return s;
}

/**
 * Invoke `cb` with the resolved theme now (once hydrated) and again whenever
 * the config key changes from any context or, in "system" mode, the OS
 * preference flips. Returns a disposer.
 */
export function watchResolvedTheme(cb: (theme: ResolvedTheme) => void): () => void {
    let setting: ThemeSetting = DEFAULT_THEME;
    const emit = () => cb(resolveTheme(setting));
    const mq = prefersLightQuery();
    const onMq = () => {
        if (setting === "system") emit();
    };
    // Older WebViews lack addEventListener on MediaQueryList; ignore if so.
    try { mq.addEventListener("change", onMq); } catch { /* noop */ }
    void storage.getItem(THEME_STORAGE_KEY).then((v) => {
        setting = normalize(v);
        emit();
    });
    const unwatch = storage.watch(THEME_STORAGE_KEY, (v) => {
        setting = normalize(v);
        emit();
    });
    return () => {
        try { mq.removeEventListener("change", onMq); } catch { /* noop */ }
        unwatch();
    };
}

/**
 * Keep `data-theme` on an element in sync with the resolved theme. Used for
 * the mount root of each Shadow DOM surface; the light token override block
 * in aiWriting.css is scoped to `.duo-ai-root[data-theme="light"]`.
 */
export function bindThemeToElement(el: HTMLElement): () => void {
    return watchResolvedTheme((theme) => {
        el.dataset.theme = theme;
    });
}

/**
 * Extension pages (popup/options): stamp `data-theme` on <html> and keep it
 * live. Call once from main.tsx before rendering. Dark needs no attribute
 * (base tokens are dark), so the default stays flash-free; for light users a
 * localStorage mirror re-applies the last resolved theme synchronously.
 */
export function initExtensionPageTheme(): void {
    try {
        const cached = localStorage.getItem(THEME_CACHE_KEY);
        if (cached === "light" || cached === "dark") {
            document.documentElement.dataset.theme = cached;
        }
    } catch { /* storage may be unavailable; dark default applies */ }
    watchResolvedTheme((theme) => {
        document.documentElement.dataset.theme = theme;
        try { localStorage.setItem(THEME_CACHE_KEY, theme); } catch { /* noop */ }
    });
}

/** Reactive view of the raw setting ('system' | 'light' | 'dark'). */
export function useThemeSetting(): ThemeSetting {
    return normalize(useConfig<ThemeSetting>(CONFIG_KEY.THEME));
}

const subscribeSystem = (cb: () => void) => {
    const mq = prefersLightQuery();
    try { mq.addEventListener("change", cb); } catch { /* noop */ }
    return () => {
        try { mq.removeEventListener("change", cb); } catch { /* noop */ }
    };
};

/** Reactive resolved theme ('light' | 'dark'), following the OS in system mode. */
export function useResolvedTheme(): ResolvedTheme {
    const setting = useThemeSetting();
    const systemLight = useSyncExternalStore(subscribeSystem, () => prefersLightQuery().matches);
    if (setting === "system") return systemLight ? "light" : "dark";
    return setting;
}
