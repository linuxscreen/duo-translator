// Dictionary — content-side thin client.
//
// Never imports dictService: the endpoints, the scraping and the cache all
// live in background (see that file's header). This side only names what it
// wants. The e2e bundle test asserts the separation by scanning content.js for
// provider hosts.

import { ACTION, API_REQUEST_TIMEOUT } from "@/main/constants";
import { sendMessageToBackgroundOrThrow } from "@/utils/message";
import type { DictEntry, DictProvider } from "./types";

/**
 * Look a word up. Resolves to null when the provider simply has no entry —
 * that is an answer, not a failure, and the caller draws nothing. A failed
 * request throws.
 */
export async function lookupDict(
    provider: DictProvider,
    word: string,
    targetLang: string,
): Promise<DictEntry | null> {
    const resp: any = await sendMessageToBackgroundOrThrow(
        { action: ACTION.DICT_LOOKUP, data: { provider, word, targetLang } },
        API_REQUEST_TIMEOUT,
    );
    return (resp?.entry as DictEntry | null) ?? null;
}

/**
 * Fetch a pronunciation recording as a `data:` URL, ready for Web Audio.
 *
 * The array shape matches ACTION.TTS_SYNTHESIZE so both feed the same player —
 * see useTts. Bytes travel out-of-band for the same reason as TTS: a media
 * element created by a content script is subject to the host page's CSP.
 */
export async function fetchDictAudio(url: string): Promise<string[]> {
    const resp: any = await sendMessageToBackgroundOrThrow(
        { action: ACTION.DICT_AUDIO, data: { url } },
        API_REQUEST_TIMEOUT,
    );
    return (resp?.audios as string[]) ?? [];
}
