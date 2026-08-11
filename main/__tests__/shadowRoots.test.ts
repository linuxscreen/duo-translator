// @vitest-environment jsdom
//
// Tests for main/dom/shadowRoots.ts — the shadow-root registry.
//
// The ownership half is the load-bearing one: once the marking scan pierces
// shadow roots, a miss here means the extension translates its own interface and
// feeds its own UI copy into page-language detection.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    attachOwnShadow,
    deepQuerySelector,
    deepQuerySelectorAll,
    forgetRoot,
    forgetRootsUnder,
    isInOwnUi,
    isKnownRoot,
    isOwnHost,
    isOwnShadowRoot,
    knownRoots,
    noteElement,
    pageShadowRootOf,
    resetShadowRoots,
    startShadowDiscovery,
} from "@/main/dom/shadowRoots";

beforeEach(() => {
    resetShadowRoots();
    startShadowDiscovery({});
    document.body.innerHTML = "";
});

function pageHost(id: string, html = "<p>text</p>", parent: ParentNode = document.body) {
    const host = document.createElement("div");
    host.id = id;
    parent.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = html;
    return { host, root };
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------
describe("ownership", () => {
    it("attachOwnShadow registers host and root, and is idempotent", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);

        const root = attachOwnShadow(host);

        expect(isOwnHost(host)).toBe(true);
        expect(isOwnShadowRoot(root)).toBe(true);
        // Re-entrant mounts (workbench / selection popup) must reuse the root
        // rather than throw on a second attachShadow.
        expect(attachOwnShadow(host)).toBe(root);
    });

    it("hides our own root from discovery entirely", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        attachOwnShadow(host);

        expect(noteElement(host)).toBeNull();
        expect(pageShadowRootOf(host)).toBeNull();
        expect(knownRoots()).toEqual([]);
    });

    it("isInOwnUi answers true from deep inside a surface", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = attachOwnShadow(host);
        root.innerHTML = "<div class='duo-ai-root'><button><span>Translate</span></button></div>";
        const span = root.querySelector("span")!;

        expect(isInOwnUi(span)).toBe(true);
        expect(isInOwnUi(root)).toBe(true);
        expect(isInOwnUi(host)).toBe(true);
    });

    it("isInOwnUi answers false for page content, incl. page shadow content", () => {
        const { host, root } = pageHost("page");
        expect(isInOwnUi(host)).toBe(false);
        expect(isInOwnUi(root.querySelector("p"))).toBe(false);
        expect(isInOwnUi(document.body)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
describe("discovery", () => {
    it("registers a page root once and fires onRootAdded once", () => {
        const onRootAdded = vi.fn();
        startShadowDiscovery({ onRootAdded });
        const { host, root } = pageHost("page");

        expect(noteElement(host)).toBe(root);
        expect(noteElement(host)).toBe(root);

        expect(onRootAdded).toHaveBeenCalledTimes(1);
        expect(onRootAdded).toHaveBeenCalledWith(root, "scan");
        expect(isKnownRoot(root)).toBe(true);
        expect(knownRoots()).toEqual([root]);
    });

    it("tags the source so the caller knows whether to queue a scan", () => {
        // The marking scan is about to descend into what it found; a root the
        // bridge reports has never been looked at by anything.
        const onRootAdded = vi.fn();
        startShadowDiscovery({ onRootAdded });
        const { host: a } = pageHost("a");
        const { host: b } = pageHost("b");

        noteElement(a);
        noteElement(b, "bridge");

        expect(onRootAdded.mock.calls.map((c) => c[1])).toEqual(["scan", "bridge"]);
    });

    it("returns null for an element with no shadow root", () => {
        document.body.innerHTML = "<div id='plain'></div>";
        expect(noteElement(document.getElementById("plain")!)).toBeNull();
    });

    it("registers nested roots independently", () => {
        const { host: outer, root: outerRoot } = pageHost("outer", "<div id='inner'></div>");
        const inner = outerRoot.getElementById("inner")!;
        const innerRoot = inner.attachShadow({ mode: "open" });

        noteElement(outer);
        noteElement(inner);

        expect(knownRoots()).toEqual([outerRoot, innerRoot]);
    });

    it("pageShadowRootOf reads without registering", () => {
        const { host, root } = pageHost("page");
        expect(pageShadowRootOf(host)).toBe(root);
        expect(isKnownRoot(root)).toBe(false);
    });

    it("knownRoots sweeps roots whose host left the document", () => {
        const onRootRemoved = vi.fn();
        startShadowDiscovery({ onRootRemoved });
        const { host, root } = pageHost("page");
        noteElement(host);

        host.remove();

        expect(knownRoots()).toEqual([]);
        expect(onRootRemoved).toHaveBeenCalledWith(root);
        expect(isKnownRoot(root)).toBe(false);
    });

    it("forgetRoot fires the removal handler exactly once", () => {
        const onRootRemoved = vi.fn();
        startShadowDiscovery({ onRootRemoved });
        const { host, root } = pageHost("page");
        noteElement(host);

        forgetRoot(root);
        forgetRoot(root);

        expect(onRootRemoved).toHaveBeenCalledTimes(1);
    });

    it("forgetRootsUnder drops roots inside a removed subtree", () => {
        document.body.innerHTML = "<section id='wrap'></section>";
        const wrap = document.getElementById("wrap")!;
        const { host: inside, root: insideRoot } = pageHost("inside", "<p>a</p>", wrap);
        const { host: outside, root: outsideRoot } = pageHost("outside");
        noteElement(inside);
        noteElement(outside);

        // Native contains cannot see into the root, which is why the registry
        // uses the deep test — the host itself is what lives under `wrap`.
        forgetRootsUnder(wrap);

        expect(isKnownRoot(insideRoot)).toBe(false);
        expect(isKnownRoot(outsideRoot)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Deep queries
// ---------------------------------------------------------------------------
describe("deepQuerySelector(All)", () => {
    it("finds matches in the light DOM and in registered roots", () => {
        document.body.innerHTML = "<p class='hit' id='light'>a</p>";
        const { host } = pageHost("page", "<p class='hit' id='shadow'>b</p>");
        noteElement(host);

        const all = deepQuerySelectorAll(".hit");
        expect(all.map((e) => e.id)).toEqual(["light", "shadow"]);
        expect(deepQuerySelector("#shadow")).not.toBeNull();
    });

    it("does not see unregistered roots", () => {
        pageHost("page", "<p class='hit' id='shadow'>b</p>");
        expect(deepQuerySelectorAll(".hit")).toEqual([]);
    });

    it("honours a scope, excluding roots hosted outside it", () => {
        document.body.innerHTML = "<section id='wrap'></section>";
        const wrap = document.getElementById("wrap")!;
        const { host: inside } = pageHost("inside", "<p class='hit' id='in'>a</p>", wrap);
        const { host: outside } = pageHost("outside", "<p class='hit' id='out'>b</p>");
        noteElement(inside);
        noteElement(outside);

        expect(deepQuerySelectorAll(".hit", wrap).map((e) => e.id)).toEqual(["in"]);
    });

    it("degrades to a miss on an invalid selector instead of throwing", () => {
        const { host } = pageHost("page");
        noteElement(host);
        expect(deepQuerySelectorAll(":::bad")).toEqual([]);
        expect(deepQuerySelector(":::bad")).toBeNull();
    });
});
