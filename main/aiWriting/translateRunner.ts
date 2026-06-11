import { AI_PREFIX, AI_TASK, DEFAULT_VALUE, TRANS_SERVICE } from "@/main/constants";
import { translationServices } from "@/main/translateService";
import { startAiChatStream } from "@/main/aiService";

/**
 * The user can route the floating-dot Translate button through either:
 *   - a regular translator (Microsoft / Google / DeepL) — one-shot HTTP call,
 *   - or an AI provider — streaming SSE.
 *
 * Callers don't care which one; they just want `{ stream, abort }`. This
 * module unifies the two behind a single async-iterable interface.
 */

export type TranslateServiceChoice =
    | { kind: "trans"; service: string }
    | { kind: "ai"; providerId: string };

export function parseTranslateServiceKey(key: string | undefined | null): TranslateServiceChoice {
    if (!key) return { kind: "trans", service: DEFAULT_VALUE.AI_TRANSLATE_SERVICE };
    if (key.startsWith(AI_PREFIX)) return { kind: "ai", providerId: key.slice(AI_PREFIX.length) };
    return { kind: "trans", service: key };
}

export function buildTranslateServiceKey(c: TranslateServiceChoice): string {
    return c.kind === "ai" ? `${AI_PREFIX}${c.providerId}` : c.service;
}

export interface RunningStream {
    stream: AsyncIterable<string>;
    abort: () => void;
}

export function startTranslate(
    text: string,
    targetLang: string,
    choice: TranslateServiceChoice,
): RunningStream {
    if (choice.kind === "ai") {
        return startAiChatStream({
            task: AI_TASK.TRANSLATE,
            providerId: choice.providerId,
            payload: { text, targetLang },
        });
    }
    return startRegularTranslate(text, targetLang, choice.service);
}

function startRegularTranslate(text: string, targetLang: string, service: string): RunningStream {
    let aborted = false;
    const stream: AsyncIterable<string> = {
        [Symbol.asyncIterator]() {
            let done = false;
            return {
                async next(): Promise<IteratorResult<string>> {
                    if (done || aborted) return { value: undefined as any, done: true };
                    done = true;
                    const svc = translationServices.get(service);
                    if (!svc) throw new Error(`Unknown translate service: ${service}`);
                    const results = await svc.translateText([text], targetLang);
                    if (aborted) return { value: undefined as any, done: true };
                    const out = results?.[0]?.translatedMappedHtmlText ?? "";
                    return { value: out, done: false };
                },
                return(): Promise<IteratorResult<string>> {
                    aborted = true;
                    return Promise.resolve({ value: undefined as any, done: true });
                },
            };
        },
    };
    return { stream, abort: () => { aborted = true; } };
}
