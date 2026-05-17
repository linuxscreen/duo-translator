import { diffTexts } from "./diffTokenizer";

interface Props {
    original: string;
    rewritten: string;
    /** Compact mode (small popover) vs full mode (workbench). */
    compact?: boolean;
}

/**
 * Visualises a word-level diff between `original` and `rewritten`.
 * Renders inline <ins>/<del> spans styled by .duo-ai-ins / .duo-ai-del
 * (defined in aiWriting.css and adopted into the same ShadowRoot).
 */
export function DiffView({ original, rewritten, compact = false }: Props) {
    const parts = diffTexts(original, rewritten);
    return (
        <div
            className={
                compact
                    ? "whitespace-pre-wrap break-words text-[13px] leading-[1.5] text-ink"
                    : "whitespace-pre-wrap break-words text-[14px] leading-[1.6] text-ink"
            }
        >
            {parts.map((p, i) => {
                if (p.kind === "eq") return <span key={i}>{p.text}</span>;
                if (p.kind === "ins") return <ins key={i} className="duo-ai-ins">{p.text}</ins>;
                return <del key={i} className="duo-ai-del">{p.text}</del>;
            })}
        </div>
    );
}
