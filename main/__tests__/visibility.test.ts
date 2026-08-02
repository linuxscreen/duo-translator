// Geometry rules behind the detection-only visibility filter
// (main/dom/visibility.ts). Only the pure `classifyRect` is covered here: jsdom
// has no layout, so every real rect it produces is 0×0 — the DOM wrapper's
// behaviour on real boxes belongs to e2e (translate.hidden-text.spec.ts).
import { describe, it, expect } from "vitest";
import { classifyRect, rectsOverlap, type RectLike } from "@/main/dom/visibility";

/** A rect from its top-left corner and size, the way layout reports one. */
function rect(left: number, top: number, width: number, height: number): RectLike {
    return { left, top, width, height, right: left + width, bottom: top + height };
}

describe("classifyRect", () => {
    it("accepts an ordinary box", () => {
        expect(classifyRect(rect(0, 0, 600, 20), 0, 0)).toBe("visible");
    });

    it("accepts a box below the fold — that is scrolling, not hiding", () => {
        expect(classifyRect(rect(0, 5000, 600, 20), 0, 0)).toBe("visible");
    });

    it("accepts a box already scrolled past", () => {
        // Scrolled down 4000px: viewport-negative, document-positive.
        expect(classifyRect(rect(0, -3000, 600, 20), 0, 4000)).toBe("visible");
    });

    it("rejects the 1x1 clipped .sr-only box", () => {
        expect(classifyRect(rect(0, 0, 1, 1), 0, 0)).toBe("hidden");
    });

    it("rejects a zero-height line box (font-size:0, height:0;overflow:hidden)", () => {
        expect(classifyRect(rect(0, 0, 600, 0), 0, 0)).toBe("hidden");
    });

    it("rejects a box parked left of the document", () => {
        expect(classifyRect(rect(-9999, 100, 300, 20), 0, 0)).toBe("hidden");
    });

    it("rejects a box parked above the document", () => {
        expect(classifyRect(rect(0, -9999, 300, 20), 0, 0)).toBe("hidden");
    });

    it("keeps a box that only partially overhangs the left edge", () => {
        expect(classifyRect(rect(-100, 100, 300, 20), 0, 0)).toBe("visible");
    });

    it("reports no-box for a 0x0 rect so the caller can re-ask with the content rect", () => {
        // display:contents — no principal box, but its text is laid out.
        expect(classifyRect(rect(0, 0, 0, 0), 0, 0)).toBe("no-box");
    });
});

// Clipping ancestors — the child of a collapsed panel keeps its full natural
// box, so only the clip rect reveals that nothing is readable.
describe("rectsOverlap", () => {
    it("accepts content inside its clipping ancestor", () => {
        expect(rectsOverlap(rect(0, 100, 600, 20), rect(0, 0, 600, 400))).toBe(true);
    });

    it("rejects content in a collapsed (height:0;overflow:hidden) panel", () => {
        expect(rectsOverlap(rect(0, 100, 600, 300), rect(0, 100, 600, 0))).toBe(false);
    });

    it("rejects content scrolled out of its clipping ancestor", () => {
        expect(rectsOverlap(rect(0, 900, 600, 20), rect(0, 0, 600, 400))).toBe(false);
    });

    it("accepts content only partially inside the clip box", () => {
        expect(rectsOverlap(rect(0, 380, 600, 100), rect(0, 0, 600, 400))).toBe(true);
    });

    it("rejects a sliver of overlap thinner than a glyph", () => {
        expect(rectsOverlap(rect(0, 399, 600, 100), rect(0, 0, 600, 400))).toBe(false);
    });
});
