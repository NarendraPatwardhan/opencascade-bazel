#!/usr/bin/env node
/**
 * Static file server for the AgentOS CAD browser demo.
 *
 * Env:
 *   DEMO_ROOT     — directory with index.html + styles.css
 *   AGENT_OS_ROOT — staged tree: kernel, loom, mc-core, batteries, src, libocc_c.*
 *   PORT          — default 8765
 *   HOST          — default 0.0.0.0 (containers / Dokploy); use 127.0.0.1 for local-only
 *   CACHE_CONTROL — optional override (default: no-cache; wasm/js long-cache if "release")
 */

import { createServer } from "node:http";
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

function cacheControl(ext) {
  if (process.env.CACHE_CONTROL) return process.env.CACHE_CONTROL;
  if (process.env.CACHE_MODE === "release" && (ext === ".wasm" || ext === ".js" || ext === ".mjs" || ext === ".tar")) {
    return "public, max-age=31536000, immutable";
  }
  return "no-cache";
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0]);
  const rel = decoded.replace(/^\/+/, "");
  const full = normalize(join(root, rel));
  if (!full.startsWith(root)) return null;
  return full;
}

function send(res, code, body, type, ext) {
  res.writeHead(code, {
    "content-type": type || "text/plain; charset=utf-8",
    "cache-control": cacheControl(ext || ""),
    "cross-origin-opener-policy": "same-origin",
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
      const html = readFileSync(join(demoRoot, "index.html"));
      return send(res, 200, html, TYPES[".html"], ".html");
    }
    if (path === "/styles.css" || path === "/demo/styles.css") {
      return send(res, 200, readFileSync(join(demoRoot, "styles.css")), TYPES[".css"], ".css");
    }

    // /agent-os/* → staged product tree
    if (path.startsWith("/agent-os/")) {
      const rel = path.slice("/agent-os/".length);
      const file = safeJoin(agentOsRoot, rel);
      if (!file || !existsSync(file) || !statSync(file).isFile()) {
        return send(res, 404, `not found: ${path}`);
      }
      const ext = extname(file);
      return send(res, 200, readFileSync(file), TYPES[ext] || "application/octet-stream", ext);
    }

    // allow /demo/* from demoRoot
    if (path.startsWith("/demo/")) {
      const file = safeJoin(demoRoot, path.slice("/demo/".length));
      if (file && existsSync(file) && statSync(file).isFile()) {
        const ext = extname(file);
        return send(res, 200, readFileSync(file), TYPES[ext] || "application/octet-stream", ext);
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
