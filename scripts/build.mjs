// Build script for the extension. Bundles each TypeScript entry point with esbuild
// and copies static assets (manifest, html, css, icons) into dist/ unchanged.
import * as esbuild from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");
const watch = process.argv.includes("--watch");
const production = !watch;

/** Entry points: [relative src path, output format] */
const entryPoints = [
  ["background/service-worker.ts", "esm"],
  ["content/content-bundle.ts", "iife"],
  ["popup/popup.ts", "esm"],
  ["preview/preview.ts", "esm"],
  ["settings/settings.ts", "esm"],
  ["history/history.ts", "esm"],
];

const staticExtensions = new Set([".html", ".css", ".png", ".json", ".svg"]);

async function collectStaticFiles(dir, results = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectStaticFiles(fullPath, results);
    } else if (staticExtensions.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

async function copyStaticAssets() {
  const files = await collectStaticFiles(srcDir);
  await Promise.all(
    files.map(async (file) => {
      const relative = path.relative(srcDir, file);
      const dest = path.join(distDir, relative);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(file, dest);
    })
  );
  return files.length;
}

async function clean() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });
}

function buildOptionsFor([entry, format]) {
  const outfile = path.join(distDir, entry.replace(/\.ts$/, ".js"));
  return {
    entryPoints: [path.join(srcDir, entry)],
    outfile,
    bundle: true,
    format,
    target: "chrome120",
    platform: "browser",
    minify: production,
    sourcemap: watch ? "inline" : false,
    legalComments: "none",
    logLevel: "info",
  };
}

async function run() {
  await clean();
  const staticCount = await copyStaticAssets();
  console.log(`Copied ${staticCount} static file(s).`);

  if (watch) {
    const contexts = await Promise.all(
      entryPoints.map((entry) => esbuild.context(buildOptionsFor(entry)))
    );
    await Promise.all(contexts.map((ctx) => ctx.watch()));

    const { watch: watchFs } = await import("node:fs");
    watchFs(srcDir, { recursive: true }, async (_event, filename) => {
      if (!filename) return;
      const ext = path.extname(filename);
      if (staticExtensions.has(ext)) {
        await copyStaticAssets();
        console.log(`Static assets refreshed (${filename} changed).`);
      }
    });

    console.log("Watching for changes... (Ctrl+C to stop)");
  } else {
    await Promise.all(entryPoints.map((entry) => esbuild.build(buildOptionsFor(entry))));
    console.log("Build complete →", path.relative(rootDir, distDir));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
