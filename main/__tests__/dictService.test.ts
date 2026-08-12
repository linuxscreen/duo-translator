import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupDict } from "@/main/dict/dictService";

// Provider tests mock global fetch and assert the real request, same as
// translateService.test.ts. IndexedDB is absent in jsdom, and dictCache
// swallows that — so every lookup here is a cache miss that goes to the
// network, which is exactly what we want to exercise.

function mockFetch(body: string | object, init?: { ok?: boolean; status?: number }) {
    const spy = vi.fn(async (url: string, _init?: RequestInit) => ({
        ok: init?.ok ?? true,
        status: init?.status ?? 200,
        statusText: "",
        text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
        json: async () => (typeof body === "string" ? JSON.parse(body) : body),
        headers: new Headers(),
    }));
    vi.stubGlobal("fetch", spy);
    return spy;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// A cut-down copy of the parts of Bing's dictionary page the parser anchors on.
const BING_HTML = `
<html><body>
<div id="headword" class="hd_div"><h1><strong>tool</strong></h1></div>
<div class="hd_area">
  <div class="hd_prUS b_primtxt">美 [tuːl]</div>
  <div class="hd_tf"><a href="javascript:void(0)" id="bigaud_us" class="bigaud" data-mp3link="/media/tool_us.mp3"></a></div>
  <div class="hd_pr b_primtxt">英 [tuːl]</div>
  <div class="hd_tf"><a href="javascript:void(0)" id="bigaud_uk" class="bigaud" data-mp3link="https://cdn.bing.com/tool_uk.mp3"></a></div>
</div>
<div class="qdef">
  <ul>
    <li><span class="pos">n.</span><span class="def b_regtxt"><span>工具；用具；器具</span></span></li>
    <li><span class="pos">v.</span><span class="def b_regtxt"><span>用工具加工</span></span></li>
  </ul>
</div>
<div id="sentenceSeg">
  <div class="se_li"><div class="sen_li">
    <div class="sen_en b_regtxt">A <b>tool</b> for the job.</div>
    <div class="sen_cn b_regtxt">适合这项工作的工具。</div>
  </div></div>
  <div class="se_li"><div class="sen_li">
    <div class="sen_en b_regtxt">Every <b>tool</b> has its use &amp; place.</div>
    <div class="sen_cn b_regtxt">每种工具都有其用途和位置。</div>
  </div></div>
</div>
</body></html>`;

describe("microsoft (Bing) dictionary", () => {
    it("extracts the headword, both accents, the senses and the bilingual examples", async () => {
        const spy = mockFetch(BING_HTML);
        const entry = await lookupDict("microsoft", "tools", "zh-CN");

        expect(spy).toHaveBeenCalledOnce();
        expect(spy.mock.calls[0][0]).toContain("bing.com/dict/search?q=tools");

        expect(entry).not.toBeNull();
        // The headword is the base form, not the query — that difference is the
        // reason the UI shows it at all.
        expect(entry!.word).toBe("tool");
        expect(entry!.query).toBe("tools");
        expect(entry!.provider).toBe("microsoft");

        // `hd_pr` vs `hd_prUS` share a prefix; the two must not cross over.
        expect(entry!.phonetics).toEqual([
            { accent: "uk", text: "tuːl", audio: "https://cdn.bing.com/tool_uk.mp3" },
            // A relative mp3 link is resolved against the Bing host.
            { accent: "us", text: "tuːl", audio: "https://www.bing.com/media/tool_us.mp3" },
        ]);

        expect(entry!.definitions).toEqual([
            { pos: "n.", senses: ["工具", "用具", "器具"] },
            { pos: "v.", senses: ["用工具加工"] },
        ]);

        expect(entry!.examples).toEqual([
            { source: "A tool for the job.", target: "适合这项工作的工具。" },
            // Entities decoded, <b> highlights stripped.
            { source: "Every tool has its use & place.", target: "每种工具都有其用途和位置。" },
        ]);
    });

    it("returns null — not an error — when the page has no entry", async () => {
        mockFetch("<html><body><div>no results</div></body></html>");
        await expect(lookupDict("microsoft", "asdfqwer", "zh-CN")).resolves.toBeNull();
    });

    it("returns null when the page shape changes out from under the parser", async () => {
        // A headword but nothing the extractors recognise: the dictionary is a
        // supplement, so a broken scrape must not take the popup down with it.
        mockFetch(`<div id="headword"><h1><strong>tool</strong></h1></div>`);
        await expect(lookupDict("microsoft", "tool", "zh-CN")).resolves.toBeNull();
    });

    it("throws with the provider, status and body when the request fails", async () => {
        mockFetch("blocked by anti-bot", { ok: false, status: 403 });
        await expect(lookupDict("microsoft", "tool", "zh-CN")).rejects.toThrow(
            /Bing Dictionary HTTP 403 \(www\.bing\.com\): blocked by anti-bot/,
        );
    });
});

describe("google dictionary", () => {
    // translate_a/single in dictionary mode — positional, no schema.
    const GOOGLE_BODY: any[] = [
        [["outil", "tool", null, null], [null, null, null, "toul"]],
        [
            ["nom", ["outil", "instrument"], [["outil", ["tool"], 0.9], ["instrument", ["tool"], 0.5]], 0.9],
            ["verbe", ["usiner"], [["usiner", ["tool"], 0.3]], 0.3],
        ],
        "en",
    ];

    it("maps the dictionary payload onto definitions, examples and romanization", async () => {
        const body = [...GOOGLE_BODY];
        body[13] = [[["A <b>tool</b> for the job."], ["Down <b>tools</b>."], ["A third one."]]];
        const spy = mockFetch(body);

        const entry = await lookupDict("google", "tool", "fr");

        const url = spy.mock.calls[0][0];
        expect(url).toContain("translate.google.com/translate_a/single");
        expect(url).toContain("tl=fr");
        expect(url).toContain("dt=bd");
        expect(url).toContain("dt=ex");

        expect(entry!.provider).toBe("google");
        expect(entry!.word).toBe("tool");
        expect(entry!.definitions).toEqual([
            { pos: "nom", senses: ["outil", "instrument"] },
            { pos: "verbe", senses: ["usiner"] },
        ]);
        // Every example the provider gave is cached; the UI does the trimming,
        // so changing how many are shown needs no re-fetch.
        expect(entry!.examples).toEqual([
            { source: "A tool for the job." },
            { source: "Down tools." },
            { source: "A third one." },
        ]);
        // No IPA from this endpoint — the romanization is all there is.
        expect(entry!.phonetics).toEqual([{ accent: "us", text: "toul" }]);
    });

    it("prefers a spelling correction as the headword", async () => {
        const body = [...GOOGLE_BODY];
        body[7] = ["<b><i>tool</i></b>", "tool"];
        mockFetch(body);
        const entry = await lookupDict("google", "toool", "fr");
        expect(entry!.word).toBe("tool");
        expect(entry!.query).toBe("toool");
    });

    it("reports the language Google detected — the basis for choosing a provider", async () => {
        // result[2]. Without it the popup would be back to guessing from the
        // spelling, which is what sent French "table"/"important" to Bing.
        mockFetch(GOOGLE_BODY);
        const entry = await lookupDict("google", "tool", "zh-CN");
        expect(entry!.sourceLang).toBe("en");
    });

    it("returns null when the response carries no dictionary section", async () => {
        // Plain translation mode: result[1] absent.
        mockFetch([[["outil", "tool", null, null]], null, "en"]);
        await expect(lookupDict("google", "tool", "fr")).resolves.toBeNull();
    });

    // The three sections below are what a lookup ACTUALLY gets on most pairs.
    // `result[1]` — the one both reference implementations read — is null for
    // English→English and for every non-English source, so reading only it
    // left the panel blank for exactly those. Shapes captured from the live
    // endpoint.

    it("falls back to alternative translations when there is no bilingual section", async () => {
        // fr → zh-CN, "exécutée": [1] and [13] are both null; the target-language
        // glosses live in [5] and the examples ride on the [12] definitions.
        mockFetch([
            [["被处决", "exécutée", null, null, 3], [null, null, "Bèi chǔjué"]],
            null,
            "fr", null, null,
            [["exécutée", null, [["被处决"], ["执行"]], [[0, 8]], "exécutée", 0, 0]],
            0.98, [], [["fr"]], null, null,
            [["动词", [[["accomplir"], "3010596444100043178"]], "exécuter", 2]],
            [["动词", [
                ["Mettre à effet, mener à accomplissement.", "3010", "Ce plan est difficile à exécuter."],
                ["Rendre effectif (un projet).", "6574", "Exécuter une fresque."],
            ], "exécuter", 2]],
            null,
            [["exécuter"]],
        ]);

        const entry = await lookupDict("google", "exécutée", "zh-CN");
        // The base form, which is the whole reason the headword is drawn.
        expect(entry!.word).toBe("exécuter");
        expect(entry!.query).toBe("exécutée");
        // Glosses in the TARGET language — [5], not [12]'s French definitions.
        expect(entry!.definitions).toEqual([{ pos: "", senses: ["被处决", "执行"] }]);
        expect(entry!.examples).toEqual([
            { source: "Ce plan est difficile à exécuter." },
            { source: "Exécuter une fresque." },
        ]);
    });

    it("uses the monolingual section for an English→English lookup", async () => {
        // en → en, "ubiquitous": [1] AND [5] are null — [12] is all there is.
        mockFetch([
            [["ubiquitous", "ubiquitous", null, null, 3], [null, null, null, "yo͞oˈbikwədəs"]],
            null,
            "en", null, null, null,
            1, [], [["en"]], null, null, null,
            [["adjective", [
                ["present, appearing, or found everywhere.", "m_en_1", "his ubiquitous influence"],
            ], "ubiquitous", 3]],
            [[["his <b>ubiquitous</b> influence was felt by all"], ["cowboy hats are <b>ubiquitous</b>"]]],
        ]);

        const entry = await lookupDict("google", "ubiquitous", "en");
        expect(entry!.definitions).toEqual([
            { pos: "adjective", senses: ["present, appearing, or found everywhere."] },
        ]);
        // [13] wins over the sentences embedded in [12] when both are present.
        expect(entry!.examples).toEqual([
            { source: "his ubiquitous influence was felt by all" },
            { source: "cowboy hats are ubiquitous" },
        ]);
        expect(entry!.phonetics).toEqual([{ accent: "us", text: "yo͞oˈbikwədəs" }]);
    });

    it("takes the lemma from whichever section carries it", async () => {
        // No [7] correction and no [1]: [12][0][2] answers.
        mockFetch([
            [["跑", "ran", null, null, 3]],
            null, "en", null, null, null, 1, [], [["en"]], null, null, null,
            [["动词", [["move at a speed faster than a walk.", "m_en_2"]], "run", 2]],
        ]);
        const entry = await lookupDict("google", "ran", "zh-CN");
        expect(entry!.word).toBe("run");
    });
});
