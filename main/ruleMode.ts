import getCssSelector from "css-selector-generator";
import { addRuleToDB, deleteRuleFromDB, listRuleFromDB } from "@/utils/db";
import { shareConfig } from "./content";

const svgAddCursor = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12 0C5.37259 0 0 5.37259 0 12C0 18.6274 5.37259 24 12 24C18.6274 24 24 18.6274 24 12C24 5.37259 18.6274 0 12 0Z" fill="white"/>
<path d="M12 0C5.37259 0 0 5.37259 0 12C0 18.6274 5.37259 24 12 24C18.6274 24 24 18.6274 24 12C24 5.37259 18.6274 0 12 0ZM17.7664 13.3668H13.377V17.7674C13.377 18.5248 12.7574 19.1445 12 19.1445C11.2426 19.1445 10.623 18.5248 10.623 17.7674V13.3668H6.23161C5.47423 13.3668 4.85456 12.7471 4.85456 11.9898C4.85456 11.2324 5.47423 10.6127 6.23161 10.6127H10.623V6.23266C10.623 5.47528 11.2426 4.85561 12 4.85561C12.7574 4.85561 13.377 5.47528 13.377 6.23266V10.6127H17.7664C18.5237 10.6127 19.1434 11.2324 19.1434 11.9898C19.1434 12.7471 18.5237 13.3668 17.7664 13.3668Z" fill="#48BE78"/>
</svg>`;

const svgTrashCursor = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M21 3.99998H17.9C17.4215 1.67358 15.3751 0.003 13 0H10.9999C8.62483 0.003 6.57836 1.67358 6.09995 3.99998H2.99997C2.44769 3.99998 1.99998 4.44769 1.99998 4.99997C1.99998 5.55225 2.44769 6 2.99997 6H3.99995V19C4.00328 21.76 6.23992 23.9967 8.99997 24H15C17.76 23.9967 19.9967 21.76 20 19V6H21C21.5523 6 22 5.5523 22 5.00002C22 4.44773 21.5523 3.99998 21 3.99998Z" fill="white"/>
<path d="M21 3.99998H17.9C17.4215 1.67358 15.3751 0.003 13 0H11C8.62484 0.003 6.57837 1.67358 6.09997 3.99998H2.99998C2.4477 3.99998 2 4.44769 2 4.99997C2 5.55225 2.4477 6 2.99998 6H3.99997V19C4.0033 21.76 6.23994 23.9967 8.99998 24H15C17.76 23.9967 19.9967 21.76 20 19V6H21C21.5523 6 22 5.5523 22 5.00002C22 4.44773 21.5523 3.99998 21 3.99998ZM11 17C11 17.5523 10.5523 18 10 18C9.44769 18 8.99998 17.5523 8.99998 17V11C8.99998 10.4477 9.44769 10 9.99997 10C10.5522 10 11 10.4477 11 11V17H11ZM15 17C15 17.5523 14.5523 18 14 18C13.4477 18 13 17.5523 13 17V11C13 10.4477 13.4477 10 14 10C14.5523 10 15 10.4477 15 11V17ZM8.171 3.99998C8.59634 2.80228 9.72903 2.00152 11 1.99997H13C14.271 2.00152 15.4037 2.80228 15.829 3.99998H8.171Z" fill="#FF554A"/>
</svg>`

// Convert the cursor SVGs to base64 data-URL cursors once at module load.
const svgAddBase64 = btoa(svgAddCursor);
const svgTrashBase64 = btoa(svgTrashCursor);
const cursorAddUrl = `url('data:image/svg+xml;base64,${svgAddBase64}'), auto`;
const cursorTrashUrl = `url('data:image/svg+xml;base64,${svgTrashBase64}'), auto`;

const getCssSelectorString = (ele: HTMLElement): string => {
    // ignore the elements with class start with duo
    return getCssSelector(ele, { selectors: ["id", "class", "tag"], blacklist: ['.duo-*'] })
}

export interface RuleModeController {
    /** Enter select interaction for the given domain. */
    activeSelectInteraction(): Promise<void>;
    /** Leave select interaction and clean up listeners/styles. */
    deactivateSelectInteraction(): void;
}

/**
 * Rule mode ("Set no-translate area"): lets the user click page elements to
 * mark them as no-translate regions persisted per domain. Fully self-contained
 * — its only inputs are the current `domainWithPort` and the rule DB helpers.
 */
export function createRuleMode(domainWithPort: string): RuleModeController {
    // Full-viewport interaction overlay (see comment on `ensureOverlay`).
    let overlay: HTMLElement | null = null
    // DevTools-style highlight box, a child of the overlay positioned over the
    // hovered element. Lives in the overlay (top-most, unclipped) so the page's
    // `overflow: hidden` ancestors can never cut it off — and it never touches
    // the page's own styles.
    let highlightBox: HTMLElement | null = null
    // Persistent yellow boxes marking the already-selected (no-translate) regions,
    // one per `.duo-selected` element. Also overlay children, so unclipped.
    const selectedBoxes = new Map<HTMLElement, HTMLElement>()
    // Last pointer position over the overlay, used to re-resolve/reposition the
    // highlight on scroll/resize (no mousemove fires then).
    let lastPointer: { x: number; y: number } | null = null

    async function activeSelectInteraction() {
        // get all the rules of the current domain from the db, find the element and add class duo-selected
        let rules = await listRuleFromDB(domainWithPort)
        console.log('rules:', rules)
        if (rules) {
            for (let rule of rules) {
                let element = document.querySelector(rule);
                if (element) {
                    element.classList.add('duo-selected')
                }
            }
        }
        ensureOverlay();
        syncSelectedHighlights();
    }

    function deactivateSelectInteraction() {
        console.log('deactivateSelectionMode')
        // remove all element that have duo-selected
        document.querySelectorAll('.duo-selected').forEach((element) => {
            element.classList.remove('duo-selected');
        })
        lastPointer = null
        removeOverlay();
        // Suppress the contextmenu that would otherwise pop up right after the
        // right-click used to exit (the overlay is already gone by then).
        document.addEventListener('contextmenu', contextMenuHandler);
        setTimeout(() => {
            document.removeEventListener('contextmenu', contextMenuHandler);
        }, 200)
    }

    const contextMenuHandler = function (event: MouseEvent) {
        event.preventDefault()
    }

    // The whole interaction runs through a transparent, top-most, fixed overlay
    // that physically receives the pointer events. This is the ONLY reliable way
    // to stop the underlying page from reacting: SPA routers (e.g. VitePress)
    // register their own click handler at page load, earlier in the capture phase
    // than anything we can add later, so a document/window capture listener can't
    // win the race. With the overlay on top, the page's links never receive the
    // click at all. We resolve the element under the cursor via `elementFromPoint`
    // (briefly disabling the overlay's own hit-testing).
    function ensureOverlay() {
        if (overlay) return;
        const el = document.createElement('div');
        el.setAttribute('data-duo-rule-overlay', '');
        Object.assign(el.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '2147483647',
            background: 'transparent',
            cursor: 'auto',
        } as Partial<CSSStyleDeclaration>);
        el.addEventListener('mousemove', onOverlayMove);
        el.addEventListener('click', onOverlayClick);
        el.addEventListener('mousedown', onOverlayMouseDown);
        el.addEventListener('contextmenu', (e) => e.preventDefault());

        document.body.appendChild(el);
        overlay = el;

        // The hover highlight box. zIndex above the yellow selected boxes so the
        // red/green affordance is drawn on top when hovering a selected region.
        const box = makeBox();
        box.style.display = 'none';
        box.style.zIndex = '2';
        el.appendChild(box);
        highlightBox = box;
        // Reposition on scroll (capture: catches scrolls in nested containers too)
        // and on viewport resize.
        document.addEventListener('scroll', onViewportChange, true);
        window.addEventListener('resize', onViewportChange);
    }

    function removeOverlay() {
        if (!overlay) return;
        document.removeEventListener('scroll', onViewportChange, true);
        window.removeEventListener('resize', onViewportChange);
        overlay.removeEventListener('mousemove', onOverlayMove);
        overlay.removeEventListener('click', onOverlayClick);
        overlay.removeEventListener('mousedown', onOverlayMouseDown);
        overlay.remove();
        overlay = null;
        highlightBox = null;
        selectedBoxes.clear();
    }

    function onViewportChange() {
        // The element under the (unmoved) cursor may now be different, and the
        // hovered element has moved — re-resolve and reposition.
        if (lastPointer) updateHover(lastPointer.x, lastPointer.y);
        repositionSelectedHighlights();
    }

    /** Element under the cursor, looking through the overlay's own hit area. */
    function elementUnderPointer(x: number, y: number): HTMLElement | null {
        if (!overlay) return document.elementFromPoint(x, y) as HTMLElement | null;
        overlay.style.pointerEvents = 'none';
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        overlay.style.pointerEvents = 'auto';
        return el;
    }

    function onOverlayMove(event: MouseEvent) {
        lastPointer = { x: event.clientX, y: event.clientY };
        updateHover(event.clientX, event.clientY);
    }

    function onOverlayMouseDown(event: MouseEvent) {
        // Right mouse button exits rule mode.
        if (event.button === 2) {
            deactivateSelectInteraction();
        }
    }

    async function onOverlayClick(event: MouseEvent) {
        if (event.button !== 0) return;
        const el = elementUnderPointer(event.clientX, event.clientY);
        const resolved = el ? resolveRuleTarget(el) : undefined;
        if (resolved) {
            await selectElementClicked(resolved);
        }
        // The selection set just changed: rebuild the yellow boxes, then recompute
        // the hover highlight at the same spot (no mousemove fires on its own).
        syncSelectedHighlights();
        updateHover(event.clientX, event.clientY);
    }

    // Highlight the element under the cursor (green = add, red = remove) and
    // reflect the affordance on the overlay's cursor. Repositions every call so
    // it stays glued to the element on scroll/resize.
    function updateHover(x: number, y: number) {
        const el = elementUnderPointer(x, y);
        const target = el ? resolveRuleTarget(el) : undefined;
        if (target) {
            const isSelected = target.classList.contains('duo-selected');
            showHighlight(target, isSelected ? 'red' : 'green');
            if (overlay) overlay.style.cursor = isSelected ? cursorTrashUrl : cursorAddUrl;
        } else {
            hideHighlight();
            if (overlay) overlay.style.cursor = 'auto';
        }
    }

    // A highlight box: an overlay child that traces an element's border-box. Drawn
    // in the overlay (not on the page element) so it is never clipped by the page's
    // `overflow:hidden` ancestors and never mutates the page's own styles.
    function makeBox(): HTMLElement {
        const box = document.createElement('div');
        Object.assign(box.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            zIndex: '1',
        } as Partial<CSSStyleDeclaration>);
        return box;
    }

    function positionBox(box: HTMLElement, element: HTMLElement, color: string) {
        const rect = element.getBoundingClientRect();
        const s = box.style;
        s.transform = `translate(${rect.left}px, ${rect.top}px)`;
        s.width = `${rect.width}px`;
        s.height = `${rect.height}px`;
        s.border = `2px solid ${color}`;
    }

    // Position the hover box over `element` (green = add, red = remove).
    function showHighlight(element: HTMLElement, color: 'red' | 'green') {
        if (!highlightBox) return;
        positionBox(highlightBox, element, color);
        highlightBox.style.display = 'block';
    }

    function hideHighlight() {
        if (highlightBox) highlightBox.style.display = 'none';
    }

    // Rebuild the yellow boxes to match the current set of `.duo-selected`
    // elements (adds boxes for new selections, drops boxes for cleared ones).
    function syncSelectedHighlights() {
        if (!overlay) return;
        const selected = new Set(document.querySelectorAll<HTMLElement>('.duo-selected'));
        // Drop boxes whose element is no longer selected.
        for (const [element, box] of selectedBoxes) {
            if (!selected.has(element)) {
                box.remove();
                selectedBoxes.delete(element);
            }
        }
        // Add/position a box for every selected element.
        selected.forEach((element) => {
            let box = selectedBoxes.get(element);
            if (!box) {
                box = makeBox();
                overlay!.appendChild(box);
                selectedBoxes.set(element, box);
            }
            positionBox(box, element, 'yellow');
        });
    }

    function repositionSelectedHighlights() {
        for (const [element, box] of selectedBoxes) {
            positionBox(box, element, 'yellow');
        }
    }

    function removeNoTranslateClass(element: Element) {
        element.classList.remove("duo-no-translate");
        element.querySelectorAll(".duo-paragraph").forEach((child) => {
            child.classList.add("duo-needs-translate")
        })
    }

    /**
     * click left mouse button on the <element> in the rule mode
     * @param ele selected element
     * @returns void
     */
    async function selectElementClicked(ele: HTMLElement) {
        if (ele.classList.contains("duo-selected")) {
            ele.classList.remove("duo-selected")
            // save to db
            let selector = getCssSelectorString(ele)
            deleteRuleFromDB(domainWithPort, selector)
            // remove class duo-no-translate
            removeNoTranslateClass(ele)
        } else {
            // if ele's parent element has duo-selected, remove it
            let parent = ele.parentElement
            while (parent) {
                if (parent.classList.contains("duo-selected")) {
                    parent.classList.remove("duo-selected")
                    deleteRuleFromDB(domainWithPort, getCssSelectorString(parent))
                    removeNoTranslateClass(parent)
                    return
                }
                parent = parent.parentElement as HTMLElement
            }
            if (ele.classList.length == 0) {
                ele.setAttribute("class", "duo-selected")
            } else {
                ele.classList.add("duo-selected")
            }
            // remove children element that has duo-selected
            let children = ele.querySelectorAll(".duo-selected")
            for (let child of children) {
                child.classList.remove("duo-selected")
                // save to db
                let selector = getCssSelectorString(child as HTMLElement)
                await deleteRuleFromDB(domainWithPort, selector)
                removeNoTranslateClass(child)
            }
            const selector = getCssSelectorString(ele)
            await addRuleToDB(domainWithPort, selector)
            shareConfig.rules.push(selector)
            ele.classList.add("duo-no-translate")
            ele.classList.remove("duo-needs-translate")
            ele.querySelectorAll(".duo-needs-translate").forEach((element) => {
                element.classList.remove("duo-needs-translate")
            })
        }
    }

    // ---- Pure target resolvers (no side effects) ----
    // Shared by both hover styling and the capture-phase click handler so that
    // what gets highlighted and what gets toggled always agree.

    /** Nearest ancestor (incl. self) already marked as a selected region, if any. */
    function findSelectedAncestor(element: HTMLElement): HTMLElement | undefined {
        let current: HTMLElement | null = element
        while (current && current !== document.body && current !== document.documentElement) {
            if (current.classList.contains("duo-selected")) {
                return current
            }
            current = current.parentElement
        }
        return undefined
    }

    /**
     * Resolve the translatable-paragraph element for `element`: itself if it is a
     * paragraph (or contains one), otherwise the nearest paragraph ancestor.
     */
    function resolveParagraph(element: HTMLElement): HTMLElement | undefined {
        if (element.classList.contains("duo-paragraph")) {
            return element
        }
        if (element.querySelectorAll(".duo-paragraph").length > 0) {
            return element
        }
        let parent = element.parentElement
        while (parent) {
            if (parent.classList.contains("duo-paragraph")) {
                return parent
            }
            parent = parent.parentElement
        }
        return undefined
    }

    /** The element a click should act on: a selected region (to remove) or a paragraph (to add). */
    function resolveRuleTarget(element: HTMLElement): HTMLElement | undefined {
        if (element === document.body || element === document.documentElement) {
            return undefined
        }
        return findSelectedAncestor(element) ?? resolveParagraph(element)
    }

    return { activeSelectInteraction, deactivateSelectInteraction };
}
