import { describe, expect, it } from "vitest";
import { buildPrompt } from "@/main/aiService";
import { AI_TASK } from "@/main/constants";

describe("buildPrompt email task", () => {
    it("uses names and requires blank lines around the body", () => {
        const messages = buildPrompt({
            task: AI_TASK.EMAIL,
            payload: {
                text: "关于周五的交付时间，我方确认可以按时完成。",
                recipientSalutation: "王经理",
                senderName: "张三",
            },
        });

        expect(messages).toHaveLength(2);
        expect(messages[0].content).toContain("same language as the user's draft");
        expect(messages[0].content).toContain(
            "insert a blank line before the polished email body",
        );
        expect(messages[0].content).toContain(
            "After the body, insert a blank line",
        );
        expect(messages[0].content).toContain(
            "provided sender name verbatim as the final line",
        );

        expect(messages[1].content).toContain("王经理");
        expect(messages[1].content).toContain("张三");
        expect(messages[1].content).toContain("关于周五的交付时间，我方确认可以按时完成。");
    });
});