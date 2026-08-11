// @vitest-environment jsdom
//
// main/dom/observeTargets.ts — the IntersectionObserver host proxy.
//
// The refcount is the whole point: one element can stand in for several
// containers, and without it unobserving one silently stops delivery for the
// others. The proxy only climbs past `display: contents` (which generates no box
// and so can never report isIntersecting) — jsdom resolves that from inline
// styles, which is all these tests need.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    containersFor,
    observeContainer,
    resetObserveTargets,
    unobserveContainer,
} from "@/main/dom/observeTargets";

function fakeObserver() {
    return {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
    } as unknown as IntersectionObserver & { observe: ReturnType<typeof vi.fn>; unobserve: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
    resetObserveTargets();
    document.body.innerHTML = "";
});

describe("observeContainer / unobserveContainer", () => {
    it("observes an element container directly, once", () => {
        const io = fakeObserver();
        document.body.innerHTML = "<p id='a'>x</p>";
        const p = document.getElementById("a")!;

        observeContainer(io, p);
        observeContainer(io, p);

        expect(io.observe).toHaveBeenCalledTimes(1);
        expect(io.observe).toHaveBeenCalledWith(p);
        expect(containersFor(p)).toEqual([p]);
    });

    it("observes a ShadowRoot container through its host", () => {
        const io = fakeObserver();
        document.body.innerHTML = "<div id='h'></div>";
        const host = document.getElementById("h")!;
        const root = host.attachShadow({ mode: "open" });

        observeContainer(io, root);

        expect(io.observe).toHaveBeenCalledWith(host);
        expect(containersFor(host)).toEqual([root]);
    });

    it("refcounts: one target, two containers", () => {
        // The real shape: a host that is itself a paragraph container (slotted
        // light children) AND the proxy for its own shadow root.
        const io = fakeObserver();
        document.body.innerHTML = "<div id='h'>slotted</div>";
        const host = document.getElementById("h")!;
        const root = host.attachShadow({ mode: "open" });

        observeContainer(io, host);
        observeContainer(io, root);
        expect(io.observe).toHaveBeenCalledTimes(1);
        expect(containersFor(host)).toEqual([host, root]);

        // Dropping one must NOT stop delivery for the other.
        unobserveContainer(io, root);
        expect(io.unobserve).not.toHaveBeenCalled();
        expect(containersFor(host)).toEqual([host]);

        unobserveContainer(io, host);
        expect(io.unobserve).toHaveBeenCalledTimes(1);
        expect(io.unobserve).toHaveBeenCalledWith(host);
        expect(containersFor(host)).toEqual([]);
    });

    it("climbs past a display:contents host to a real box", () => {
        const io = fakeObserver();
        document.body.innerHTML = "<section id='outer'><div id='h' style='display:contents'></div></section>";
        const host = document.getElementById("h")!;
        const outer = document.getElementById("outer")!;
        const root = host.attachShadow({ mode: "open" });

        observeContainer(io, root);

        expect(io.observe).toHaveBeenCalledWith(outer);
        expect(containersFor(outer)).toEqual([root]);
    });

    it("does NOT climb past a display:none element", () => {
        // A collapsed panel must stay observed on itself so it fires when the
        // page reveals it; climbing would translate hidden content at once.
        const io = fakeObserver();
        document.body.innerHTML = "<section id='outer'><p id='p' style='display:none'>x</p></section>";
        const p = document.getElementById("p")!;

        observeContainer(io, p);

        expect(io.observe).toHaveBeenCalledWith(p);
    });

    it("unobserving something never observed is a no-op", () => {
        const io = fakeObserver();
        document.body.innerHTML = "<p id='a'>x</p>";
        unobserveContainer(io, document.getElementById("a")!);
        expect(io.unobserve).not.toHaveBeenCalled();
    });

    it("resetObserveTargets forgets everything", () => {
        const io = fakeObserver();
        document.body.innerHTML = "<p id='a'>x</p>";
        const p = document.getElementById("a")!;
        observeContainer(io, p);

        resetObserveTargets();

        expect(containersFor(p)).toEqual([]);
        // A fresh observe after a reset registers again.
        observeContainer(io, p);
        expect(io.observe).toHaveBeenCalledTimes(2);
    });
});
