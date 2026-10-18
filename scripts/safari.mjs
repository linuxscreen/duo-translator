#!/usr/bin/env node
// Safari / Mac App Store pipeline. macOS + Xcode only.
//
//   pnpm safari:sync [--dev]   build the extension with WXT and mirror it into
//                              safari/Resources; stamp version + build number
//                              into the Xcode project
//   pnpm safari:run            sync --dev, build the app with xcodebuild and
//                              launch it (which registers the extension with
//                              Safari) — the "pnpm dev" of this target
//   pnpm safari:archive        sync (production), archive, export a Mac App
//                              Store .pkg into safari/build/export
//   pnpm safari:icon           regenerate App/Assets.xcassets/AppIcon from
//                              public/DuoTranslator.svg
//   pnpm safari:dist           distribution OUTSIDE the App Store: sync,
//                              archive, export with Developer ID, notarize,
//                              staple, wrap into safari/build/dist/*.dmg.
//                              Needs a one-time
//                              `xcrun notarytool store-credentials duo-translator`
//                              (Apple ID + app-specific password + team id),
//                              or set SAFARI_NOTARY_PROFILE to another name.
//                              Users open the .app once; Safari then lists the
//                              extension and the user switches it on — there
//                              is no API to enable it for them.
//
// Why the extension payload is copied rather than referenced: Xcode's
// converter lists every top-level file of the build output individually in
// the project, so a new file in public/ would be silently missing from the
// Safari build. Here the whole safari/Resources directory is rsync'ed into
// the appex by a Run Script phase (see project.pbxproj), and this script is
// the only writer of that directory.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const safariDir = join(root, 'safari');
const project = join(safariDir, 'DuoTranslator.xcodeproj');
const pbxproj = join(project, 'project.pbxproj');
const resourcesDir = join(safariDir, 'Resources');
const buildDir = join(safariDir, 'build');
const scheme = 'DuoTranslator';
// PRODUCT_NAME of the app target: the .app / .pkg file name users see.
const appName = 'Duo Translator for Safari';

const [command = 'sync', ...flags] = process.argv.slice(2);
const dev = flags.includes('--dev');

const run = (cmd, args, opts = {}) => {
    console.log(`\n> ${cmd} ${args.join(' ')}`);
    return execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
};
const capture = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();

function requireMac() {
    if (process.platform !== 'darwin') {
        console.error('The Safari pipeline needs macOS + Xcode.');
        process.exit(1);
    }
}

/** package.json version → MARKETING_VERSION; git commit count → CURRENT_PROJECT_VERSION. */
function stampVersion() {
    const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    // App Store Connect requires a strictly increasing build number per
    // marketing version; the commit count on master is monotonic and needs no
    // state file. Override with SAFARI_BUILD_NUMBER when re-uploading the
    // same commit.
    const build = process.env.SAFARI_BUILD_NUMBER || capture('git', ['rev-list', '--count', 'HEAD']);
    const before = readFileSync(pbxproj, 'utf8');
    const after = before
        .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
        .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
    if (after !== before) writeFileSync(pbxproj, after);
    console.log(`\nXcode project stamped: version ${version}, build ${build}`);
    return { version, build };
}

// App Store Connect rejects the upload (ITMS-90862) when the manifest
// description resolves, in any locale, to a missing string or one longer than
// this. Chrome allows 132, so a translation that is fine everywhere else can
// still fail here — and only after a full archive + upload round-trip.
const SAFARI_DESCRIPTION_MAX = 112;

/** Fail fast on manifest descriptions App Store validation would reject. */
function checkLocaleDescriptions(outDir) {
    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
    const key = /^__MSG_(\w+)__$/.exec(manifest.description ?? '')?.[1];
    if (!key) return;
    const localesDir = join(outDir, '_locales');
    const problems = [];
    for (const locale of readdirSync(localesDir)) {
        const messages = JSON.parse(readFileSync(join(localesDir, locale, 'messages.json'), 'utf8'));
        const message = messages[key]?.message;
        if (typeof message !== 'string') {
            problems.push(`${locale}: "${key}" is missing`);
        } else if ([...message].length > SAFARI_DESCRIPTION_MAX) {
            problems.push(`${locale}: "${key}" is ${[...message].length} characters`);
        }
    }
    if (problems.length) {
        console.error(`\nManifest description must be at most ${SAFARI_DESCRIPTION_MAX} characters in every locale (public/_locales):`);
        for (const p of problems) console.error(`  ${p}`);
        process.exit(1);
    }
}

function sync() {
    const args = ['exec', 'wxt', 'build', '-b', 'safari', '--mv3'];
    if (dev) args.push('--mode', 'development');
    run('pnpm', args);
    const outDir = join(root, '.output', dev ? 'safari-mv3-dev' : 'safari-mv3');
    if (!existsSync(join(outDir, 'manifest.json'))) {
        console.error(`WXT output not found at ${outDir}`);
        process.exit(1);
    }
    checkLocaleDescriptions(outDir);
    mkdirSync(resourcesDir, { recursive: true });
    run('rsync', ['-a', '--delete', '--exclude', '.DS_Store', `${outDir}/`, `${resourcesDir}/`]);
    console.log(`\nExtension payload mirrored to ${resourcesDir}`);
    return stampVersion();
}

function build() {
    run('xcodebuild', [
        '-project', project, '-scheme', scheme, '-configuration', 'Debug',
        // -allowProvisioningUpdates lets Xcode mint the "Apple Development"
        // certificate / profile on first use (needs the team's Apple ID added
        // under Xcode › Settings › Accounts); without it a fresh machine fails
        // with 'No signing certificate "Mac Development" found'.
        '-derivedDataPath', buildDir, '-allowProvisioningUpdates', '-quiet', 'build',
    ]);
    return join(buildDir, 'Build', 'Products', 'Debug', `${appName}.app`);
}

function makeArchive() {
    const archivePath = join(buildDir, 'DuoTranslator.xcarchive');
    run('xcodebuild', [
        '-project', project, '-scheme', scheme, '-configuration', 'Release',
        '-destination', 'generic/platform=macOS',
        '-archivePath', archivePath, '-allowProvisioningUpdates', 'archive',
    ]);
    return archivePath;
}

function exportArchive(archivePath, optionsPlist, exportPath) {
    rmSync(exportPath, { recursive: true, force: true });
    run('xcodebuild', [
        '-exportArchive', '-archivePath', archivePath,
        '-exportOptionsPlist', join(safariDir, optionsPlist),
        '-exportPath', exportPath, '-allowProvisioningUpdates',
    ]);
}

function archive() {
    const exportPath = join(buildDir, 'export');
    exportArchive(makeArchive(), 'ExportOptions.plist', exportPath);
    console.log(`\nApp Store package exported to ${exportPath} — upload it with Transporter or Xcode › Organizer.`);
}

/** "Developer ID Application: …" identity the exported app was signed with. */
function developerIdIdentity(app) {
    // codesign prints the signature details on STDERR, not stdout.
    const { stdout, stderr } = spawnSync('codesign', ['-dvv', app], { encoding: 'utf8' });
    const match = `${stdout}\n${stderr}`.match(/^Authority=(Developer ID Application:.*)$/m);
    if (!match) {
        console.error(`${app} is not signed with a Developer ID Application certificate`);
        process.exit(1);
    }
    return match[1];
}

/** Developer ID build: notarized, stapled .dmg for distribution outside the store. */
function dist({ version }) {
    const profile = process.env.SAFARI_NOTARY_PROFILE || 'duo-translator';
    const exportPath = join(buildDir, 'export-developer-id');
    exportArchive(makeArchive(), 'ExportOptionsDeveloperID.plist', exportPath);
    const app = join(exportPath, `${appName}.app`);

    // 1. Notarize + staple the .app itself, so it passes Gatekeeper even when
    //    someone copies it out of the dmg on a machine that is offline.
    const appZip = join(buildDir, 'DuoTranslator-notarize.zip');
    rmSync(appZip, { force: true });
    run('ditto', ['-c', '-k', '--keepParent', app, appZip]);
    run('xcrun', ['notarytool', 'submit', appZip, '--keychain-profile', profile, '--wait']);
    run('xcrun', ['stapler', 'staple', app]);

    // 2. Wrap into a dmg (app + Applications shortcut), notarize + staple that too.
    const distDir = join(buildDir, 'dist');
    const stage = join(buildDir, 'dmg-stage');
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    mkdirSync(distDir, { recursive: true });
    run('ditto', [app, join(stage, `${appName}.app`)]);
    symlinkSync('/Applications', join(stage, 'Applications'));
    const dmg = join(distDir, `DuoTranslator-${version}-safari.dmg`);
    rmSync(dmg, { force: true });
    run('hdiutil', ['create', '-volname', appName, '-srcfolder', stage, '-ov', '-format', 'UDZO', dmg]);
    // The disk image needs its own Developer ID signature: notarization
    // accepts an unsigned dmg, but Gatekeeper (`spctl -t open`) rejects it
    // with "no usable signature". Sign BEFORE submitting — signing afterwards
    // invalidates the stapled ticket. Identity taken from the exported app so
    // it can never disagree with what Xcode signed with.
    run('codesign', ['--sign', developerIdIdentity(app), '--timestamp', dmg]);
    run('xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', profile, '--wait']);
    run('xcrun', ['stapler', 'staple', dmg]);
    run('spctl', ['-a', '-vv', '-t', 'open', '--context', 'context:primary-signature', dmg]);
    console.log(`\nNotarized installer: ${dmg}`);
}

function icon() {
    const swiftSource = join(root, 'scripts', 'safari-app-icon.swift');
    const tmp = join(buildDir, 'icon');
    mkdirSync(tmp, { recursive: true });
    const bin = join(tmp, 'make-icon');
    run('swiftc', ['-O', swiftSource, '-o', bin]);
    const master = join(tmp, 'icon-1024.png');
    run(bin, [join(root, 'public', 'DuoTranslator.svg'), master]);
    const iconset = join(safariDir, 'App', 'Assets.xcassets', 'AppIcon.appiconset');
    for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
        run('sips', ['-z', String(size), String(size), master, '--out', join(iconset, `icon_${size}.png`)], { stdio: 'ignore' });
    }
    console.log(`\nApp icon regenerated in ${iconset}`);
}

requireMac();
switch (command) {
    case 'sync':
        sync();
        break;
    case 'run': {
        sync();
        const app = build();
        run('open', [app]);
        console.log('\nApp launched. Enable the extension under Safari › Settings › Extensions; if it is missing, turn on Develop › Allow Unsigned Extensions.');
        break;
    }
    case 'archive':
        if (dev) {
            console.error('archive always uses the production build; drop --dev');
            process.exit(1);
        }
        sync();
        archive();
        break;
    case 'dist':
        if (dev) {
            console.error('dist always uses the production build; drop --dev');
            process.exit(1);
        }
        dist(sync());
        break;
    case 'icon':
        icon();
        break;
    default:
        console.error(`Unknown command "${command}". Use sync | run | archive | dist | icon.`);
        process.exit(1);
}
