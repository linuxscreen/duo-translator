// @vitest-environment jsdom
//
// Tests for main/lang/detect.ts's DOM-driven detection: getElementTextContent
// and detectLanguage (including the Microsoft-translate fallback). The
// translation service registry and franc are mocked so the fallback and the
// sampling/threshold logic can be exercised deterministically.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFranc, mockMsDetect } = vi.hoisted(() => ({
    mockFranc: vi.fn(),
    mockMsDetect: vi.fn(),
}));

vi.mock("franc", () => ({ franc: mockFranc }));
vi.mock("@/utils/language", () => ({ isTraditionalChinese: vi.fn(() => false) }));
// shuffle -> identity so the sampling order is deterministic in tests.
vi.mock("@/utils/arrays", () => ({ shuffle: (a: unknown[]) => a }));
// Only `translationServices` is consumed by detect.ts — provide a registry
// whose "microsoft" entry exposes a controllable detectLanguage().
vi.mock("@/main/translateService", () => ({
    translationServices: new Map([["microsoft", { detectLanguage: mockMsDetect }]]),
}));

import { getElementTextContent, detectLanguage } from "@/main/lang";

function el(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLElement;
}

/** A paragraph whose text content is exactly `text`. */
function para(text: string): HTMLElement {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
}

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// getElementTextContent
// ---------------------------------------------------------------------------
describe("getElementTextContent", () => {
    it("concatenates trimmed text from the subtree", () => {
        expect(getElementTextContent(el("<p>Hello <b>world</b></p>"))).toBe("Helloworld");
    });

    it("skips excluded tags (script/style)", () => {
        expect(getElementTextContent(el("<p>Hi<script>x()</script><style>a{}</style></p>"))).toBe("Hi");
    });
});

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------
describe("detectLanguage", () => {
    it("returns 'und' for an empty element list without hitting the network", async () => {
        expect(await detectLanguage([])).toBe("und");
        expect(mockMsDetect).not.toHaveBeenCalled();
    });

    it("uses the local franc result when there is enough text (>500 bytes)", async () => {
        mockFranc.mockReturnValue("eng");
        const long = para("a".repeat(600));
        const lang = await detectLanguage([long]);
        expect(lang).toBe("en");
        expect(mockMsDetect).not.toHaveBeenCalled();
    });

    it("falls back to the Microsoft detect service for short text", async () => {
        mockMsDetect.mockResolvedValue("es");
        const lang = await detectLanguage([para("hola")]);
        expect(lang).toBe("es");
        // text is the element content plus the per-element newline separator.
        expect(mockMsDetect).toHaveBeenCalledWith(["hola\n"]);
    });

    it("returns 'und' when the Microsoft fallback rejects", async () => {
        mockMsDetect.mockRejectedValue(new Error("network"));
        expect(await detectLanguage([para("bonjour")])).toBe("und");
    });

    it("returns 'und' when the Microsoft fallback yields nothing", async () => {
        mockMsDetect.mockResolvedValue("");
        expect(await detectLanguage([para("ciao")])).toBe("und");
    });
});
