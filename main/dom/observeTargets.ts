// IntersectionObserver bookkeeping for translation-unit containers.
//
// `IntersectionObserver.observe` takes an Element, but a `UnitContainer` may be
// a `ShadowRoot` — which has no box of its own. A root is therefore observed
// through its **host**, and that immediately creates a many-to-one mapping:
//
//   - a host with slotted light children is a container in its own right AND
//     the proxy for its shadow root;
//   - a `display: contents` host generates no box at all, so it has to hand the
//     observation further up, possibly joining an ancestor that is already
//     observed for its own content.
//
// Hence the refcount. Without it, unobserving one container silently stops
// delivery for every other container sharing the same target — the host's own
// paragraph would stop being translated the moment its shadow root finished.
import type { UnitContainer } from "@/main/dom/segments";
import { isShadowRoot, parentElementOrHost } from "@/main/dom/shadowTraversal";

/** Container → the element we actually handed to `observe()`. */
const ioTargetOf = new Map<UnitContainer, Element>();
/** Element → the containers currently observed through it. */
const ioProxied = new Map<Element, Set<UnitContainer>>();

/** `display: contents` — renders its children, generates no box of its own. */
function isTransparentBox(el: Element): boolean {
    if (!el.isConnected) return false;
    try {
        return getComputedStyle(el).display === "contents";
    } catch {
        return false;
    }
}

/**
 * The element to observe on a container's behalf.
 *
 * A `display: contents` element generates no box, so an IntersectionObserver on
 * it can NEVER report `isIntersecting` — a long-standing defect for such
 * containers, and shadow hosts are very often exactly this kind of transparent
 * wrapper. Hand the observation to the nearest ancestor that does generate one.
 *
 * Deliberately narrow — it does NOT climb for a merely invisible element.
 * `display: none` (a collapsed panel, an inactive tab) must keep being observed
 * on the element itself so it fires when the page reveals it; climbing to a
 * visible ancestor would translate hidden content immediately, which is the
 * opposite of the lazy behaviour the whole observer exists for.
 */
function resolveObserveTarget(container: UnitContainer): Element | null {
    let el: Element | null = isShadowRoot(container) ? container.host : container;
    for (let depth = 0; el && depth < 32; depth++) {
        if (!isTransparentBox(el)) return el;
        el = parentElementOrHost(el);
    }
    return el;
}

export function observeContainer(observer: IntersectionObserver, container: UnitContainer): void {
    if (ioTargetOf.has(container)) return;
    const target = resolveObserveTarget(container);
    if (!target) return;
    ioTargetOf.set(container, target);
    let set = ioProxied.get(target);
    if (!set) {
        set = new Set();
        ioProxied.set(target, set);
        observer.observe(target);
    }
    set.add(container);
}

export function unobserveContainer(observer: IntersectionObserver, container: UnitContainer): void {
    // Read back the element we actually observed. Re-resolving would be wrong:
    // `resolveObserveTarget` reads layout, so after a reflow it can answer with
    // a different ancestor — and the original observation would leak forever.
    const target = ioTargetOf.get(container);
    if (!target) return;
    ioTargetOf.delete(container);
    const set = ioProxied.get(target);
    if (!set) return;
    set.delete(container);
    if (set.size === 0) {
        ioProxied.delete(target);
        observer.unobserve(target);
    }
}

/** The containers an intersection on `target` should be attributed to. */
export function containersFor(target: Element): UnitContainer[] {
    const set = ioProxied.get(target);
    return set ? Array.from(set) : [];
}

/** Forget every observation (the observer itself is disconnected by the caller). */
export function resetObserveTargets(): void {
    ioTargetOf.clear();
    ioProxied.clear();
}
