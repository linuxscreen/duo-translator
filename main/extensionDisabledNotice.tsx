// ---------------------------------------------------------------------------
// "Duo Translator has been disabled" dialog.
//
// Disabling/updating/reloading the extension leaves its content script running
// on every already-open page (see utils/extensionContext.ts), so the float ball
// and the AI writing surfaces are still on screen and still clickable — they
// just cannot do anything. Without this the user clicks and gets nothing but a
// console error they will never see.
//
// Everything here is deliberately chrome-API-free: React + Shadow DOM need no
// extension privileges, and the theme binding degrades to "current theme, no
// live updates" once the context is gone. So this dialog still renders on a
// page where nothing else works — which is the whole point.
// ---------------------------------------------------------------------------

import { createRoot, type Root } from "react-dom/client";
import { loadTailwindIntoShadow } from "./aiWriting/shadowStyle";
import { bindThemeToElement } from "@/utils/theme";
import { t, useLang } from "./aiWriting/i18n";
import { isExtensionContextValid } from "@/utils/extensionContext";

const HOST_ID = "duo-extension-disabled-host";

let root: Root | null = null;
let host: HTMLElement | null = null;

/**
 * Gate a user-initiated action on the extension still being alive.
 *
 * Returns true when the action may proceed. When the extension is gone it shows
 * the notice and returns false, so call sites read as an early return:
 *
 *     if (!guardExtensionAlive()) return;
 *
 * Put it at the top of *handlers*, never at mount time — the extension is
 * usually alive when a surface mounts and dies later.
 */
export function guardExtensionAlive(): boolean {
    if (isExtensionContextValid()) return true;
    showExtensionDisabledNotice();
    return false;
}

/** Show the notice (idempotent — a second call while it is open is a no-op). */
export function showExtensionDisabledNotice(): void {
    if (root) return;
    try {
        host = document.createElement("div");
        host.id = HOST_ID;
        host.setAttribute("data-duo-ai-ui", "");
        // <html>, not <body>: some SPAs replace the whole body node.
        document.documentElement.appendChild(host);
        const shadow = host.attachShadow({ mode: "open" });
        loadTailwindIntoShadow(shadow);
        const mount = document.createElement("div");
        mount.className = "duo-ai-root";
        shadow.appendChild(mount);
        bindThemeToElement(mount);
        // createRoot BEFORE anything that could throw is assigned, so a partial
        // failure can never leave `root` null with a half-built host in the DOM
        // (the bug this module's own dependency chain had — see errorToast).
        root = createRoot(mount);
        root.render(<ExtensionDisabledDialog onClose={dismiss} />);
    } catch {
        // Rendering the "everything is broken" notice must not itself break.
        dismiss();
    }
}

function dismiss(): void {
    try { root?.unmount(); } catch { /* noop */ }
    root = null;
    try { host?.remove(); } catch { /* noop */ }
    host = null;
}

function ExtensionDisabledDialog({ onClose }: { onClose: () => void }) {
    useLang();
    return (
        // Backdrop: full-viewport click shield. Centering is a full-width flex
        // row (NOT left-1/2 + -translate-x-1/2 — that measures the initial
        // containing block and visibly drifts on a page with a scrollbar).
        <div
            className="fixed inset-0 flex items-center justify-center"
            style={{
                zIndex: 2147483647,
                background: "var(--color-backdrop)",
                backdropFilter: "blur(4px)",
                WebkitBackdropFilter: "blur(4px)",
            }}
            onClick={onClose}
        >
            <div
                className="w-[360px] max-w-[90vw] rounded-xl border border-line-strong bg-surface p-5 text-ink shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="text-[15px] font-semibold">
                    {t("extensionDisabledTitle", "Duo Translator has been disabled")}
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
                    {t(
                        "extensionDisabledBody",
                        "The extension was disabled, updated or reloaded, so its features no longer work on this page. Re-enable it and reload the page to continue.",
                    )}
                </p>
                <div className="mt-5 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink-2 hover:bg-hover-2"
                    >
                        {t("extensionDisabledDismiss", "Close")}
                    </button>
                    <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="duo-ai-primary rounded-md px-4 py-1.5 text-[13px]"
                    >
                        {t("extensionDisabledReload", "Reload page")}
                    </button>
                </div>
            </div>
        </div>
    );
}
