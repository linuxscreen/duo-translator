// Fails when the two locale pairs drift apart.
//
// There are two independent i18n systems (see CLAUDE.md › Conventions):
//   - assets/locales/{en,zh-CN}.json          i18next, all React UI
//   - public/_locales/{en,zh_CN}/messages.json  Chrome __MSG_*__, manifest strings
//
// A key added to only one side is invisible in review and only shows up as a
// raw key on a user's screen, so it is worth a CI gate.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));

/** @type {{name: string, files: Record<string, string>}[]} */
const PAIRS = [
    {
        name: 'i18next (assets/locales)',
        files: { en: 'assets/locales/en.json', 'zh-CN': 'assets/locales/zh-CN.json' },
    },
    {
        name: 'chrome messages (public/_locales)',
        files: { en: 'public/_locales/en/messages.json', zh_CN: 'public/_locales/zh_CN/messages.json' },
    },
];

let failed = false;

for (const { name, files } of PAIRS) {
    const [[localeA, pathA], [localeB, pathB]] = Object.entries(files);
    const keysA = new Set(Object.keys(read(pathA)));
    const keysB = new Set(Object.keys(read(pathB)));

    const missingInB = [...keysA].filter((k) => !keysB.has(k));
    const missingInA = [...keysB].filter((k) => !keysA.has(k));

    if (missingInB.length === 0 && missingInA.length === 0) {
        console.log(`✔ ${name}: ${keysA.size} keys in sync`);
        continue;
    }

    failed = true;
    console.error(`✘ ${name}: keys out of sync`);
    if (missingInB.length) console.error(`  missing from ${pathB}: ${missingInB.join(', ')}`);
    if (missingInA.length) console.error(`  missing from ${pathA}: ${missingInA.join(', ')}`);
}

if (failed) process.exit(1);
