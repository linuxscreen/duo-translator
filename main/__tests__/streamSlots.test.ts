import { describe, expect, it, vi } from "vitest";
import { createSlotStore, type RunningStream } from "@/main/aiWriting/streamSlots";

function streamOf(chunks: string[]): RunningStream {
    return {
        stream: (async function* () {
            for (const chunk of chunks) {
                yield chunk;
                await Promise.resolve();
            }
        })(),
        abort: vi.fn(),
    };
}

function controlledStream(onAbort: () => void): RunningStream & { stop: () => void } {
    let release: ((value: IteratorResult<string>) => void) | null = null;
    const stream: AsyncIterable<string> = {
        [Symbol.asyncIterator]() {
            let first = true;
            return {
                next(): Promise<IteratorResult<string>> {
                    if (first) {
                        first = false;
                        return Promise.resolve({ value: "a", done: false });
                    }
                    return new Promise((resolve) => {
                        release = resolve;
                    });
                },
                return(): Promise<IteratorResult<string>> {
                    return Promise.resolve({ value: undefined as any, done: true });
                },
            };
        },
    };
    return {
        stream,
        abort: vi.fn(onAbort),
        stop: () => release?.({ value: undefined as any, done: true }),
    };
}

describe("createSlotStore", () => {
    it("runs slots concurrently without mixing output", async () => {
        const store = createSlotStore();

        await Promise.all([
            store.run("mailTranslation", () => streamOf(["hello", " world"])),
            store.run("replyTranslation", () => streamOf(["bonjour"])),
        ]);

        expect(store.get("mailTranslation").output).toBe("hello world");
        expect(store.get("replyTranslation").output).toBe("bonjour");
        expect(store.get("mailTranslation").running).toBe(false);
        expect(store.get("replyTranslation").running).toBe(false);
    });

    it("stops one slot without affecting another", async () => {
        const store = createSlotStore();
        const first = controlledStream(() => {});
        const second = controlledStream(() => {});

        const firstRun = store.run("mailTranslation", () => first);
        const secondRun = store.run("replyTranslation", () => second);
        await Promise.resolve();
        await Promise.resolve();

        store.stop("mailTranslation");
        first.stop();
        await firstRun;

        expect(store.get("mailTranslation").running).toBe(false);
        expect(store.get("replyTranslation").running).toBe(true);

        store.stop("replyTranslation");
        second.stop();
        await secondRun;
    });

    it("routes errors to the target slot only", async () => {
        const store = createSlotStore();

        await store.run("result", () => {
            throw new Error("provider failed");
        });

        expect(store.get("result").error).toBe("provider failed");
        expect(store.get("mailTranslation").error).toBeNull();
    });

    it("reset clears only the requested slot", async () => {
        const store = createSlotStore();
        await store.run("mailTranslation", () => streamOf(["mail"]));
        await store.run("replyTranslation", () => streamOf(["reply"]));

        store.reset("mailTranslation");

        expect(store.get("mailTranslation").output).toBe("");
        expect(store.get("replyTranslation").output).toBe("reply");
    });

    it("replaces output in only the requested slot without losing its view or base", () => {
        const store = createSlotStore();
        store.setBase("replyRewrite", "original");
        store.setView("replyRewrite", "text");
        store.setOutput("result", "untouched");

        store.setOutput("replyRewrite", "edited");

        expect(store.get("replyRewrite")).toMatchObject({
            output: "edited",
            base: "original",
            view: "text",
        });
        expect(store.get("result").output).toBe("untouched");
    });
});
