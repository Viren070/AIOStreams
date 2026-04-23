import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "dist");
const extensionsDir = path.join(root, "src", "extensions");

function getExtensions() {
  const entries = fs
    .readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const key = entry.name;
      const extensionDir = path.join(extensionsDir, key);
      return {
        key,
        dir: extensionDir,
        entry: path.join(extensionDir, "main.ts"),
        manifest: path.join(extensionDir, "manifest.json"),
      };
    })
    .filter((ext) => fs.existsSync(ext.entry) && fs.existsSync(ext.manifest));

  if (entries.length === 0) {
    throw new Error("No buildable extensions found in src/extensions");
  }

  return entries;
}

function normalizeWinPath(filePath) {
  return filePath.replace(/\\/g, "/");
}

fs.rmSync(distDir, { recursive: true, force: true });

const extensions = getExtensions();

for (const ext of extensions) {
  const outFolder = path.join(distDir, ext.key);
  const outFile = path.join(outFolder, "main.js");
  const outManifest = path.join(outFolder, "manifest.json");

  fs.mkdirSync(outFolder, { recursive: true });

  await build({
    entryPoints: [ext.entry],
    bundle: true,
    outfile: outFile,
    platform: "neutral",
    format: "iife",
    target: ["es2020"],
    legalComments: "none",
    charset: "utf8",
    minify: false,
    logLevel: "info",
  });

  const manifest = JSON.parse(fs.readFileSync(ext.manifest, "utf8"));
  if (manifest.id !== ext.key) {
    throw new Error(
      `Extension folder name must match manifest.id. Found folder '${ext.key}' with manifest.id '${manifest.id}'`,
    );
  }

  const payload = fs.readFileSync(outFile, "utf8");
  manifest.payloadURI = undefined;
  manifest.payload = payload;
  manifest.language = "javascript";
  manifest.isDevelopment = false;
  // manifestURI is intentionally left empty — the server sets it dynamically
  // based on the request host when serving from /seanime/extensions/:id
  manifest.manifestURI = "";

  fs.writeFileSync(outManifest, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Built ${ext.key}: ${normalizeWinPath(outManifest)}`);
}

console.log("All extensions built.");
