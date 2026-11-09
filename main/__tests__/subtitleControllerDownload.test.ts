// @vitest-environment jsdom
// Exercise the controller's download callback through to the SRT payload.
// The YouTube track and background reply are local fixtures; no API is called.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
    config: new Map<string, unknown>(),
    send: vi.fn(),
    save: vi.fn(),
    report: vi.fn(),
    availability: vi.fn(),
    onDownload: undefined as ((kind: "bilingual" | "original" | "translation") => void) | undefined,
    original: "Tom & Jerry <b0>literal</b0> &amp;",
}));

vi.mock("@/utils/message", () => ({
    sendMessageToBackground: fixtures.send,
    sendMessageToBackgroundOrThrow: fixtures.send,
}));
vi.mock("@/utils/db", () => ({ getConfig: vi.fn(), setConfig: vi.fn() }));
vi.mock("@/utils/language", () => ({ isTraditionalChinese: () => false }));
vi.mock("@/utils/reactiveConfig", async () => {
    const { configDefault } = await import("@/main/constants");
    return {
        readConfig: async (key: string) => fixtures.config.has(key) ? fixtures.config.get(key) : configDefault(key),
    };
});
vi.mock("@/main/errorReport", () => ({ ERROR_SCOPE: { SUBTITLE: "subtitle" }, reportRequestError: fixtures.report }));
vi.mock("@/main/videoSubtitle/download", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/main/videoSubtitle/download")>(),
    downloadTextFile: fixtures.save,
}));
vi.mock("@/main/videoSubtitle/controls", () => ({
    mountSubtitleControls: (options: { onDownload: typeof fixtures.onDownload }) => {
        fixtures.onDownload = options.onDownload;
        return {
            destroy: vi.fn(), ensureButton: vi.fn(), setEnabled: vi.fn(),
            setDownloadState: vi.fn(), setAvailability: fixtures.availability,
            setSourceTracks: vi.fn(), setPinnedSourceLanguage: vi.fn(), setLanguageOverride: vi.fn(),
        };
    },
}));
vi.mock("@/main/videoSubtitle/overlay", () => ({
    SubtitleOverlay: class {
        private readonly box = document.createElement("div");
        constructor(player: HTMLElement) { this.box.id = "duo-video-subtitle-box"; player.append(this.box); }
        destroy() { this.box.remove(); }
        hide() { }
        show() { }
        setMode() { }
        setStyle() { }
        setPauseOnSelect() { }
        setDictContext() { }
        setPosition() { }
    },
}));
vi.mock("@/main/videoSubtitle/youtube", () => ({
    currentYoutubeVideoId: () => "fixture-video",
    YoutubeAdapter: class {
        async waitForPlayerData() { return { isLive: false }; }
        setPlayerData() { }
        async listTracks() { return [{ id: "en", languageCode: "en", label: "English", auto: false }]; }
        sourceOptions() { return []; }
        pickTrack(tracks: unknown[]) { return tracks[0]; }
        async fetchTrack() { return [{ startMs: 0, endMs: 1000, text: fixtures.original, cueEnd: true }]; }
    },
}));

import { ACTION, CONFIG_KEY, TRANSLATE_SERVICE } from "@/main/constants";
import { initVideoSubtitle, type VideoSubtitleController } from "@/main/videoSubtitle";

let controller: VideoSubtitleController | undefined;

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    fixtures.config.clear();
    fixtures.onDownload = undefined;
    fixtures.config.set(CONFIG_KEY.VIDEO_SUBTITLE_SWITCH, true);
    // A download must also work with the live overlay disabled.
    fixtures.config.set(CONFIG_KEY.VIDEO_SUBTITLE_AUTO_ENABLE, false);
    fixtures.config.set(CONFIG_KEY.VIDEO_SUBTITLE_FOLLOW_NATIVE_CC, false);
    fixtures.config.set(CONFIG_KEY.VIDEO_SUBTITLE_AI_SEGMENT, false);
    fixtures.config.set(CONFIG_KEY.VIDEO_SUBTITLE_TARGET_LANGUAGE, "zh-CN");
    fixtures.config.set(CONFIG_KEY.VIDEO_SUBTITLE_TRANSLATE_SERVICE, TRANSLATE_SERVICE.BAIDU);
    fixtures.config.set(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES, []);
    fixtures.config.set(CONFIG_KEY.NO_TRANSLATE_LANGUAGES, []);
    document.body.innerHTML = '<div id="movie_player"><video></video></div>';
    document.title = "Fixture - YouTube";
});

afterEach(() => {
    controller?.destroy();
    controller = undefined;
    vi.useRealTimers();
});

async function download(kind: "bilingual" | "translation") {
    controller = initVideoSubtitle();
    await vi.waitFor(() => expect(fixtures.availability).toHaveBeenCalledWith("loading"));
    fixtures.onDownload!(kind);
    await vi.waitFor(() => expect(fixtures.save).toHaveBeenCalledTimes(1));
    expect(fixtures.report).not.toHaveBeenCalled();
    return fixtures.save.mock.calls[0][1] as string;
}

describe("subtitle controller download", () => {
    it.each(["translation", "bilingual"] as const)("decodes Baidu once in a %s SRT while preserving literal tags and entities", async (kind) => {
        fixtures.send.mockResolvedValue([{
            translatedMappedHtmlText: "汤姆 &amp; 杰瑞 &lt;b0&gt;文字&lt;/b0&gt; &lt;tag&gt; &amp;amp;",
            sourceLang: "en", score: 1,
        }]);

        const srt = await download(kind);

        expect(fixtures.send).toHaveBeenCalledTimes(1);
        expect(fixtures.send.mock.calls[0][0]).toMatchObject({
            action: ACTION.TRANSLATE_TEXTS,
            data: { service: TRANSLATE_SERVICE.BAIDU, texts: ["Tom &amp; Jerry &lt;b0&gt;literal&lt;/b0&gt; &amp;amp;"] },
        });
        const lines = kind === "bilingual" ? `${fixtures.original}\n` : "";
        expect(srt).toBe(`1\n00:00:00,000 --> 00:00:01,000\n${lines}汤姆 & 杰瑞 <b0>文字</b0> <tag> &amp;\n`);
    });

    it("keeps existing HTML cleanup for other providers", async () => {
        fixtures.config.set(CONFIG_KEY.VIDEO_SUBTITLE_TRANSLATE_SERVICE, TRANSLATE_SERVICE.GOOGLE);
        fixtures.send.mockResolvedValue([{
            translatedMappedHtmlText: "<b>汤姆 &amp; 杰瑞</b> &lt;tag&gt; &amp;amp;", sourceLang: "en", score: 1,
        }]);

        const srt = await download("translation");

        expect(fixtures.send.mock.calls[0][0].data.texts).toEqual([fixtures.original]);
        expect(srt).toBe("1\n00:00:00,000 --> 00:00:01,000\n汤姆 & 杰瑞 <tag> &amp;\n");
    });
});
