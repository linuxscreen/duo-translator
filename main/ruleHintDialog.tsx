import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CONFIG_KEY } from "./constants";
import { getConfig, setConfig } from "@/utils/db";
import { loadTailwindIntoShadow } from "./aiWriting/shadowStyle";
import { t, useLang } from "./aiWriting/i18n";

const HOST_ID = "duo-rule-hint-host";

/**
 * One-time entry hint for "Set no-translate area" (rule mode). Resolves once the
 * user confirms. If the user has previously checked "don't remind me again"
 * (CONFIG_KEY.RULE_MODE_HINT_HIDDEN) it resolves immediately without rendering.
 *
 * React + Tailwind inside a Shadow DOM, same pattern as the AI Writing dot, so
 * host-page styles can never bleed in. Top-most z-index; clicking the backdrop
 * does NOT dismiss it (only the confirm button does).
 */
export async function confirmRuleModeHint(): Promise<void> {
    const hidden = await getConfig(CONFIG_KEY.RULE_MODE_HINT_HIDDEN);
    if (hidden) return;
    // Guard against stacking if the trigger fires repeatedly.
    if (document.getElementById(HOST_ID)) return;

    return new Promise<void>((resolve) => {
        const host = document.createElement("div");
        host.id = HOST_ID;
        host.setAttribute("data-duo-rule-ui", "");
        document.documentElement.appendChild(host);
        const shadow = host.attachShadow({ mode: "open" });
        loadTailwindIntoShadow(shadow);
        const mount = document.createElement("div");
        mount.className = "duo-ai-root";
        shadow.appendChild(mount);
        const root = createRoot(mount);

        const finish = async (dontRemind: boolean) => {
            if (dontRemind) await setConfig(CONFIG_KEY.RULE_MODE_HINT_HIDDEN, true);
            try { root.unmount(); } catch { }
            host.remove();
            resolve();
        };

        root.render(<RuleHintDialog onConfirm={finish} />);
    });
}

function RuleHintDialog({ onConfirm }: { onConfirm: (dontRemind: boolean) => void }) {
    useLang();
    const [dontRemind, setDontRemind] = useState(false);
    return (
        // Backdrop: full-viewport, top-most, blurs the page behind the dialog.
        // It captures clicks but intentionally has no dismiss handler — clicking
        // outside the card must NOT close it.
        <div
            className="fixed inset-0 flex items-center justify-center"
            style={{
                zIndex: 2147483647,
                background: "rgba(7,11,20,0.45)",
                backdropFilter: "blur(4px)",
                WebkitBackdropFilter: "blur(4px)",
            }}
        >
            <div className="w-[340px] max-w-[90vw] rounded-xl border border-[rgba(140,180,230,0.18)] bg-[#0f1623] p-5 text-[#eef1f8] shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
                <div className="text-[15px] font-semibold">
                    {t("setNoTranslateArea", "Set no-translate area")}
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-[#a8b0c4]">
                    {t("ruleModeHintBody", "Right-click to exit. Left-click to add or remove an area.")}
                </p>
                <label className="mt-4 flex cursor-pointer items-center gap-2 text-[13px] text-[#a8b0c4] select-none">
                    <input
                        type="checkbox"
                        checked={dontRemind}
                        onChange={(e) => setDontRemind(e.target.checked)}
                        className="h-4 w-4 accent-[oklch(0.86_0.16_195)]"
                    />
                    {t("ruleModeHintDontRemind", "Don't remind me again")}
                </label>
                <div className="mt-5 flex justify-end">
                    <button
                        type="button"
                        onClick={() => onConfirm(dontRemind)}
                        className="duo-ai-primary rounded-md px-4 py-1.5 text-[13px]"
                    >
                        {t("ruleModeHintConfirm", "Got it")}
                    </button>
                </div>
            </div>
        </div>
    );
}
