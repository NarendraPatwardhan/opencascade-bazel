#!/usr/bin/env node
/**
 * Static file server for the AgentOS CAD browser demo.
 *
 * Env:
 *   DEMO_ROOT     — directory with index.html + styles.css
 *   AGENT_OS_ROOT — staged tree: kernel, loom, mc-core, batteries, src, libocc_c.*
 *   PORT          — default 8765
 *   HOST          — default 0.0.0.0 (containers / Dokploy); use 127.0.0.1 for local-only
 *   CACHE_CONTROL — optional override (default: no-store for app; wasm long-cache if release)
 *   CAD_RESOLVED_TAG / STAGE_STAMP — optional stage id stamped into HTML for debugging
 */

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, statSync, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 8765);
const host = process.env.HOST || "0.0.0.0";
const here = fileURLToPath(new URL(".", import.meta.url));

// When serve.mjs lives at stage root (release tarball), default roots are stage/demo + stage.
const stageSibling = resolve(here, "demo");
const defaultDemo = existsSync(join(stageSibling, "index.html")) ? stageSibling : here;
const defaultAgent =
  existsSync(join(here, "libocc_c.wasm")) ? here : join(here, "..", "vendor-stage");

const demoRoot = resolve(process.env.DEMO_ROOT || defaultDemo);
const agentOsRoot = resolve(process.env.AGENT_OS_ROOT || defaultAgent);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".tar": "application/octet-stream",
  ".luau": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
};

/** Long-cache only heavy binaries (and emcc/mc-core glue). Everything else is no-store. */
function isLongCacheAsset(ext, reqPath = "") {
  if (ext === ".wasm" || ext === ".tar") return true;
  if (ext !== ".js" && ext !== ".mjs") return false;
  return (
    reqPath.endsWith("libocc_c.js") ||
    reqPath.endsWith("mc-core.mjs") ||
    reqPath.endsWith("mc-core.browser.mjs")
  );
}

/**
 * Cache headers. Cloudflare "Browser Cache TTL" / edge cache can ignore bare
 * `no-cache` and re-serve stale main.js for hours or (with immutable) a year.
 * App code must use no-store + CDN-Cache-Control so edges never pin deploys.
 */
function cacheHeaders(ext, reqPath = "") {
  const headers = {
    "cross-origin-opener-policy": "same-origin",
  };
  if (process.env.CACHE_CONTROL) {
    headers["cache-control"] = process.env.CACHE_CONTROL;
    return headers;
  }
  if (process.env.CACHE_MODE === "release" && isLongCacheAsset(ext, reqPath)) {
    headers["cache-control"] =
      ext === ".js" || ext === ".mjs"
        ? "public, max-age=86400"
        : "public, max-age=31536000, immutable";
    return headers;
  }
  // App HTML/JS/CSS: never cache at browser or CDN edge.
  headers["cache-control"] = "no-store, no-cache, must-revalidate, max-age=0";
  headers["cdn-cache-control"] = "no-store";
  headers["cloudflare-cdn-cache-control"] = "no-store";
  headers["pragma"] = "no-cache";
  headers["expires"] = "0";
  return headers;
}

function shortHash(filePath) {
  if (!existsSync(filePath)) return "0";
  return createHash("sha256").update(readFileSync(filePath)).digest("hex").slice(0, 12);
}

/**
 * Inject content-hash query on main.js / styles so a new stage cannot share a
 * Cloudflare/SW cache key with a previous deploy. Also kill stale SW caches
 * that once cache-firsted all of /agent-os/* (including main.js).
 */
function decorateIndexHtml(raw) {
  let html = String(raw);
  const mainV = shortHash(join(agentOsRoot, "src", "main.js"));
  const cssV = shortHash(join(demoRoot, "styles.css"));
  const stageV =
    process.env.CAD_RESOLVED_TAG ||
    process.env.STAGE_STAMP ||
    mainV;

  // One-shot boot: unregister SW + drop occ-cad-static-* caches (old v1 pinned main.js).
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

  html = html.replace(
    /src="\/agent-os\/src\/main\.js[^"]*"/g,
    `src="/agent-os/src/main.js?v=${mainV}"`,
  );
  html = html.replace(
    /href="\.\/styles\.css[^"]*"/g,
    `href="./styles.css?v=${cssV}"`,
  );
  if (!html.includes('name="occ-stage"')) {
    html = html.replace(
      /<\/head>/i,
      `    <meta name="occ-stage" content="${stageV}" />\n  </head>`,
    );
  }
  return html;
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0]);
  const rel = decoded.replace(/^\/+/, "");
  const full = normalize(join(root, rel));
  if (!full.startsWith(root)) return null;
  return full;
}

function send(res, code, body, type, ext, reqPath = "") {
  res.writeHead(code, {
    "content-type": type || "text/plain; charset=utf-8",
    ...cacheHeaders(ext || "", reqPath),
  });
  res.end(body);
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    let path = url.pathname;

    if (path === "/healthz" || path === "/health") {
      return send(res, 200, "ok\n", "text/plain; charset=utf-8");
    }

    // Browsers always request /favicon.ico; avoid a noisy console 404.
    if (path === "/favicon.ico") {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#1a1a1a"/><text x="16" y="22" text-anchor="middle" font-size="14" font-family="system-ui,sans-serif" fill="#8cf">C</text></svg>`;
      res.writeHead(200, {
        "content-type": "image/svg+xml",
        "cache-control": "public, max-age=86400",
      });
      return res.end(svg);
    }

    if (path === "/" || path === "/index.html") {
      const html = decorateIndexHtml(readFileSync(join(demoRoot, "index.html"), "utf8"));
      return send(res, 200, html, TYPES[".html"], ".html", path);
    }
    if (path === "/styles.css" || path === "/demo/styles.css") {
      return send(
        res,
        200,
        readFileSync(join(demoRoot, "styles.css")),
        TYPES[".css"],
        ".css",
        path,
      );
    }

    // /agent-os/* → staged product tree
    if (path.startsWith("/agent-os/")) {
      const rel = path.slice("/agent-os/".length);
      const file = safeJoin(agentOsRoot, rel);
      if (!file || !existsSync(file) || !statSync(file).isFile()) {
        return send(res, 404, `not found: ${path}`);
      }
      const ext = extname(file);
      return send(
        res,
        200,
        readFileSync(file),
        TYPES[ext] || "application/octet-stream",
        ext,
        path,
      );
    }

    // allow /demo/* from demoRoot
    if (path.startsWith("/demo/")) {
      const file = safeJoin(demoRoot, path.slice("/demo/".length));
      if (file && existsSync(file) && statSync(file).isFile()) {
        const ext = extname(file);
        return send(
          res,
          200,
          readFileSync(file),
          TYPES[ext] || "application/octet-stream",
          ext,
          path,
        );
      }
    }

    send(res, 404, `not found: ${path}`);
  } catch (err) {
    send(res, 500, String(err?.stack || err));
  }
});

server.listen(port, host, () => {
  console.log(`AgentOS CAD demo`);
  console.log(`  demo root:     ${demoRoot}`);
  console.log(`  agent-os root: ${agentOsRoot}`);
  console.log(`  listen:        http://${host}:${port}/`);
});
