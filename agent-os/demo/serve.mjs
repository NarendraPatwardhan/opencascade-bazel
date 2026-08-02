#!/usr/bin/env node
/**
 * Static file server for the AgentOS CAD browser demo.
 *
 * Env:
 *   DEMO_ROOT     — directory with index.html + styles.css
 *   AGENT_OS_ROOT — staged tree: kernel, loom, mc-core, batteries, app/<hash>, src, libocc_c.*
 *   PORT          — default 8765
 *   HOST          — default 0.0.0.0 (containers / Dokploy); use 127.0.0.1 for local-only
 *   CACHE_CONTROL — optional override
 *   CAD_RESOLVED_TAG / STAGE_STAMP — optional stage id stamped into HTML
 */

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, statSync, existsSync, readdirSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 8765);
const host = process.env.HOST || "0.0.0.0";
const here = fileURLToPath(new URL(".", import.meta.url));

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

/** Content-addressed app tree: /agent-os/app/<12hex>/… — safe to immutable-cache. */
function isVersionedAppPath(reqPath = "") {
  return /\/app\/[a-f0-9]{12}\//i.test(reqPath);
}

function isBinaryGlue(ext, reqPath = "") {
  if (ext === ".wasm" || ext === ".tar") return true;
  if (ext !== ".js" && ext !== ".mjs") return false;
  return (
    reqPath.endsWith("libocc_c.js") ||
    reqPath.endsWith("mc-core.mjs") ||
    reqPath.endsWith("mc-core.browser.mjs")
  );
}

function cacheHeaders(ext, reqPath = "") {
  const headers = {
    "cross-origin-opener-policy": "same-origin",
  };
  if (process.env.CACHE_CONTROL) {
    headers["cache-control"] = process.env.CACHE_CONTROL;
    return headers;
  }
  // Whole ESM graph under app/<hash>/ changes URL every stage — long-cache OK.
  if (isVersionedAppPath(reqPath)) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
    return headers;
  }
  if (process.env.CACHE_MODE === "release" && isBinaryGlue(ext, reqPath)) {
    headers["cache-control"] =
      ext === ".js" || ext === ".mjs"
        ? "public, max-age=86400"
        : "public, max-age=31536000, immutable";
    return headers;
  }
  // Bare /agent-os/src/*, HTML, CSS: never pin at CF (poisoned immutable history).
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

/** Prefer staged app/<hash>/main.js; fall back for local non-stage trees. */
function resolveAppEntry() {
  const marker = join(agentOsRoot, "APP_HASH");
  if (existsSync(marker)) {
    const lines = readFileSync(marker, "utf8").split(/\r?\n/);
    const hashLine = lines.find((l) => /^[a-f0-9]{12}$/i.test(l.trim()));
    const entryLine = lines.find((l) => l.startsWith("entry="));
    const hash = hashLine ? hashLine.trim() : "";
    if (hash && existsSync(join(agentOsRoot, "app", hash, "main.js"))) {
      return { hash, url: `/agent-os/app/${hash}/main.js` };
    }
    if (entryLine) {
      const url = entryLine.slice("entry=".length).trim();
      if (url) return { hash: hash || "unknown", url };
    }
  }
  const appRoot = join(agentOsRoot, "app");
  if (existsSync(appRoot)) {
    try {
      const dirs = readdirSync(appRoot).filter(
        (d) =>
          /^[a-f0-9]{12}$/i.test(d) &&
          existsSync(join(appRoot, d, "main.js")),
      );
      if (dirs.length) {
        dirs.sort();
        const hash = dirs[dirs.length - 1];
        return { hash, url: `/agent-os/app/${hash}/main.js` };
      }
    } catch {
      /* */
    }
  }
  // Local checkout / old stage: bare src/main.js
  const mainV = shortHash(join(agentOsRoot, "src", "main.js"));
  return { hash: mainV, url: `/agent-os/src/main.js?v=${mainV}` };
}

function decorateIndexHtml(raw) {
  let html = String(raw);
  const { hash: appHash, url: entrySrc } = resolveAppEntry();
  const cssV = shortHash(join(demoRoot, "styles.css"));
  const stageV =
    process.env.CAD_RESOLVED_TAG ||
    process.env.STAGE_STAMP ||
    appHash;

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

  if (!html.includes('name="occ-asset-base"')) {
    html = html.replace(
      /<\/head>/i,
      `    <meta name="occ-asset-base" content="/agent-os/" />\n  </head>`,
    );
  }

  html = html.replace(
    /src="\/agent-os\/(?:src|app)\/[^"]*main[^"]*\.js[^"]*"/g,
    `src="${entrySrc}"`,
  );
  if (!html.includes(entrySrc.split("?")[0]) && !html.includes(entrySrc)) {
    html = html.replace(
      /src="\/agent-os\/src\/main\.js[^"]*"/g,
      `src="${entrySrc}"`,
    );
  }
  html = html.replace(
    /href="\.\/styles\.css[^"]*"/g,
    `href="./styles.css?v=${cssV}"`,
  );
  if (!html.includes('name="occ-stage"')) {
    html = html.replace(
      /<\/head>/i,
      `    <meta name="occ-stage" content="${stageV}" />\n    <meta name="occ-app-hash" content="${appHash}" />\n  </head>`,
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

    if (path === "/version" || path === "/STAGE_INFO" || path === "/STAGE_INFO.txt") {
      const candidates = [
        join(agentOsRoot, "VERSION"),
        join(agentOsRoot, "APP_HASH"),
        join(agentOsRoot, "STAGE_INFO.txt"),
        join(agentOsRoot, "STAGE_INFO"),
      ];
      /** @type {string[]} */
      const parts = [];
      for (const f of candidates) {
        if (existsSync(f) && statSync(f).isFile()) {
          parts.push(readFileSync(f, "utf8").trim());
        }
      }
      if (parts.length) {
        return send(
          res,
          200,
          parts.join("\n") + "\n",
          "text/plain; charset=utf-8",
          ".txt",
          path,
        );
      }
      const { url: entry } = resolveAppEntry();
      const fallback =
        `tag=${process.env.CAD_RESOLVED_TAG || "unknown"}\n` +
        `html_entry=${entry}\n` +
        `agent_os_root=${agentOsRoot}\n`;
      return send(res, 200, fallback, "text/plain; charset=utf-8", ".txt", path);
    }

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
