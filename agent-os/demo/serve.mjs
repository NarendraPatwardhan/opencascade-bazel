#!/usr/bin/env node
/**
 * Static file server for the AgentOS CAD browser demo.
 *
 * Env (from Bazel runfiles or local vendor/):
 *   DEMO_ROOT   — directory with index.html + styles.css
 *   AGENT_OS_ROOT — staged tree: kernel, loom, mc-core, batteries, src, libocc_c.*
 *   PORT        — default 8765
 */

import { createServer } from "node:http";
import { readFileSync, statSync, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 8765);
const demoRoot = resolve(
  process.env.DEMO_ROOT || join(fileURLToPath(new URL(".", import.meta.url))),
);
const agentOsRoot = resolve(
  process.env.AGENT_OS_ROOT || join(demoRoot, "..", "vendor-stage"),
);

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

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0]);
  const rel = decoded.replace(/^\/+/, "");
  const full = normalize(join(root, rel));
  if (!full.startsWith(root)) return null;
  return full;
}

function send(res, code, body, type) {
  res.writeHead(code, {
    "content-type": type || "text/plain; charset=utf-8",
    "cache-control": "no-cache",
    "cross-origin-opener-policy": "same-origin",
    // COOP/COEP not required for basic wasm; keep simple for demo.
  });
  res.end(body);
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    let path = url.pathname;

    if (path === "/" || path === "/index.html") {
      const html = readFileSync(join(demoRoot, "index.html"));
      return send(res, 200, html, TYPES[".html"]);
    }
    if (path === "/styles.css" || path === "/demo/styles.css") {
      return send(res, 200, readFileSync(join(demoRoot, "styles.css")), TYPES[".css"]);
    }

    // /agent-os/* → staged product tree
    if (path.startsWith("/agent-os/")) {
      const rel = path.slice("/agent-os/".length);
      const file = safeJoin(agentOsRoot, rel);
      if (!file || !existsSync(file) || !statSync(file).isFile()) {
        return send(res, 404, `not found: ${path}`);
      }
      const ext = extname(file);
      return send(res, 200, readFileSync(file), TYPES[ext] || "application/octet-stream");
    }

    // allow /demo/* from demoRoot
    if (path.startsWith("/demo/")) {
      const file = safeJoin(demoRoot, path.slice("/demo/".length));
      if (file && existsSync(file) && statSync(file).isFile()) {
        return send(res, 200, readFileSync(file), TYPES[extname(file)] || "application/octet-stream");
      }
    }

    send(res, 404, `not found: ${path}`);
  } catch (err) {
    send(res, 500, String(err?.stack || err));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`AgentOS CAD demo`);
  console.log(`  demo root:     ${demoRoot}`);
  console.log(`  agent-os root: ${agentOsRoot}`);
  console.log(`  open http://127.0.0.1:${port}/`);
});
