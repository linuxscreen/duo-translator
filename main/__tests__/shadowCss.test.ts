// @vitest-environment jsdom
//
// Tests for main/dom/shadowCss.ts — per-shadow-root stylesheet delivery.
//
// The load-bearing property is the *deferral*: discovery happens inside the
// marking scan, which reads computed style constantly, and injecting a sheet
// between two of those reads costs a forced style recalc every time (measured
// at ~2.9 ms per root on a Reddit post page with 391 roots). So a queued root
// must NOT be styled until someone flushes — and, just as importantly, it must
// never be forgotten, or its translations render with no CSS at all.
//
// jsdom has no `adoptedStyleSheets` (undefined on both document and roots), so
// `canAdopt` resolves false here and every assertion below reads the `<style>`
// carrier fallback. That is the Firefox path in production, and it is the only
// one observable from a unit test.
import { describe, it, expect, beforeEach } from "vitest";
import {
    flushShadowRootStyles,
    queueShadowRootStyle,
    removeShadowCss,
    resetShadowCss,
    setShadowCss,
    unstyleShadowRoot,
} from "@/main/dom/shadowCss";

const CSS = ".duo-translation{color:red}";

function makeRoot(connected = true): ShadowRoot {
    const host = document.createElement("div");
    if (connected) document.body.appendChild(host);
    return host.attachShadow({ mode: "open" });
}

function carrier(root: ShadowRoot): HTMLStyleElement | null {
    return root.querySelector("style[data-duo-shadow-css]");
}

describe("shadowCss batching", () => {
    beforeEach(() => {
        resetShadowCss();
        document.body.innerHTML = "";
        setShadowCss("translation", CSS);
    });

    it("does not touch a root until it is flushed", () => {
        const root = makeRoot();
        queueShadowRootStyle(root);
        expect(carrier(root)).toBeNull();

        flushShadowRootStyles();
        expect(carrier(root)?.textContent).toBe(CSS);
    });

    it("styles every root queued since the last flush", () => {
        const roots = [makeRoot(), makeRoot(), makeRoot()];
        for (const r of roots) queueShadowRootStyle(r);
        flushShadowRootStyles();
        for (const r of roots) expect(carrier(r)?.textContent).toBe(CSS);
    });

    it("drops a root that left the page while queued", () => {
        const root = makeRoot();
        queueShadowRootStyle(root);
        root.host.remove();
        flushShadowRootStyles();
        expect(carrier(root)).toBeNull();
    });

    it("forgets a root unstyled before the flush", () => {
        const root = makeRoot();
        queueShadowRootStyle(root);
        unstyleShadowRoot(root);
        flushShadowRootStyles();
        expect(carrier(root)).toBeNull();
    });

    // The queue holds no CSS of its own: a root queued before a colour change
    // must come out of the flush with the NEW css, not the one in force when it
    // was discovered. `setShadowCss` walks the already-styled roots only.
    it("applies the css in force at flush time, not at queue time", () => {
        const root = makeRoot();
        queueShadowRootStyle(root);
        setShadowCss("translation", ".duo-translation{color:blue}");
        flushShadowRootStyles();
        expect(carrier(root)?.textContent).toBe(".duo-translation{color:blue}");
    });

    it("keeps updating a root through setShadowCss once flushed", () => {
        const root = makeRoot();
        queueShadowRootStyle(root);
        flushShadowRootStyles();
        setShadowCss("translation", ".duo-translation{color:green}");
        expect(carrier(root)?.textContent).toBe(".duo-translation{color:green}");
    });

    it("re-queuing an already styled root is a no-op", () => {
        const root = makeRoot();
        queueShadowRootStyle(root);
        flushShadowRootStyles();
        const first = carrier(root);

        queueShadowRootStyle(root);
        flushShadowRootStyles();
        expect(carrier(root)).toBe(first);
    });

    it("removeShadowCss clears the carrier of a styled root", () => {
        const root = makeRoot();
        queueShadowRootStyle(root);
        flushShadowRootStyles();
        removeShadowCss("translation");
        expect(carrier(root)).toBeNull();
    });

    it("a flush with nothing queued does nothing", () => {
        expect(() => flushShadowRootStyles()).not.toThrow();
    });
});
