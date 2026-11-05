import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { baiduMd5 } from "@/main/baiduMd5";
import type { BaiduTranslator, BaiduCredentials } from "@/main/baiduTranslator";

const { mockConfigGet, mockUiLanguage } = vi.hoisted(() => ({
    mockConfigGet: vi.fn<(_key: string) => Promise<unknown>>(),
    mockUiLanguage: vi.fn<() => string>(),
}));
vi.mock("@/main/storage/configStore", () => ({ configRepo: { get: mockConfigGet } }));
vi.mock("wxt/browser", () => ({ browser: { i18n: { getUILanguage: mockUiLanguage } } }));

const credentials: BaiduCredentials = { appId: "20261028000000000000", secretKey: "test-secret-not-real", qps: 100 };
const mockFetch = vi.fn<typeof fetch>();
let Translator: typeof BaiduTranslator;

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function body(init?: RequestInit): URLSearchParams {
    return new URLSearchParams(init?.body as string);
}
function service(overrides: Partial<BaiduCredentials> = {}): BaiduTranslator {
    return new Translator(async () => ({ ...credentials, ...overrides }));
}
function echo(form: URLSearchParams, from = "en"): Response {
    return response({ from, trans_result: form.get("q")!.split("\n").map(src => ({ src, dst: "译:" + src })) });
}
async function finish<T>(pending: Promise<T>): Promise<T> {
    // Attach the rejection handler before fake timers run an abort/timeout.
    const settled = pending.then(value => ({ value }), error => ({ error }));
    await vi.runAllTimersAsync();
    const result = await settled;
    if ("error" in result) throw result.error;
    return result.value;
}

beforeEach(async () => {
    vi.resetModules(); // a fresh process-wide rate limiter for each test
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    // Neither the machine's UI language nor persisted extension settings can
    // change these provider assertions. Individual locale tests opt in below.
    mockConfigGet.mockReset().mockResolvedValue(undefined);
    mockUiLanguage.mockReset().mockReturnValue("en");
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (_url, init) => echo(body(init)));
    vi.stubGlobal("fetch", mockFetch);
    ({ BaiduTranslator: Translator } = await import("@/main/baiduTranslator"));
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("Baidu signatures and request protocol", () => {
    it("matches the official signature example and UTF-8 padding boundaries", () => {
        expect(baiduMd5("2015063000000001apple143566028812345678")).toBe("f89f9594663708c1605f3d736d01d2d4");
        for (const size of [0, 1, 55, 56, 57, 63, 64, 65, 127, 128, 1024]) {
            const text = "中文😀<&>".repeat(size);
            expect(baiduMd5(text)).toBe(createHash("md5").update(text).digest("hex"));
        }
    });

    it("signs the unencoded query, posts a form, and keeps the secret out of the request", async () => {
        mockFetch.mockResolvedValue(response({ from: "jp", trans_result: [{ src: "猫 & fish", dst: "猫和鱼" }] }));
        const results = await finish(service().translateText(["猫 &amp; fish"], "zh-TW", undefined, "ja"));
        expect(results).toEqual([{ text: "猫和鱼", sourceLang: "ja" }]);
        const [url, init] = mockFetch.mock.calls[0];
        const form = body(init);
        expect(url).toBe("https://fanyi-api.baidu.com/api/trans/vip/translate");
        expect(init?.method).toBe("POST");
        expect(init?.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" });
        expect(form.get("q")).toBe("猫 & fish");
        expect(form.get("from")).toBe("jp");
        expect(form.get("to")).toBe("cht");
        expect(form.get("appid")).toBe(credentials.appId);
        expect(form.get("sign")).toBe(createHash("md5")
            .update(credentials.appId + form.get("q") + form.get("salt") + credentials.secretKey).digest("hex"));
        expect(init?.body).not.toContain(credentials.secretKey);
        expect(init?.credentials).toBe("omit");
        expect(init?.referrerPolicy).toBe("no-referrer");
    });

    it("rejects missing credentials and unsupported languages before fetching", async () => {
        await expect(service({ secretKey: "" }).translateText(["hello"], "en")).rejects.toThrow("Enter your Baidu AppID and secret key.");
        await expect(service().translateText(["hello"], "invalid")).rejects.toThrow("Baidu Translate does not yet support this target language: invalid");
        await expect(service().translateText(["hello"], "en", undefined, "invalid")).rejects.toThrow("Baidu Translate does not yet support this source language: invalid");
        expect(mockFetch).not.toHaveBeenCalled();
    });
});

describe("Baidu error interface language", () => {
    it.each([
        ["en", "zh-CN", "Enter your Baidu AppID and secret key."],
        ["zh-CN", "en", "请填写百度翻译 AppID 和密钥。"],
        [undefined, "zh-CN", "请填写百度翻译 AppID 和密钥。"],
        ["ja", "zh-CN", "Enter your Baidu AppID and secret key."],
        ["invalid", "en", "Enter your Baidu AppID and secret key."],
    ] as const)("uses stored locale %s with browser locale %s and English fallback", async (stored, browserLanguage, expected) => {
        mockConfigGet.mockResolvedValue(stored);
        mockUiLanguage.mockReturnValue(browserLanguage);
        await expect(service({ secretKey: "" }).translateText(["hello"], "en")).rejects.toThrow(expected);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("reads a changed setting for the next call and preserves provider error codes", async () => {
        mockConfigGet.mockResolvedValue("zh-CN");
        mockFetch.mockImplementation(async () => response({ error_code: "54001", error_msg: "raw provider message" }));
        const translator = service();
        await expect(finish(translator.translateText(["hello"], "en"))).rejects.toThrow("百度翻译 54001：签名错误，请检查 AppID 和密钥。");
        mockConfigGet.mockResolvedValue("en");
        await expect(finish(translator.translateText(["hello"], "en"))).rejects.toThrow("Baidu Translate 54001: The signature is invalid. Check your AppID and secret key.");
    });

    it("localizes unknown API errors without displaying raw provider messages", async () => {
        mockConfigGet.mockResolvedValue("zh-CN");
        mockFetch.mockResolvedValue(response({ error_code: "99999", error_msg: "raw provider message" }));
        await expect(finish(service().translateText(["hello"], "en"))).rejects.toThrow("百度翻译 99999：接口调用失败，请查看百度控制台。");
    });
});

describe("Baidu batch and inline element preservation", () => {
    it("translates complete lines for context and escapes everything except verified inline markers", async () => {
        mockFetch.mockResolvedValue(response({ from: "en", trans_result: [{
            dst: '请看 <b0>Tom & Jerry</b0> & <script>alert(1)</script>',
        }] }));
        const [result] = await finish(service().translateText(["  See <b0>Tom &amp; Jerry</b0>  \n\n"], "zh-CN"));
        expect(body(mockFetch.mock.calls[0][1]).get("q")).toBe("See <b0>Tom & Jerry</b0>");
        expect(result.text).toBe("  请看 <b0>Tom &amp; Jerry</b0> &amp; &lt;script&gt;alert(1)&lt;/script&gt;  \n\n");
        expect(result.sourceLang).toBe("en");
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("retries only text spans when Baidu discards or reorders the inline element map", async () => {
        mockFetch.mockImplementation(async (_url, init) => {
            const form = body(init);
            if (form.get("q")!.includes("<b0>")) return response({ from: "en", trans_result: [{ dst: "你好世界" }] });
            return echo(form);
        });
        const [result] = await finish(service().translateText(["Hello <b0>world</b0>!"], "zh-CN"));
        expect(result.text).toBe("译:Hello <b0>译:world</b0>译:!");
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(body(mockFetch.mock.calls[1][1]).get("q")).toBe("Hello\nworld\n!");
    });

    it("keeps output aligned when a multiline response has the wrong number of rows", async () => {
        mockFetch.mockImplementation(async (_url, init) => {
            const form = body(init);
            return form.get("q")!.includes("\n")
                ? response({ from: "en", trans_result: [{ dst: "merged" }] }) : echo(form);
        });
        const results = await finish(service().translateText(["first", "second"], "en"));
        expect(results.map(result => result.text)).toEqual(["译:first", "译:second"]);
        expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("splits CJK and emoji below 6000 UTF-8 bytes without truncating input", async () => {
        const input = "中😀".repeat(2200);
        const results = await finish(service().translateText([input], "en"));
        const queries = mockFetch.mock.calls.map(([, init]) => body(init).get("q")!);
        expect(queries.length).toBeGreaterThan(1);
        expect(queries.join("")).toBe(input);
        for (const query of queries) {
            expect(Buffer.byteLength(query)).toBeLessThan(6000);
            expect(query).not.toContain("\ufffd");
        }
        expect(results).toHaveLength(1);
        expect(results[0].text.replaceAll("译:", "")).toBe(input);
    });

    it("preserves blank lines, empty inline elements, and empty input without billing", async () => {
        const values = ["", "  ", "<b0></b0>", "\r\n\n"];
        expect((await service().translateText(values, "en")).map(item => item.text)).toEqual(values);
        expect(await service().translateText([], "en")).toEqual([]);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("detects a source using one bounded sample and maps Baidu language codes", async () => {
        mockFetch.mockImplementation(async (_url, init) => echo(body(init), "kor"));
        expect(await finish(service().detectLanguage(["<b0>한국어</b0>".repeat(1000)]))).toBe("ko");
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const form = body(mockFetch.mock.calls[0][1]);
        expect(form.get("from")).toBe("auto");
        expect(Buffer.byteLength(form.get("q")!)).toBeLessThanOrEqual(800);
        expect(form.get("q")).not.toContain("<b0>");
    });
});

describe("Baidu rate limits, cancellation and errors", () => {
    it("shares the default one-request-per-second limit between independent provider instances", async () => {
        const times: number[] = [];
        mockFetch.mockImplementation(async (_url, init) => { times.push(Date.now()); return echo(body(init)); });
        await finish(Promise.all([
            service({ qps: undefined }).translateText(["one"], "en"),
            service({ qps: undefined }).translateText(["two"], "en"),
        ]));
        expect(times).toHaveLength(2);
        expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000);
    });

    it("cancels a queued request promptly and never sends it after another request finishes", async () => {
        let release!: (value: Response) => void;
        mockFetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const first = service().translateText(["first"], "en");
        await vi.advanceTimersByTimeAsync(0);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const controller = new AbortController();
        const second = service().translateText(["second"], "en", controller.signal);
        const cancelled = expect(second).rejects.toMatchObject({ name: "AbortError" });
        controller.abort();
        await cancelled;
        release(response({ from: "en", trans_result: [{ dst: "first" }] }));
        await finish(first);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("propagates cancellation to an active HTTP request", async () => {
        mockFetch.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }));
        const controller = new AbortController();
        const pending = service().translateText(["hello"], "en", controller.signal);
        const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
        await vi.advanceTimersByTimeAsync(0);
        controller.abort();
        await cancelled;
        expect(mockFetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    });

    it("aborts a hanging fetch after 25 seconds and allows the next job to run", async () => {
        mockFetch.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }));
        await expect(finish(service().translateText(["timeout"], "en"))).rejects.toThrow(/25 seconds/);
        expect(mockFetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
        expect((await finish(service().translateText(["next"], "en")))[0].text).toBe("译:next");
    });

    it.each([
        ["54001", /signature is invalid/], ["54003", /rate limit/], ["54004", /balance/], ["58000", /IP/],
    ])("reports Baidu error %s without returning an empty success", async (code, message) => {
        mockFetch.mockResolvedValue(response({ error_code: code, error_msg: "provider response" }));
        await expect(finish(service().translateText(["hello"], "en"))).rejects.toThrow(message);
    });

    it("reports transport failures and malformed payloads", async () => {
        mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
        await expect(finish(service().translateText(["hello"], "en"))).rejects.toThrow(/Cannot connect to Baidu/);
        mockFetch.mockResolvedValueOnce(response({ trans_result: [{ src: "hello" }] }));
        await expect(finish(service().translateText(["hello"], "en"))).rejects.toThrow(/invalid translation result/);
        mockFetch.mockResolvedValueOnce(response({}, 503));
        await expect(finish(service().translateText(["hello"], "en"))).rejects.toThrow(/HTTP 503/);
    });
});
