// Compiled Tailwind + AI-Writing local rules, imported as a raw string by Vite
// so we can inject it inside a Shadow DOM (where <link rel=stylesheet> from
// the host document does not apply).
// @ts-ignore — Vite ?inline returns the file contents as default string export.
import aiWritingCss from "./aiWriting.css?inline";

export function loadTailwindIntoShadow(root: ShadowRoot): void {
    // Prefer adoptedStyleSheets when CSSStyleSheet construction is allowed
    // (cheap to share across many shadow roots). Fall back to inline <style>
    // for older Chromes or if construction throws.
    try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(aiWritingCss as string);
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        return;
    } catch {
        // fall through
    }
    const style = document.createElement("style");
    style.textContent = aiWritingCss as string;
    root.appendChild(style);
}
