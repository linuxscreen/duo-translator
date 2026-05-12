export function shuffle<T>(arr: T[]): T[] {
    const result = [...arr];

    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [result[i], result[j]] =
            [result[j], result[i]];
    }

    return result;
}

export function unique<T>(arr: T[]): T[] {
    return Array.from(new Set(arr));
}