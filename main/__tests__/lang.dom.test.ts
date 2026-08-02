// @vitest-environment jsdom
//
// Tests for main/lang/detect.ts's DOM-driven detection: getElementTextContent
// and detectLanguage (including the Microsoft-translate fallback). The
// translation service registry and franc are mocked so the fallback and the
// sampling/threshold logic can be exercised deterministically.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFranc, mockMsDetect, mockIsVisible } = vi.hoisted(() => ({
    mockFranc: vi.fn(),
    mockMsDetect: vi.fn(),
    mockIsVisible: vi.fn(),
}));

vi.mock("franc", () => ({ franc: mockFranc }));
vi.mock("@/utils/language", () => ({ isTraditionalChinese: vi.fn(() => false) }));
// shuffle -> identity so the sampling order is deterministic in tests.
vi.mock("@/utils/arrays", () => ({ shuffle: (a: unknown[]) => a }));
// Provider-backed detection now goes to background through this one client
// function (the provider classes live in main/translateService.ts).
vi.mock("@/main/translateClient", () => ({
    detectTextsLanguage: mockMsDetect,
}));
// Visibility is a layout question and jsdom has no layout — the real predicate
// is pinned by visibility.test.ts (rules) and e2e (real boxes). Here it is a
// switch, so the sampling logic around it can be driven directly.
vi.mock("@/main/dom/visibility", () => ({ isVisibleForDetect: mockIsVisible }));

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
    // Implementation, not mockReturnValue: a return value would take precedence
    // over the per-test mockImplementation below (vitest 4 semantics).
    mockIsVisible.mockImplementation(() => true);
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
        expect(mockMsDetect).toHaveBeenCalledWith(["hola"]);
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

// ---------------------------------------------------------------------------
// Hidden text must not vote (main/dom/visibility.ts)
// ---------------------------------------------------------------------------
describe("detectLanguage — hidden text", () => {
    it("keeps hidden paragraphs out of the local franc vote", async () => {
        // Scoring is byte-weighted, so the hidden block would win outright.
        const visibleText = "b".repeat(600);
        const visibleEl = para(visibleText);
        const hiddenEl = para("a".repeat(5000));
        mockIsVisible.mockImplementation((el: HTMLElement) => el === visibleEl);
        mockFranc.mockReturnValue("eng");

        expect(await detectLanguage([hiddenEl, visibleEl])).toBe("en");
        // Only the visible text was ever scored.
        expect(mockFranc).toHaveBeenCalledTimes(1);
        expect(mockFranc).toHaveBeenCalledWith(visibleText, expect.anything());
    });

    it("sends only visible text to the provider fallback", async () => {
        const hiddenEl = para("a".repeat(5000));
        mockIsVisible.mockImplementation((el: HTMLElement) => el !== hiddenEl);
        mockMsDetect.mockResolvedValue("es");

        expect(await detectLanguage([hiddenEl, para("hola")])).toBe("es");
        expect(mockMsDetect).toHaveBeenCalledWith(["hola"]);
    });

    it("prefers short visible text over long hidden text", async () => {
        // Visible sample is below the local-detect threshold, so it goes to the
        // provider — it must NOT reach back for the long hidden block instead.
        const hiddenEl = para("a".repeat(5000));
        mockIsVisible.mockImplementation((el: HTMLElement) => el !== hiddenEl);
        mockMsDetect.mockResolvedValue("fr");

        expect(await detectLanguage([hiddenEl, para("bonjour tout le monde")])).toBe("fr");
        expect(mockFranc).not.toHaveBeenCalled();
        expect(mockMsDetect).toHaveBeenCalledWith(["bonjour tout le monde"]);
    });

    it("falls open to hidden text when nothing is visible", async () => {
        // A frame that was never laid out reports every element as boxless;
        // voting with hidden text beats returning "und".
        mockIsVisible.mockImplementation(() => false);
        mockFranc.mockReturnValue("eng");

        expect(await detectLanguage([para("a".repeat(600))])).toBe("en");
        expect(mockMsDetect).not.toHaveBeenCalled();
    });
});
