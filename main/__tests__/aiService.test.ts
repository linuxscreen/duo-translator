import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { configGet } = vi.hoisted(() => ({ configGet: vi.fn() }));
vi.mock("@/main/storage/configStore", () => ({ configRepo: { get: configGet } }));
vi.mock("@/main/messageBridge", () => ({
    ABORT_SCOPE: { AI_COMPLETE: "aiComplete" },
    handleAbort: vi.fn(),
    handleAbortable: vi.fn(),
    handleAsync: vi.fn((_label, sendResponse, work) => {
        work().then(sendResponse);
        return true;
    }),
}));

import { AiProvider, normalizeProvider } from "@/main/aiProvider";
import { ACTION, AI_TASK, CONFIG_KEY } from "@/main/constants";
import { AI_MAX_INPUT_CHARS, aiMessageHandlers, aiPageTranslate, buildPrompt, chatCompleteNonStream, chatStream } from "@/main/aiService";

const provider = new AiProvider("mt", "bailian", "Alibaba Cloud Model Studio", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", "test-key", "qwen-mt-plus");
const fetchMock = vi.fn();
const options = { task: AI_TASK.TRANSLATE, targetLang: "zh-CN" };
const messages = buildPrompt({ task: AI_TASK.TRANSLATE, payload: { text: "Hello", targetLang: "zh-CN" } });
const completeResponse = (text: string) => Response.json({ choices: [{ message: { content: text } }] });

function streamResponse(chunks: string[]) {
    return new Response(chunks.map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join("") + "data: [DONE]\n\n");
}

async function collect(stream: AsyncGenerator<string, void, void>) {
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return chunks;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    configGet.mockImplementation(async (key) => key === CONFIG_KEY.AI_PROVIDERS ? [provider] : provider.id);
});
afterEach(() => vi.unstubAllGlobals());

describe("Qwen-MT compatibility", () => {
    it.each(["custom", "openai", "deepseek", "ollama", "openrouter"])("does not infer Bailian from the model, name or URL for %s", async (type) => {
        const other = normalizeProvider({ ...provider, type });
        fetchMock.mockResolvedValueOnce(completeResponse("你好"));
        expect(await chatCompleteNonStream(other, messages, options)).toBe("你好");
        fetchMock.mockResolvedValueOnce(streamResponse(["你", "你好"]));
        expect(await collect(chatStream(other, messages, options))).toEqual(["你", "你好"]);
        for (const [, init] of fetchMock.mock.calls) {
            const body = JSON.parse(init.body);
            expect(body.messages).toEqual(messages);
            expect(body.translation_options).toBeUndefined();
        }
    });

    it.each([["zh-CN", "Chinese"], ["zh-TW", "Traditional Chinese"], ["ja", "Japanese"]])("sends only source text and the target language for %s", async (targetLang, target) => {
        fetchMock.mockResolvedValue(completeResponse("译文"));
        const signal = new AbortController().signal;
        expect(await chatCompleteNonStream(provider, messages, { ...options, targetLang, signal })).toBe("译文");
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(provider.url);
        expect(init.headers.Authorization).toBe("Bearer test-key");
        expect(init.signal).toBe(signal);
        expect(JSON.parse(init.body)).toEqual({
            model: "qwen-mt-plus", stream: false,
            messages: [{ role: "user", content: "Hello" }],
            translation_options: { source_lang: "auto", target_lang: target },
        });
        expect(messages[0].role).toBe("system");
    });

    it.each(["qwen-mt-plus", "qwen-mt-turbo"])("converts cumulative %s output into deltas", async (model) => {
        fetchMock.mockResolvedValue(streamResponse(["你", "你好", "你好", "你好！"]));
        expect(await collect(chatStream(normalizeProvider({ ...provider, model }), messages, options))).toEqual(["你", "好", "！"]);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
            stream: true, messages: [{ role: "user", content: "Hello" }],
            translation_options: { target_lang: "Chinese" },
        });
    });

    it.each(["qwen-mt-flash", "qwen-mt-lite"])("preserves incremental %s output", async (model) => {
        fetchMock.mockResolvedValue(streamResponse(["你", "好", "！"]));
        expect(await collect(chatStream(normalizeProvider({ ...provider, model }), messages, options))).toEqual(["你", "好", "！"]);
    });

    it("rejects writing tasks before sending a request", async () => {
        await expect(chatCompleteNonStream(provider, messages, { task: AI_TASK.POLISH })).rejects.toThrow("only supports translation");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("tests provider connectivity with a valid translation request", async () => {
        fetchMock.mockResolvedValue(streamResponse(["ping"]));
        const reply = await new Promise((resolve) => {
            aiMessageHandlers[ACTION.AI_PROVIDER_TEST]({ data: provider }, resolve);
        });
        expect(reply).toEqual({ reply: "ping" });
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
            messages: [{ role: "user", content: "ping" }],
            translation_options: { source_lang: "auto", target_lang: "English" },
        });
    });

    it("preserves upstream errors", async () => {
        fetchMock.mockResolvedValue(new Response("Invalid API key", { status: 401 }));
        await expect(chatCompleteNonStream(provider, messages, options)).rejects.toThrow("HTTP 401");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("translates paragraphs individually without treating literal separators as boundaries", async () => {
        fetchMock.mockImplementation(async (_url, init) => {
            const source = JSON.parse(init.body).messages[0].content;
            return completeResponse(source === "Hello<sep/>world" ? "你好<sep/>世界" : "再见");
        });
        expect(await aiPageTranslate("mt", ["Hello<sep/>world", "Goodbye"], "zh-CN")).toEqual(["你好<sep/>世界", "再见"]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).messages)).toEqual([
            [{ role: "user", content: "Hello<sep/>world" }],
            [{ role: "user", content: "Goodbye" }],
        ]);
    });

    it.each([false, true])("keeps general Qwen prompts unchanged (stream=%s)", async (stream) => {
        const general = normalizeProvider({ ...provider, model: "qwen-plus" });
        fetchMock.mockResolvedValue(stream ? streamResponse(["你", "好"]) : completeResponse("你好"));
        if (stream) expect(await collect(chatStream(general, messages, options))).toEqual(["你", "好"]);
        else expect(await chatCompleteNonStream(general, messages, options)).toBe("你好");
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.messages).toEqual(messages);
        expect(body.translation_options).toBeUndefined();
    });

    it("keeps general model paragraph batching", async () => {
        configGet.mockResolvedValue([{ ...provider, model: "qwen-plus" }]);
        fetchMock.mockResolvedValue(completeResponse("你好<sep/>再见"));
        expect(await aiPageTranslate("mt", ["Hello", "Goodbye"], "zh-CN")).toEqual(["你好", "再见"]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.messages[0].role).toBe("system");
        expect(body.messages[1].content).toBe("Hello<sep/>Goodbye");
    });

    it("preserves blank paragraphs and falls back on empty translations", async () => {
        fetchMock.mockResolvedValue(completeResponse(" "));
        expect(await aiPageTranslate("mt", ["", "  ", "Hello"], "zh-CN")).toEqual(["", "  ", "Hello"]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["你好<b0>世界</b0>", "你好<b0>世界</b0>"],
        ["你好<b1>世界</b1>", "你好世界"],
    ])("validates paragraph placeholders in %s", async (output, expected) => {
        fetchMock.mockResolvedValue(completeResponse(output));
        expect(await aiPageTranslate("mt", ["Hello <b0>world</b0>"], "zh-CN")).toEqual([expected]);
    });

    it("enforces the input limit without building a general chat prompt", async () => {
        await expect(aiPageTranslate("mt", ["x".repeat(AI_MAX_INPUT_CHARS + 1)], "en")).rejects.toThrow("Text too long");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("shares the concurrency limit between Qwen-MT paragraphs and general chat", async () => {
        const pending: (() => void)[] = [];
        fetchMock.mockImplementation(() => new Promise<Response>((resolve) => {
            pending.push(() => resolve(completeResponse("译文")));
        }));
        const page = aiPageTranslate("mt", ["one", "two", "three", "four", "five", "six"], "zh-CN");
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
        const chat = chatCompleteNonStream(normalizeProvider({ ...provider, model: "qwen-plus" }), messages);
        expect(fetchMock).toHaveBeenCalledTimes(5);
        pending.splice(0).forEach((resolve) => resolve());
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
        pending.splice(0).forEach((resolve) => resolve());
        expect(await page).toEqual(Array(6).fill("译文"));
        expect(await chat).toBe("译文");
    });
});
