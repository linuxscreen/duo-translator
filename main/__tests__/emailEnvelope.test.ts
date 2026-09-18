import { describe, expect, it } from "vitest";
import {
    splitEmailEnvelope,
    withEmailEnvelope,
} from "@/main/aiWriting/emailEnvelope";

async function collect(stream: AsyncIterable<string>): Promise<string> {
    let output = "";
    for await (const chunk of stream) output += chunk;
    return output;
}

describe("emailEnvelope", () => {
    it("separates the first and final lines from the translatable body", () => {
        const parts = splitEmailEnvelope(
            "王经理\n\n您好！\n\n正文内容。\n\n感谢您的支持。\n\n张三",
        );

        expect(parts).toEqual({
            recipient: "王经理",
            sender: "张三",
            body: "您好！\n\n正文内容。\n\n感谢您的支持。",
        });
    });

    it("puts the original names around the translated body", async () => {
        const translated = (async function* () {
            yield "Hello!";
            yield "\n\n";
            yield "Body.";
            yield "\n\n";
            yield "Thank you.";
        })();

        const output = await collect(withEmailEnvelope(translated, {
            recipient: "Mr. Smith",
            sender: "Zhang San",
        }));

        expect(output).toBe(
            "Mr. Smith\n\nHello!\n\nBody.\n\nThank you.\n\nZhang San",
        );
    });

    it("does not mistake a short two-line draft for an email", () => {
        expect(splitEmailEnvelope("line one\nline two")).toBeNull();
    });
});