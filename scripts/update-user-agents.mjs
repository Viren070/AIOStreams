import { readFileSync, writeFileSync, appendFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HEADER_PRESETS_PATH = join(
  __dirname,
  '../packages/core/src/utils/header-presets.ts'
);

// e.g. "5.1.1", "26.2", "4.0.19.2979"
const VERSION_PATTERN = /^\d+(?:\.\d+)*$/;
// e.g. "151"
const MAJOR_VERSION_PATTERN = /^\d+$/;

const GITHUB_RELEASE_SOURCES = {
  sabnzbd: 'sabnzbd/sabnzbd',
  nzbget: 'nzbgetcom/nzbget', // active fork; nzbget/nzbget is abandoned
  sonarr: 'Sonarr/Sonarr',
  radarr: 'Radarr/Radarr',
  prowlarr: 'Prowlarr/Prowlarr',
  nzbhydra2: 'theotherp/nzbhydra2',
};

async function fetchLatestTag(repo) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'AIOStreams-UserAgent-Updater',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases/latest`,
      { headers }
    );
    if (!res.ok) {
      console.warn(
        `[update-user-agents] ${repo}: GitHub API returned ${res.status}, skipping`
      );
      return null;
    }
    const json = await res.json();
    if (typeof json.tag_name !== 'string') return null;
    const version = json.tag_name.replace(/^v/, '');
    if (!VERSION_PATTERN.test(version)) {
      console.warn(
        `[update-user-agents] ${repo}: tag "${json.tag_name}" is not a valid version, skipping`
      );
      return null;
    }
    return version;
  } catch (err) {
    console.warn(`[update-user-agents] ${repo}: fetch failed, skipping`, err);
    return null;
  }
}

async function fetchChromeMajorVersion() {
  try {
    const res = await fetch(
      'https://versionhistory.googleapis.com/v1/chrome/platforms/linux/channels/stable/versions/all/releases?filter=endtime=none&order_by=version%20desc&pageSize=1'
    );
    if (!res.ok) {
      console.warn(
        `[update-user-agents] chrome: version API returned ${res.status}, skipping`
      );
      return null;
    }
    const json = await res.json();
    const version = json.releases?.[0]?.version;
    if (typeof version !== 'string') return null;
    const major = version.split('.')[0];
    if (!MAJOR_VERSION_PATTERN.test(major)) {
      console.warn(
        `[update-user-agents] chrome: version "${version}" is not valid, skipping`
      );
      return null;
    }
    return major;
  } catch (err) {
    console.warn('[update-user-agents] chrome: fetch failed, skipping', err);
    return null;
  }
}

function replaceVersion(content, pattern, label, newVersion, changes) {
  if (!newVersion) return content;
  const match = content.match(pattern);
  if (!match) {
    console.warn(`[update-user-agents] ${label}: pattern not found, skipping`);
    return content;
  }
  const oldVersion = match[1];
  if (oldVersion === newVersion) return content;
  changes.push({ label, oldVersion, newVersion });
  return content.replace(pattern, (full) =>
    full.replace(oldVersion, newVersion)
  );
}

async function main() {
  const [sabnzbd, nzbget, sonarr, radarr, prowlarr, nzbhydra2, chrome] =
    await Promise.all([
      fetchLatestTag(GITHUB_RELEASE_SOURCES.sabnzbd),
      fetchLatestTag(GITHUB_RELEASE_SOURCES.nzbget),
      fetchLatestTag(GITHUB_RELEASE_SOURCES.sonarr),
      fetchLatestTag(GITHUB_RELEASE_SOURCES.radarr),
      fetchLatestTag(GITHUB_RELEASE_SOURCES.prowlarr),
      fetchLatestTag(GITHUB_RELEASE_SOURCES.nzbhydra2),
      fetchChromeMajorVersion(),
    ]);

  let content = readFileSync(HEADER_PRESETS_PATH, 'utf-8');
  const changes = [];

  content = replaceVersion(
    content,
    /SABnzbd\/([\d.]+)/,
    'sabnzbd',
    sabnzbd,
    changes
  );
  content = replaceVersion(
    content,
    /nzbget\/([\d.]+)/,
    'nzbget',
    nzbget,
    changes
  );
  content = replaceVersion(
    content,
    /Sonarr\/([\d.]+)(?= \(alpine)/,
    'sonarr',
    sonarr,
    changes
  );
  content = replaceVersion(
    content,
    /Radarr\/([\d.]+)(?= \(alpine)/,
    'radarr',
    radarr,
    changes
  );
  content = replaceVersion(
    content,
    /Prowlarr\/([\d.]+)(?= \(alpine)/,
    'prowlarr',
    prowlarr,
    changes
  );
  content = replaceVersion(
    content,
    /NZBHydra2 ([\d.]+)/,
    'nzbhydra2',
    nzbhydra2,
    changes
  );

  if (chrome) {
    content = replaceVersion(
      content,
      /Chrome\/(\d+)\.0\.0\.0/,
      'chrome (User-Agent)',
      chrome,
      changes
    );
    content = content.replace(
      /"Google Chrome";v="(\d+)"/,
      (full, oldVersion) => {
        if (oldVersion !== chrome) {
          changes.push({
            label: 'chrome (Sec-Ch-Ua Google Chrome)',
            oldVersion,
            newVersion: chrome,
          });
        }
        return `"Google Chrome";v="${chrome}"`;
      }
    );
    content = content.replace(/"Chromium";v="(\d+)"/, (full, oldVersion) => {
      if (oldVersion !== chrome) {
        changes.push({
          label: 'chrome (Sec-Ch-Ua Chromium)',
          oldVersion,
          newVersion: chrome,
        });
      }
      return `"Chromium";v="${chrome}"`;
    });
  } else {
    console.warn('[update-user-agents] chrome: no version resolved, skipping');
  }

  if (changes.length === 0) {
    console.log('[update-user-agents] No changes - all presets up to date.');
    return;
  }

  writeFileSync(HEADER_PRESETS_PATH, content);

  const summaryLines = [
    'Updated header presets:',
    '',
    '| Preset | Old | New |',
    '| --- | --- | --- |',
    ...changes.map((c) => `| ${c.label} | ${c.oldVersion} | ${c.newVersion} |`),
  ];
  const summary = summaryLines.join('\n');
  console.log(summary);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${summary}\n`);
  }
  if (process.env.PR_BODY_FILE) {
    writeFileSync(process.env.PR_BODY_FILE, summary);
  }
}

await main();
