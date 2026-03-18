const { writeFileSync, mkdirSync } = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const channelArg =
  process.argv
    .find((arg) => arg.startsWith('--channel='))
    ?.replace('--channel=', '') || 'stable';
const refArg =
  process.argv.find((arg) => arg.startsWith('--ref='))?.replace('--ref=', '') ||
  null;
const commitArg =
  process.argv
    .find((arg) => arg.startsWith('--commit='))
    ?.replace('--commit=', '') || null;

const isNightly = channelArg === 'nightly';
const isDev = channelArg === 'dev';

// Get the version from package.json
let { version, description } = require('../package.json');
const os = require('os');

let tag;
if (isDev && refArg) {
  tag = refArg;
} else if (isNightly) {
  tag = execSync('git describe --tags --abbrev=0').toString().trim();
} else {
  if (os.platform() === 'win32') {
    tag = execSync('git tag --sort=-version:refname')
      .toString()
      .trim()
      .split('\n')[0];
  } else {
    tag = execSync('git tag --sort=-version:refname | head -n 1')
      .toString()
      .trim();
  }
}

// Get the current Git commit hash
let commitHash;
if (commitArg) {
  // Use at most 8 chars to match short hash length from git
  commitHash = commitArg.substring(0, 8);
} else {
  try {
    commitHash = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    commitHash = 'unknown';
  }
}
const commitTime = execSync('git log -1 --format=%cd --date=iso')
  .toString()
  .trim();

// Create the version info object
const versionInfo = {
  version,
  description,
  tag,
  channel: channelArg,
  commitHash,
  buildTime: new Date().toISOString(),
  commitTime: new Date(commitTime).toISOString(),
};

// Write the version info to a file
const outputPath = path.resolve(__dirname, '../resources/metadata.json');
const outputDir = path.dirname(outputPath);
// Ensure the output directory exists
mkdirSync(outputDir, { recursive: true });
// Write the version info to a JSON file
const jsonContent = JSON.stringify(versionInfo, null, 2);
writeFileSync(outputPath, jsonContent, 'utf8');
// Write the version info to a TypeScript file
console.log('Version info generated:', versionInfo);
