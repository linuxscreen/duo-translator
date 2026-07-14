/**
 * Layout-viewport size (excluding scrollbars), correct in BOTH standards and
 * quirks mode. Per CSSOM View, clientWidth/clientHeight return the viewport
 * dimension only on the root element in standards mode — in quirks mode
 * ("BackCompat", e.g. news.ycombinator.com) that special case moves to
 * document.body, and documentElement.clientHeight reports the <html> CONTENT
 * height instead, which grows with the page. Fixed-position UI (float ball,
 * its menus/tooltips) must clamp against the real viewport, or on quirks-mode
 * pages it gets repositioned off-screen as soon as the content grows (e.g.
 * bilingual translation doubling the page height).
 */
export function getViewportSize(): { width: number; height: number } {
    if (document.compatMode === "BackCompat") {
        const body = document.body;
        // Pre-body edge case (should not happen for our UI): fall back to the
        // window size — includes scrollbars, but never off by a page height.
        if (!body) return { width: window.innerWidth, height: window.innerHeight };
        return { width: body.clientWidth, height: body.clientHeight };
    }
    const root = document.documentElement;
    return { width: root.clientWidth, height: root.clientHeight };
}

export function getElementText(el: HTMLElement): string {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
    return (el.innerText || el.textContent || "").trim();
}

function removeZeroWidthCharacters(text: string): string {
    // /\p{Cf}/gu: Contains all zero-width characters
    return text.replace(/\p{Cf}/gu, '');
}

export function contentInvisible(node: Node): boolean {
    // only document and doctype nodes have no text content
    return removeZeroWidthCharacters(node.textContent!) === ''
}

export function contentVisible(node: Node): boolean {
    return !contentInvisible(node)
}

export function contentValid(node: Node): boolean {
    return removeZeroWidthCharacters(node.textContent!).trim() !== ''
}

let textarea: HTMLTextAreaElement | null = null

export function decodeHtmlText(text: string): string {
    if (textarea === null) textarea = document.createElement("textarea")
    if (!text.includes("&")) return text
    textarea.innerHTML = text
    return textarea.value
}