// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendStub } = vi.hoisted(() => ({ sendStub: vi.fn() }));
vi.mock("@/utils/message", () => ({
    sendMessageToBackground: sendStub,
    sendMessageToBackgroundOrThrow: sendStub,
}));
vi.mock("@/utils/db", () => ({ getConfig: vi.fn(async () => undefined) }));
vi.mock("@/utils/language", () => ({ isTraditionalChinese: vi.fn(() => false) }));
vi.mock("@/main/aiClient", () => ({ startAiChatStream: vi.fn() }));

import { ACTION, TRANSLATE_SERVICE, VIEW_STRATEGY } from "@/main/constants";
import { getTranslateResult, preparePlainTranslationTexts, readPlainTranslationText } from "@/main/translateClient";
import { startTranslate } from "@/main/aiWriting/translateRunner";
import { buildSrt } from "@/main/videoSubtitle/download";

beforeEach(() => {
    sendStub.mockReset();
    document.body.innerHTML = "";
});

describe("Baidu plain-text surfaces", () => {
    it("escapes literal markup and entities once without changing other providers", () => {
        const texts = ["Tom & Jerry <b0>literal</b0> &amp;"];
        expect(preparePlainTranslationTexts(TRANSLATE_SERVICE.BAIDU, texts)).toEqual([
            "Tom &amp; Jerry &lt;b0&gt;literal&lt;/b0&gt; &amp;amp;",
        ]);
        expect(preparePlainTranslationTexts(TRANSLATE_SERVICE.GOOGLE, texts)).toBe(texts);
        expect(readPlainTranslationText(TRANSLATE_SERVICE.GOOGLE, "A &amp; B")).toBe("A &amp; B");
    });

    it("writes decoded text to an input stream while preserving a literal entity", async () => {
        sendStub.mockResolvedValue([
            { translatedMappedHtmlText: "汤姆 &amp; 杰瑞 &lt;b0&gt;文字&lt;/b0&gt; &amp;amp;", sourceLang: "en", score: 1 },
        ]);
        const running = startTranslate("Tom & Jerry <b0>literal</b0> &amp;", "zh-CN", {
            kind: "trans", service: TRANSLATE_SERVICE.BAIDU,
        });
        const output = [];
        for await (const part of running.stream) output.push(part);
        expect(output).toEqual(["汤姆 & 杰瑞 <b0>文字</b0> &amp;"]);
        expect(sendStub.mock.calls[0][0].data.texts).toEqual([
            "Tom &amp; Jerry &lt;b0&gt;literal&lt;/b0&gt; &amp;amp;",
        ]);
    });

    it.each(["abort", "return"] as const)("cancels the original background request when the runner uses %s", async (stop) => {
        let rejectTranslation!: (error: Error) => void;
        sendStub.mockImplementation((message) => {
            if (message.action === ACTION.TRANSLATE_TEXTS) {
                return new Promise((_resolve, reject) => { rejectTranslation = reject; });
            }
            if (message.action === ACTION.TRANSLATE_TEXTS_ABORT) {
                rejectTranslation(new DOMException("Aborted", "AbortError"));
            }
            return Promise.resolve(undefined);
        });
        const onSourceLang = vi.fn();
        const running = startTranslate("queued text", "zh-CN", {
            kind: "trans", service: TRANSLATE_SERVICE.BAIDU,
        }, onSourceLang);
        const iterator = running.stream[Symbol.asyncIterator]();
        const pending = iterator.next();
        const requestId = sendStub.mock.calls[0][0].data.requestId;
        if (stop === "abort") running.abort();
        else await iterator.return!();

        await expect(pending).resolves.toMatchObject({ done: true });
        expect(sendStub.mock.calls[1][0]).toEqual({
            action: ACTION.TRANSLATE_TEXTS_ABORT, data: { requestId },
        });
        expect(onSourceLang).not.toHaveBeenCalled();
        await expect(iterator.next()).resolves.toMatchObject({ done: true });
    });

    it("does not start a background request after being stopped before iteration", async () => {
        const running = startTranslate("queued text", "zh-CN", {
            kind: "trans", service: TRANSLATE_SERVICE.BAIDU,
        });
        running.abort();
        await expect(running.stream[Symbol.asyncIterator]().next()).resolves.toMatchObject({ done: true });
        expect(sendStub).not.toHaveBeenCalled();
    });

    it("decodes live captions once and leaves download output encoded until SRT formatting", () => {
        const encoded = "A &amp; B &lt;tag&gt; &amp;amp;";
        expect(readPlainTranslationText(TRANSLATE_SERVICE.BAIDU, encoded)).toBe("A & B <tag> &amp;");
        const srt = buildSrt([{ startMs: 0, endMs: 1000, text: "original", translated: encoded }], "translation");
        expect(srt).toContain("A & B <tag> &amp;");
    });

    it("passes webpage mapping tags to background without treating them as literal text", async () => {
        document.body.innerHTML = "<p>Hello <strong>world</strong> &amp; friends</p>";
        sendStub.mockImplementation(async (message) => message.data.texts.map((text: string) => ({
            translatedMappedHtmlText: text, sourceLang: "en", score: 1,
        })));
        await getTranslateResult(TRANSLATE_SERVICE.BAIDU, [document.querySelector("p")!], "zh-CN", VIEW_STRATEGY.SINGLE);
        expect(sendStub.mock.calls[0][0].data.texts).toEqual(["Hello <b0>world</b0> &amp; friends"]);
    });
});
