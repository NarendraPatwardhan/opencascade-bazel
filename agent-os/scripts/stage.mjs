#!/usr/bin/env node
/**
 * Stage a directory tree for the demo server / smoke / release tarball:
 *
 *   out/
 *     kernel.wasm loom.tar mc-core.mjs catalog-compiler.wasm git-engine.tar
 *     libocc_c.js libocc_c.wasm
 *     batteries/**
 *     app/<content-hash>/**    ← browser app modules (whole tree versioned)
 *     src/**                    ← same tree (local/dev paths, diagnostics)
 *     demo/**
 *     serve.mjs
 *
 * WHY app/<hash>/:
 *   We ship unbundled ESM. Sibling imports (./demos/foo.js) use stable URLs if
 *   only main.js is renamed. Cloudflare still holds year-long immutable
 *   responses for bare /agent-os/src/*.js from earlier deploys → mixed graphs
 *   ("does not provide an export named X"). Versioning the entire app tree
 *   makes every module URL unique per stage.
 */

import {
  cpSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return resolve(v);
}

function sha12(buf) {
  return createHash("sha256").update(buf).digest("hex").slice(0, 12);
}

function sha12File(p) {
  return sha12(readFileSync(p));
}

/** Fingerprint every file under dir (relative path + bytes). */
function hashTree(dir) {
  const h = createHash("sha256");
  /** @type {string[]} */
  const files = [];
  function walk(d) {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile()) files.push(p);
    }
  }
  walk(dir);
  files.sort();
  for (const p of files) {
    h.update(relative(dir, p).split("\\").join("/"));
    h.update("\0");
    h.update(readFileSync(p));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 12);
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
mkdirSync(join(out, "app"), { recursive: true });

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
if (existsSync(batteriesDir)) {
  cpSync(batteriesDir, join(out, "batteries"), { recursive: true });
} else {
  copyFileSync(solid, join(out, "batteries/solid.luau"));
}
cpSync(srcDir, join(out, "src"), { recursive: true });
cpSync(demoDir, join(out, "demo"), { recursive: true });

const browserMc = process.env.AGENT_OS_MC_CORE_BROWSER
  || join(dirname(mcCore), "mc-core.browser.mjs");
if (existsSync(browserMc)) {
  copyFileSync(browserMc, join(out, "mc-core.mjs"));
  console.log(`using browser mc-core: ${browserMc}`);
} else {
  copyFileSync(mcCore, join(out, "mc-core.mjs"));
  console.warn("warning: no mc-core.browser.mjs — browser import may fail; run scripts/browserify-mc-core.sh");
}

const serveSrc = join(demoDir, "serve.mjs");
if (existsSync(serveSrc)) {
  copyFileSync(serveSrc, join(out, "serve.mjs"));
}

// --- Versioned app tree (entire ESM graph) ---
const appHash = hashTree(join(out, "src"));
const appDir = join(out, "app", appHash);
cpSync(join(out, "src"), appDir, { recursive: true });

const cssPath = join(out, "demo", "styles.css");
const indexPath = join(out, "demo", "index.html");
const cssV = existsSync(cssPath) ? sha12File(cssPath) : "0";
const entryUrl = `/agent-os/app/${appHash}/main.js`;

if (existsSync(indexPath)) {
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

  // Absolute asset root for wasm/kernel (not relative to app/<hash>/).
  if (!html.includes('name="occ-asset-base"')) {
    html = html.replace(
      /<\/head>/i,
      `    <meta name="occ-asset-base" content="/agent-os/" />\n  </head>`,
    );
  }
  if (!html.includes('name="occ-stage"')) {
    const stamp =
      process.env.CAD_RESOLVED_TAG ||
      process.env.STAGE_STAMP ||
      appHash;
    html = html.replace(
      /<\/head>/i,
      `    <meta name="occ-stage" content="${stamp}" />\n    <meta name="occ-app-hash" content="${appHash}" />\n  </head>`,
    );
  }

  html = html.replace(
    /src="\/agent-os\/(?:src|app)\/[^"]*main[^"]*\.js[^"]*"/g,
    `src="${entryUrl}"`,
  );
  if (!html.includes(entryUrl)) {
    html = html.replace(
      /src="\/agent-os\/src\/main\.js[^"]*"/g,
      `src="${entryUrl}"`,
    );
  }
  html = html.replace(
    /href="\.\/styles\.css[^"]*"/g,
    `href="./styles.css?v=${cssV}"`,
  );
  writeFileSync(indexPath, html);
  console.log(`staged index.html entry=${entryUrl} appHash=${appHash} styles?v=${cssV}`);
}

// Marker for serve.mjs /version
writeFileSync(
  join(out, "APP_HASH"),
  `${appHash}\nentry=${entryUrl}\n`,
);

console.log(`staged → ${out}`);
