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