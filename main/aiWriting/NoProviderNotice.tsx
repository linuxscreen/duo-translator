import React from "react";
import { t } from "./i18n";

/**
 * Inline notice shown (inside the AI-writing Shadow DOM surfaces) wherever an
 * AI-provider picker would normally appear but there is no usable provider:
 * a hint on the left + a "Configure" action on the right. Mirrors the
 * "Better writing with" picker box style in the floating-dot settings popover.
 *
 * `hasConfigured` distinguishes the two states: providers exist but none are
 * enabled ("No AI provider enabled") vs. none configured at all
 * ("No AI provider configured").
 */
export function NoProviderNotice({
    hasConfigured,
    onConfigure,
    boxed = false,
}: {
    hasConfigured: boolean;
    onConfigure: () => void;
    /** Wrap in the settings-popover picker box (border + background). */
    boxed?: boolean;
}) {
    return (
        <div
            className={
                boxed
                    ? "flex items-center justify-between gap-2 rounded bg-bg border border-line-strong px-2 py-1.5"
                    : "flex items-center justify-between gap-2 py-1"
            }
        >
            <span className="text-[11.5px] text-ink-soft">
                {hasConfigured
                    ? t("aiNoProviderEnabled", "No AI provider enabled")
                    : t("aiNoProviderConfigured", "No AI provider configured")}
            </span>
            <button
                type="button"
                onClick={onConfigure}
                onMouseDown={(e) => e.preventDefault()}
                className="shrink-0 text-[11.5px] text-accent hover:underline"
            >
                {t("aiConfigure", "Configure")}
            </button>
        </div>
    );
}
