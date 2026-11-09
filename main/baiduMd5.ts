/** UTF-8 MD5 for Baidu's appid + query + salt + secret signature.
 * Web Crypto intentionally does not expose MD5, so keep this background-only
 * implementation small rather than bundling a second crypto runtime.
 */
export function baiduMd5(text: string): string {
    const bytes = new TextEncoder().encode(text);
    const size = Math.ceil((bytes.length + 9) / 64) * 64;
    const buffer = new ArrayBuffer(size);
    const data = new Uint8Array(buffer);
    const view = new DataView(buffer);
    data.set(bytes);
    data[bytes.length] = 128;
    view.setUint32(size - 8, (bytes.length * 8) >>> 0, true);
    view.setUint32(size - 4, Math.floor(bytes.length / 0x20000000), true);
    const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    let state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    for (let offset = 0; offset < size; offset += 64) {
        let [a, b, c, d] = state;
        for (let i = 0; i < 64; i++) {
            const round = i >> 4;
            const f = round === 0 ? (b & c) | (~b & d)
                : round === 1 ? (d & b) | (~d & c)
                    : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
            const index = round === 0 ? i : round === 1 ? (5 * i + 1) % 16
                : round === 2 ? (3 * i + 5) % 16 : (7 * i) % 16;
            const sum = (a + f + Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000)
                + view.getUint32(offset + index * 4, true)) | 0;
            const shift = shifts[round * 4 + i % 4];
            [a, b, c, d] = [d, (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0, b, c];
        }
        state = state.map((word, i) => (word + [a, b, c, d][i]) | 0);
    }
    return state.map(word => [0, 8, 16, 24]
        .map(shift => ((word >>> shift) & 255).toString(16).padStart(2, "0")).join("")).join("");
}
