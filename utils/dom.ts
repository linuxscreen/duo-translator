export function getElementText(el : HTMLElement) : string {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
    return (el.innerText || el.textContent || "").trim();
}