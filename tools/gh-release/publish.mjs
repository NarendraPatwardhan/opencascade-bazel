#!/usr/bin/env node
// publish.mjs — cut a GitHub release over the REST API (no `gh` CLI).
//
// Pattern: agent-os //bazel/tools/gh-release (REST, idempotent re-upload, SHA256SUMS).
// Auth: GITHUB_TOKEN / GH_TOKEN, or --token-file (nml-style key file; never commit).
//
// GitHub flow:
//   GET  /repos/{repo}/releases/tags/{tag}
//   POST /repos/{repo}/releases
//   POST uploads.github.com/.../assets?name=
//
// Env:
//   MC_RELEASE_REPO    "owner/repo" (overridable with --repo)
//   MC_RELEASE_ASSETS  JSON {assetName: path}  absolute or relative to cwd / RUNFILES_DIR
//
//   node tools/gh-release/publish.mjs --tag demo-v0.1.0 --notes-file NOTES.md
//   node tools/gh-release/publish.mjs --tag demo-v0.1.0 --notes "..." --dry-run

import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";

const API = "https://api.github.com";
const UA = "opencascade-bazel-release";
const API_VERSION = "2022-11-28";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function die(msg) {
  console.error(`publish: ${msg}`);
  process.exit(1);
}

function printHelp() {
  console.error(`usage: node tools/gh-release/publish.mjs --tag <tag> (--notes <t> | --notes-file <p>) [options]

  --tag <tag>          (required) git tag for the release, e.g. demo-v0.1.0
  --notes <text>       (required, or --notes-file) release body text
  --notes-file <path>  (required, or --notes) release body from a file
  --name <name>        release title (default: the tag)
  --target <commitish> commit/branch the tag points at (default: repo default branch)
  --draft              create as a draft
  --prerelease         mark as a pre-release
  --repo <owner/repo>  override MC_RELEASE_REPO
  --token-file <path>  read token from a file instead of GITHUB_TOKEN
  --dry-run            resolve assets/notes; no GitHub calls
  -h, --help

Notes are mandatory — GitHub auto-generated notes are never used.
Set MC_RELEASE_ASSETS to a JSON object mapping asset filename → local path.`);
}

function parseArgs(argv) {
  const opts = { draft: false, prerelease: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) die(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case "--tag":
        opts.tag = val();
        break;
      case "--name":
        opts.name = val();
        break;
      case "--target":
        opts.target = val();
        break;
      case "--notes":
        opts.notes = val();
        break;
      case "--notes-file":
        opts.notesFile = val();
        break;
      case "--draft":
        opts.draft = true;
        break;
      case "--prerelease":
        opts.prerelease = true;
        break;
      case "--repo":
        opts.repo = val();
        break;
      case "--token-file":
        opts.tokenFile = val();
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        die(`unknown argument ${JSON.stringify(a)} (try --help)`);
    }
  }
  if (!opts.tag) die("missing required --tag <tag> (try --help)");
  return opts;
}

function resolveNotes(opts) {
  let body;
  if (opts.notes !== undefined) {
    body = opts.notes;
  } else if (opts.notesFile !== undefined) {
    try {
      body = readFileSync(opts.notesFile, "utf8");
    } catch (e) {
      die(`--notes-file ${opts.notesFile}: ${e.message}`);
    }
  } else {
    die("release notes required: --notes <text> or --notes-file <path>");
  }
  if (body.trim() === "") die("release notes are empty");
  return body;
}

function resolveAssets() {
  const raw = process.env.MC_RELEASE_ASSETS;
  if (!raw) die("MC_RELEASE_ASSETS not set (JSON map of assetName → path)");
  const map = JSON.parse(raw);
  const rf = process.env.RUNFILES_DIR ?? process.env.JS_BINARY__RUNFILES ?? null;
  const assets = [];
  for (const [name, rel] of Object.entries(map)) {
    let path = rel;
    if (!isAbsolute(rel)) {
      if (rf) path = join(rf, rel);
      else path = resolve(rel);
    }
    let size;
    try {
      size = statSync(path).size;
    } catch {
      die(`asset ${name} not found at ${path}`);
    }
    assets.push({ name, path, size });
  }
  if (assets.length === 0) die("no assets to publish");
  return assets;
}

function sha256SumsAsset(assets) {
  const lines = assets
    .slice()
    .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))
    .map((a) => `${createHash("sha256").update(readFileSync(a.path)).digest("hex")}  ${a.name}`);
  const bytes = Buffer.from(lines.join("\n") + "\n", "utf8");
  return { name: "SHA256SUMS", bytes, size: bytes.length };
}

function readToken(opts) {
  if (opts.tokenFile) return readFileSync(opts.tokenFile, "utf8").trim();
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!t) die("no token: set GITHUB_TOKEN (or GH_TOKEN), or --token-file <path>");
  return t.trim();
}

async function ghFetch(
  url,
  { method = "GET", token, body, contentType, accept = "application/vnd.github+json" } = {},
) {
  const headers = { Accept: accept, "User-Agent": UA, "X-GitHub-Api-Version": API_VERSION };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (contentType) headers["Content-Type"] = contentType;
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { method, headers, body });
      if (res.status < 500) return res;
      lastErr = new Error(`${method} ${url} -> ${res.status} ${res.statusText}`);
    } catch (e) {
      lastErr = e;
    }
    if (attempt < 4) await sleep(500 * 2 ** (attempt - 1));
  }
  throw lastErr;
}

async function errBody(res, ctx) {
  let detail = "";
  try {
    detail = JSON.stringify(await res.json());
  } catch {
    /* ignore */
  }
  return `${ctx}: ${res.status} ${res.statusText} ${detail}`;
}

async function findRelease(repo, tag, token) {
  const res = await ghFetch(`${API}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
    token,
  });
  if (res.status === 404) return null;
  if (!res.ok) die(await errBody(res, `look up release ${tag}`));
  return res.json();
}

async function createRelease(repo, opts, body, token) {
  const payload = {
    tag_name: opts.tag,
    name: opts.name ?? opts.tag,
    body,
    draft: opts.draft,
    prerelease: opts.prerelease,
  };
  if (opts.target) payload.target_commitish = opts.target;

  const res = await ghFetch(`${API}/repos/${repo}/releases`, {
    method: "POST",
    token,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
  if (!res.ok) die(await errBody(res, `create release ${opts.tag}`));
  return res.json();
}

async function updateReleaseBody(repo, releaseId, body, token) {
  const res = await ghFetch(`${API}/repos/${repo}/releases/${releaseId}`, {
    method: "PATCH",
    token,
    contentType: "application/json",
    body: JSON.stringify({ body }),
  });
  if (!res.ok) die(await errBody(res, `update release notes`));
  return res.json();
}

async function deleteAsset(repo, assetId, token) {
  const res = await ghFetch(`${API}/repos/${repo}/releases/assets/${assetId}`, {
    method: "DELETE",
    token,
  });
  if (!res.ok && res.status !== 404) die(await errBody(res, `delete stale asset ${assetId}`));
}

async function uploadAsset(uploadUrlTemplate, asset, token) {
  const base = uploadUrlTemplate.split("{")[0];
  const url = `${base}?name=${encodeURIComponent(asset.name)}`;
  const body = asset.bytes ?? readFileSync(asset.path);
  const res = await ghFetch(url, {
    method: "POST",
    token,
    contentType: "application/octet-stream",
    body,
  });
  if (!res.ok) die(await errBody(res, `upload ${asset.name}`));
  return res.json();
}

function human(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 ** 2).toFixed(2)} MiB`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repo = opts.repo ?? process.env.MC_RELEASE_REPO;
  if (!repo) die("no repo: set MC_RELEASE_REPO or pass --repo owner/repo");
  const notes = resolveNotes(opts);
  const assets = resolveAssets();
  const sums = sha256SumsAsset(assets);
  const uploads = [...assets, sums];

  console.error(`release: ${repo} @ ${opts.tag}  (${assets.length} assets + SHA256SUMS)`);
  for (const a of uploads) console.error(`  • ${a.name.padEnd(24)} ${human(a.size).padStart(10)}`);

  if (opts.dryRun) {
    console.error(`\n--- SHA256SUMS ---\n${sums.bytes.toString("utf8").trimEnd()}`);
    console.error(
      `\n--dry-run: ${assets.length} assets + SHA256SUMS; notes (${notes.trim().length} chars); no GitHub calls.`,
    );
    console.error(`would create release ${opts.tag}${opts.draft ? " (draft)" : ""} on ${repo}.`);
    return;
  }

  const token = readToken(opts);
  let release = await findRelease(repo, opts.tag, token);
  if (release) {
    console.error(
      `\nrelease ${opts.tag} exists (#${release.id}) — reusing; syncing notes, replacing same-named assets`,
    );
    await updateReleaseBody(repo, release.id, notes, token);
  } else {
    release = await createRelease(repo, opts, notes, token);
    console.error(`\ncreated release ${opts.tag} (#${release.id})`);
  }

  const existing = new Map((release.assets ?? []).map((a) => [a.name, a.id]));
  for (const a of uploads) {
    if (existing.has(a.name)) {
      await deleteAsset(repo, existing.get(a.name), token);
    }
    const up = await uploadAsset(release.upload_url, a, token);
    console.error(
      `  uploaded ${a.name.padEnd(24)} ${human(a.size).padStart(10)}  ${up.browser_download_url}`,
    );
  }

  console.error(`\n✓ ${release.html_url}`);
}

main().catch((e) => die(e?.stack || String(e)));
