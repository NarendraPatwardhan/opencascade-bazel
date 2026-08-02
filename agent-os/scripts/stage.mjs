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

import { cpSync, mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
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

console.log(`staged → ${out}`);