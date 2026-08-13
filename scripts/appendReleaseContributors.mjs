import { readFile, writeFile } from 'node:fs/promises';

const API_VERSION = '2022-11-28';
const CONTRIBUTORS_HEADING = /^#{2,6}\s+(contributors|贡献者)\s*$/im;

function parseArguments(args) {
    const [notesPath, currentTag, head] = args;
    if (!notesPath || !currentTag || !head) {
        throw new Error(
            'Usage: node scripts/appendReleaseContributors.mjs <notes-path> <current-tag> <head>',
        );
    }
    return { notesPath, currentTag, head };
}

function parseRepository(value) {
    const [owner, repo, ...rest] = value.split('/');
    if (!owner || !repo || rest.length > 0) {
        throw new Error('GITHUB_REPOSITORY must use the owner/repository format');
    }
    return { owner, repo };
}

function nextPageUrl(linkHeader) {
    if (!linkHeader) return undefined;
    for (const part of linkHeader.split(',')) {
        const match = part.match(/<([^>]+)>;\s*rel="next"/);
        if (match) return match[1];
    }
    return undefined;
}

async function githubJson(url, token) {
    const response = await fetch(url, {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': API_VERSION,
            'User-Agent': 'duo-translator-release-workflow',
        },
    });

    if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`GitHub API request failed (${response.status}): ${detail}`);
    }

    return { data: await response.json(), headers: response.headers };
}

async function findPreviousReleaseTag({ owner, repo, currentTag, token }) {
    let url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`;

    while (url) {
        const response = await githubJson(url, token);
        const previousRelease = response.data.find(
            (release) => !release.draft && release.tag_name !== currentTag,
        );
        if (previousRelease) return previousRelease.tag_name;
        url = nextPageUrl(response.headers.get('link'));
    }

    return undefined;
}

async function compareCommits({ owner, repo, base, head, token }) {
    const basehead = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
    let url = `https://api.github.com/repos/${owner}/${repo}/compare/${basehead}?per_page=100`;
    const commits = [];

    while (url) {
        const response = await githubJson(url, token);
        if (!['ahead', 'identical'].includes(response.data.status)) {
            throw new Error(
                `Previous release ${base} is not an ancestor of ${head} (status: ${response.data.status})`,
            );
        }
        commits.push(...response.data.commits);
        url = nextPageUrl(response.headers.get('link'));
    }

    return commits;
}

const AI_ACCOUNT_PATTERN = /^(?:claude(?:-code)?|copilot|github-copilot|chatgpt|openai|codex|gemini|google-gemini|devin|cursor|codeium|windsurf|swe-agent)(?:\[bot\]|[-_].*)?$/i;

function isAutomatedAccount(login, accountType) {
    return (
        accountType?.toLowerCase() === 'bot' ||
        login.toLowerCase().endsWith('[bot]') ||
        AI_ACCOUNT_PATTERN.test(login)
    );
}

function githubLoginFromEmail(email) {
    const match = email.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i);
    return match?.[1];
}

function coAuthors(message) {
    const authors = [];
    const pattern = /^Co-authored-by:\s*(.*?)\s*<([^>]+)>\s*$/gim;
    for (const match of message.matchAll(pattern)) {
        authors.push({ name: match[1].trim(), email: match[2].trim() });
    }
    return authors;
}

function escapeMarkdown(value) {
    return value.replace(/[\\`*_[\]<>]/g, '\\$&');
}

function contributionFromCommit(commit) {
    return {
        sha: commit.sha,
        title: (commit.commit?.message ?? commit.sha).split(/\r?\n/, 1)[0],
        url: commit.html_url,
        pulls: [],
    };
}

function collectContributors(commits, owner, configuredExcludes) {
    const excluded = new Set(
        [owner, ...configuredExcludes]
            .map((value) => value.trim().replace(/^@/, '').toLowerCase())
            .filter(Boolean),
    );
    const contributors = new Map();

    const addContribution = ({ login, name, accountType }, commit) => {
        const normalizedLogin = login?.trim().replace(/^@/, '');
        const normalizedName = name?.replace(/[\r\n]+/g, ' ').trim();
        // A release contributor must resolve to a real GitHub account. This
        // deliberately drops unlinked Co-authored-by signatures such as AI
        // model names, which otherwise get rendered as people and linked to
        // the commit instead of a profile.
        if (
            !normalizedLogin ||
            !/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(normalizedLogin) ||
            excluded.has(normalizedLogin.toLowerCase()) ||
            isAutomatedAccount(normalizedLogin, accountType)
        ) {
            return;
        }

        const key = normalizedLogin.toLowerCase();
        let contributor = contributors.get(key);
        if (!contributor) {
            contributor = {
                login: normalizedLogin,
                name: normalizedName,
                contributions: new Map(),
            };
            contributors.set(key, contributor);
        }
        contributor.contributions.set(commit.sha, contributionFromCommit(commit));
    };

    for (const commit of commits) {
        const author = commit.commit?.author;
        if (commit.author?.login) {
            addContribution(
                {
                    login: commit.author.login,
                    name: author?.name,
                    accountType: commit.author.type,
                },
                commit,
            );
        } else {
            const login = githubLoginFromEmail(author?.email ?? '');
            addContribution({ login, name: author?.name }, commit);
        }

        for (const coAuthor of coAuthors(commit.commit?.message ?? '')) {
            const login = githubLoginFromEmail(coAuthor.email);
            addContribution({ login, name: coAuthor.name }, commit);
        }
    }

    return [...contributors.values()].sort((a, b) =>
        a.login.localeCompare(b.login, 'en', { sensitivity: 'base' }),
    );
}

async function addAssociatedPulls(contributors, { owner, repo, token }) {
    const contributionsBySha = new Map();
    for (const contributor of contributors) {
        for (const contribution of contributor.contributions.values()) {
            const matchingContributions = contributionsBySha.get(contribution.sha) ?? [];
            matchingContributions.push(contribution);
            contributionsBySha.set(contribution.sha, matchingContributions);
        }
    }

    const entries = [...contributionsBySha.entries()];
    let nextIndex = 0;
    const worker = async () => {
        while (nextIndex < entries.length) {
            const [sha, matchingContributions] = entries[nextIndex++];
            const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/pulls?per_page=100`;
            const response = await githubJson(url, token);
            const pulls = response.data
                .filter((pull) => pull.merged_at)
                .map((pull) => ({ number: pull.number, url: pull.html_url }))
                .sort((a, b) => a.number - b.number);
            for (const contribution of matchingContributions) contribution.pulls = pulls;
        }
    };

    await Promise.all(
        Array.from({ length: Math.min(5, entries.length) }, () => worker()),
    );
}

function contributorLines(contributor) {
    const contributions = [...contributor.contributions.values()];
    const label = `@${contributor.login}`;
    const profileUrl = `https://github.com/${contributor.login}`;
    const lines = [`- [${label}](${profileUrl})`];

    for (const contribution of contributions) {
        const pullLinks = contribution.pulls.map(
            (pull) => `PR [#${pull.number}](${pull.url})`,
        );
        const sourceLinks = [
            ...(pullLinks.length > 0
                ? pullLinks
                : [`[direct commit](${contribution.url})`]),
            `commit [\`${contribution.sha.slice(0, 7)}\`](${contribution.url})`,
        ].join(', ');
        lines.push(
            `  - [${escapeMarkdown(contribution.title)}](${contribution.url}) — ${sourceLinks}`,
        );
    }

    return lines;
}

function appendContributors(notes, contributors) {
    if (contributors.length === 0 || CONTRIBUTORS_HEADING.test(notes)) return notes;

    const section = [
        '### Contributors',
        '',
        'Thanks to the following community contributors for helping improve this release:',
        '',
        ...contributors.flatMap(contributorLines),
    ].join('\n');

    return `${notes.trimEnd()}\n\n${section}\n`;
}

async function main() {
    const { notesPath, currentTag, head } = parseArguments(process.argv.slice(2));
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is required');

    const repository = parseRepository(process.env.GITHUB_REPOSITORY ?? '');
    const previousTag = await findPreviousReleaseTag({
        ...repository,
        currentTag,
        token,
    });
    if (!previousTag) {
        console.log('No previous published release found; skipping contributor section.');
        return;
    }

    const commits = await compareCommits({
        ...repository,
        base: previousTag,
        head,
        token,
    });
    const configuredExcludes = (process.env.RELEASE_CONTRIBUTOR_EXCLUDE ?? '').split(',');
    const contributors = collectContributors(commits, repository.owner, configuredExcludes);
    if (contributors.length === 0) {
        console.log(`No community contributors found between ${previousTag} and ${head}.`);
        return;
    }
    await addAssociatedPulls(contributors, { ...repository, token });

    const notes = await readFile(notesPath, 'utf8');
    await writeFile(notesPath, appendContributors(notes, contributors), 'utf8');
    console.log(`Added ${contributors.length} contributor(s) from ${previousTag}..${head}.`);
}

await main();
