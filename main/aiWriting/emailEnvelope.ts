export interface EmailEnvelope {
    recipient: string;
    sender: string;
}

export interface EmailParts extends EmailEnvelope {
    /** Greeting + body + closing, excluding the first and last lines. */
    body: string;
}

/**
 * Split a generated email into its local envelope and the portion that needs
 * translation. Email generation may use names; translation must not: the
 * translation request receives only `body`, then {@link withEmailEnvelope}
 * puts the original first/last lines back around the translated result.
 */
export function splitEmailEnvelope(text: string): EmailParts | null {
    const normalized = text.replace(/\r\n?/g, "\n").trim();
    if (!normalized) return null;

    const lines = normalized.split("\n");
    const nonEmpty = lines
        .map((line, index) => ({ line: line.trim(), index }))
        .filter((item) => item.line.length > 0);

    if (nonEmpty.length < 3) return null;

    const first = nonEmpty[0];
    const last = nonEmpty[nonEmpty.length - 1];
    if (first.index >= last.index) return null;

    const body = lines
        .slice(first.index + 1, last.index)
        .join("\n")
        .trim();

    if (!body) return null;

    return {
        recipient: first.line,
        sender: last.line,
        body,
    };
}

/**
 * Wrap a translated body with the email's original first and final lines.
 */
export function withEmailEnvelope(
    stream: AsyncIterable<string>,
    envelope: EmailEnvelope,
): AsyncIterable<string> {
    const recipient = envelope.recipient.trim();
    const sender = envelope.sender.trim();

    return {
        async *[Symbol.asyncIterator]() {
            yield `${recipient}\n\n`;
            for await (const delta of stream) yield delta;
            yield `\n\n${sender}`;
        },
    };
}