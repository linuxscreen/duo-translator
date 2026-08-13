// Page-side CSS for the inline translating indicator.
//
// Delivered through the same channel as the translation styling
// (main/content.ts `updateStyle` → document sheet + setShadowCss), because an
// indicator sits inside a translation container and those live inside page
// shadow roots as often as not — a document-scoped sheet would leave the ones
// in a web component unstyled, i.e. invisible.
//
// It is emitted unconditionally, including when the feature is off: the rules
// match nothing when no indicator exists, and making delivery conditional would
// mean re-pushing a stylesheet to every root whenever the setting changes.
//
// The busy animation is FIXED — one colour and one size everywhere. It is chrome,
// not text: taking its colour and size from the paragraph made it a different
// marker in every heading, caption and sidebar of the same page, which read as
// a rendering bug rather than as one consistent piece of feedback.
//
// The colour is a MID GREY, for the one property no single colour on a page of
// unknown background has for free: #888 clears the 3:1 contrast an icon needs
// against BOTH ends — ~3.5:1 on white, ~5.9:1 on black — so it is legible on a
// light page, a dark page and a photo, without knowing which it landed on.
// (White was tried first and disappears on light pages; separating it with a
// drop-shadow rescued the contrast but read as a sticker pasted over the text.)
//
// The failure pair is the exception — its icons stay `currentColor` so they
// cannot land invisible on the page's own background, with the alert glyph in a
// fixed red because it has to read as an error.
import { TRANSLATE_INDICATOR_TAG } from "@/main/constants";

const TAG = TRANSLATE_INDICATOR_TAG;

export const TRANSLATE_INDICATOR_CSS = `
${TAG} {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    vertical-align: middle;
    margin: 0 4px;
    padding: 0;
    border: 0;
    line-height: 1;
    font-size: inherit;
    color: inherit;
    white-space: nowrap;
    user-select: none;
    -webkit-user-select: none;
}
${TAG} .duo-loading-dot {
    display: inline-block;
    box-sizing: border-box;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #888;
    animation: duo-loading-bounce 1.1s infinite ease-in-out both;
}
${TAG} .duo-loading-dot:nth-child(2) { animation-delay: 0.15s; }
${TAG} .duo-loading-dot:nth-child(3) { animation-delay: 0.3s; }
${TAG} .duo-loading-spin {
    display: inline-block;
    box-sizing: border-box;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 2px solid #888;
    border-top-color: transparent;
    animation: duo-loading-spin 0.7s linear infinite;
}
${TAG} .duo-loading-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 18px;
    height: 18px;
    padding: 0;
    margin: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    /* The page's own background is unknown, so the hover affordance is a grey
       that darkens a light page and lightens a dark one. */
    transition: background-color 0.15s ease;
}
${TAG} .duo-loading-btn:hover {
    background: rgba(128, 128, 128, 0.28);
}
${TAG} .duo-loading-btn svg {
    display: block;
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
}
${TAG} .duo-loading-details { color: #e5534b; }
@keyframes duo-loading-bounce {
    /* Transform only. Fading the dot would eat into the contrast the grey was
       chosen for — at 0.5 opacity #888 on white is below the 3:1 an icon needs,
       and the bounce already carries the animation on its own. */
    0%, 80%, 100% { transform: translateY(0); }
    40% { transform: translateY(-4px); }
}
@keyframes duo-loading-spin {
    to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
    ${TAG} .duo-loading-dot,
    ${TAG} .duo-loading-spin {
        animation: none;
    }
}
`;
