#!/usr/bin/env node
/**
 * Stage a directory tree for the demo server / smoke:
 *   out/
 *     kernel.wasm loom.tar mc-core.mjs catalog-compiler.wasm git-engine.tar
 *     libocc_c.js libocc_c.wasm
 *     batteries/solid.luau + batteries/ir/**
 *     src/*.js
 *     demo/…
 *
 * Env paths (absolute or cwd-relative); Bazel passes runfile paths.
 */

import {
  cpSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// dirname used for browser mc-core sibling lookup

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return resolve(v);
}

const out = resolve(process.env.STAGE_OUT || join(dirname(fileURLToPath(import.meta.url)), "../_stage"));
const kernel = need("AGENT_OS_KERNEL");
const loom = need("AGENT_OS_LOOM");
const mcCore = need("AGENT_OS_MC_CORE");
const catalog = need("AGENT_OS_CATALOG");
const occJs = need("OCC_JS");
const occWasm = need("OCC_WASM");
const solid = need("SOLID_LUAU");
const srcDir = resolve(process.env.SRC_DIR || join(dirname(fileURLToPath(import.meta.url)), "../src"));
const demoDir = resolve(process.env.DEMO_DIR || join(dirname(fileURLToPath(import.meta.url)), "../demo"));
const batteriesDir = resolve(
  process.env.BATTERIES_DIR || join(dirname(solid), "."),
);
// Optional: host git-engine.tar for document history (GitEngine).
const gitEngineEnv = process.env.AGENT_OS_GIT_ENGINE;
const gitEngineFallback = join(dirname(fileURLToPath(import.meta.url)), "../vendor/git-engine.tar");
const gitEngine =
  gitEngineEnv && existsSync(resolve(gitEngineEnv))
    ? resolve(gitEngineEnv)
    : existsSync(gitEngineFallback)
      ? gitEngineFallback
      : null;

if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(join(out, "batteries"), { recursive: true });
mkdirSync(join(out, "src"), { recursive: true });
mkdirSync(join(out, "demo"), { recursive: true });

copyFileSync(kernel, join(out, "kernel.wasm"));
copyFileSync(loom, join(out, "loom.tar"));
copyFileSync(catalog, join(out, "catalog-compiler.wasm"));
copyFileSync(occJs, join(out, "libocc_c.js"));
copyFileSync(occWasm, join(out, "libocc_c.wasm"));
if (gitEngine) {
  copyFileSync(gitEngine, join(out, "git-engine.tar"));
  console.log(`staged git-engine.tar from ${gitEngine}`);
} else {
  console.warn("warning: no git-engine.tar — history will fall back to IDB/memory");
}
// Full batteries tree (solid + ir package)
if (existsSync(batteriesDir)) {
  cpSync(batteriesDir, join(out, "batteries"), { recursive: true });
} else {
  copyFileSync(solid, join(out, "batteries/solid.luau"));
}
cpSync(srcDir, join(out, "src"), { recursive: true });
cpSync(demoDir, join(out, "demo"), { recursive: true });

// Prefer a browserified mc-core (release artifact pulls in node:* static imports).
const browserMc = process.env.AGENT_OS_MC_CORE_BROWSER
  || join(dirname(mcCore), "mc-core.browser.mjs");
if (existsSync(browserMc)) {
  copyFileSync(browserMc, join(out, "mc-core.mjs"));
  console.log(`using browser mc-core: ${browserMc}`);
} else {
  copyFileSync(mcCore, join(out, "mc-core.mjs"));
  console.warn("warning: no mc-core.browser.mjs — browser import may fail; run scripts/browserify-mc-core.sh");
}

// Self-contained deploy: serve.mjs at stage root (Docker / release tarball entry).
const serveSrc = join(demoDir, "serve.mjs");
if (existsSync(serveSrc)) {
  copyFileSync(serveSrc, join(out, "serve.mjs"));
}

// Break Cloudflare immutable cache of bare /agent-os/src/main.js:
// 1) Copy entry module to a content-addressed filename (new URL every stage).
// 2) Point index.html at that file + hashed CSS.
// Relative imports from main stay same-dir (./foo.js) so the copy works.
const mainPath = join(out, "src", "main.js");
const cssPath = join(out, "demo", "styles.css");
const indexPath = join(out, "demo", "index.html");
if (existsSync(mainPath) && existsSync(indexPath)) {
  const short = (p) =>
    existsSync(p)
      ? createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12)
      : "0";
  const mainV = short(mainPath);
  const cssV = short(cssPath);
  const entryName = `main.${mainV}.js`;
  copyFileSync(mainPath, join(out, "src", entryName));
  let html = readFileSync(indexPath, "utf8");
  if (!html.includes("data-occ-cache-bust")) {
    const boot = `<script data-occ-cache-bust>
(function () {
  try {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then(function (rs) {
        rs.forEach(function (r) { r.unregister(); });
      });
    }
    if (window.caches && caches.keys) {
      caches.keys().then(function (keys) {
        keys
          .filter(function (k) { return k.indexOf("occ-cad-static-") === 0; })
          .forEach(function (k) { caches.delete(k); });
      });
    }
  } catch (_) {}
})();
</script>`;
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n    ${boot}`);
  }
  // Prefer content-addressed entry (never collides with CF immutable main.js).
  html = html.replace(
    /src="\/agent-os\/src\/main(?:\.[a-f0-9]+)?\.js[^"]*"/g,
    `src="/agent-os/src/${entryName}"`,
  );
  // Fallback if template still uses plain main.js without prior rewrite match
  if (!html.includes(entryName)) {
    html = html.replace(
      /src="\/agent-os\/src\/main\.js[^"]*"/g,
      `src="/agent-os/src/${entryName}"`,
    );
  }
  html = html.replace(
    /href="\.\/styles\.css[^"]*"/g,
    `href="./styles.css?v=${cssV}"`,
  );
  if (!html.includes('name="occ-stage"')) {
    const stamp =
      process.env.CAD_RESOLVED_TAG ||
      process.env.STAGE_STAMP ||
      mainV;
    html = html.replace(
      /<\/head>/i,
      `    <meta name="occ-stage" content="${stamp}" />\n  </head>`,
    );
  }
  writeFileSync(indexPath, html);
  console.log(`staged index.html entry=/agent-os/src/${entryName} styles?v=${cssV}`);
}

console.log(`staged → ${out}`);