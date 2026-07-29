import { showMesh } from "./mesh-view.js";
import { mountLuauEditor } from "./luau-editor.js";

const DEFAULT_SOURCE = `local solid = require("solid")

local block = solid.box({ dx = 20, dy = 20, dz = 12 })
local drill = solid.cylinder({
  radius = 4,
  height = 16,
  origin = { 10, 10, -2 },
  axis = { 0, 0, 1 },
})
local part = solid.cut(block, drill)
solid.finish(part, { name = "block_hole" })
`;

const els = {
  editorHost: document.querySelector("#editor"),
  run: document.querySelector("#run"),
  warm: document.querySelector("#warm"),
  status: document.querySelector("#status"),
  log: document.querySelector("#log"),
  viewport: document.querySelector("#viewport"),
  meta: document.querySelector("#meta"),
};

/** @type {Awaited<ReturnType<typeof mountLuauEditor>> | null} */
let editor = null;
let disposeView = null;
let nextId = 1;
/** @type {Worker | null} */
let worker = null;
/** @type {Map<number, { resolve: Function, reject: Function }>} */
const pending = new Map();
/** @type {Promise<void> | null} */
let configReady = null;

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.dataset.error = isError ? "1" : "0";
}

function appendLog(line) {
  els.log.textContent += line + "\n";
  els.log.scrollTop = els.log.scrollHeight;
}

function getSource() {
  return editor ? editor.getValue() : DEFAULT_SOURCE;
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./runtime-worker.js", import.meta.url), {
    type: "module",
    name: "occ-cad-runtime",
  });
  worker.onmessage = (ev) => {
    const msg = ev.data;
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    if (msg.code === 0) slot.resolve(msg);
    else slot.reject(new Error(msg.error || `worker code ${msg.code}`));
  };
  worker.onerror = (ev) => {
    setStatus(`Worker error: ${ev.message}`, true);
    appendLog(`worker error: ${ev.message}`);
  };
  // import.meta.url is …/agent-os/src/main.js → assets at …/agent-os/
  const base = new URL("../", import.meta.url).href;
  configReady = callWorker({ kind: "config", assetBase: base }).then(() => undefined);
  configReady.catch((err) => {
    appendLog(`config failed: ${err.message}`);
  });
  return worker;
}

function callWorker(payload, timeoutMs = 180_000) {
  ensureWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    worker.postMessage({ ...payload, id });
  });
}

async function ensureConfigured() {
  ensureWorker();
  if (configReady) await configReady;
}

async function runSource() {
  els.run.disabled = true;
  setStatus("Running Luau…");
  els.log.textContent = "";
  try {
    await ensureConfigured();
    const reply = await callWorker(
      {
        kind: "execute",
        source: getSource(),
        deflection: 0.2,
      },
      300_000,
    );
    const m = reply.mesh;
    if (!m?.positions || !m?.indices) throw new Error("no mesh in reply");
    setStatus(
      `OK — ${m.vertexCount ?? m.positions.length / 3} verts, ` +
        `${((m.indexCount ?? m.indices.length) / 3) | 0} tris` +
        (m.volume != null ? `, vol≈${m.volume.toFixed(2)}` : ""),
    );
    els.meta.textContent = JSON.stringify(reply.meta, null, 2);
    if (reply.stdout) appendLog(reply.stdout.trim());
    if (disposeView) disposeView();
    disposeView = await showMesh(els.viewport, {
      positions: m.positions,
      normals: m.normals,
      indices: m.indices,
      color: "#00a6ff",
      bbox: m.bbox,
      volume: m.volume,
    });
  } catch (err) {
    setStatus(err.message, true);
    appendLog(`error: ${err.message}`);
  } finally {
    els.run.disabled = false;
  }
}

els.warm.addEventListener("click", async () => {
  els.warm.disabled = true;
  setStatus("Warming AgentOS + OCCT (first load downloads ~35MB)…");
  try {
    await ensureConfigured();
    const reply = await callWorker({ kind: "warm" }, 300_000);
    setStatus(`Warm: OCCT ${reply.meta?.occVersion || "?"}`);
    appendLog(`warm ok: ${JSON.stringify(reply.meta)}`);
  } catch (err) {
    setStatus(err.message, true);
    appendLog(`warm failed: ${err.message}`);
  } finally {
    els.warm.disabled = false;
  }
});

els.run.addEventListener("click", () => {
  void runSource();
});

setStatus("Loading editor…");
mountLuauEditor({
  parent: els.editorHost,
  doc: DEFAULT_SOURCE,
  autoFocus: true,
  onRun: () => {
    void runSource();
  },
})
  .then((handle) => {
    editor = handle;
    setStatus("Ready — Warm once, then Run (or Mod-Enter).");
  })
  .catch((err) => {
    setStatus(`Editor failed to load: ${err.message}`, true);
    appendLog(String(err.stack || err));
    // Fallback: plain textarea so the demo still works offline/CDN-blocked.
    const ta = document.createElement("textarea");
    ta.id = "source";
    ta.spellcheck = false;
    ta.value = DEFAULT_SOURCE;
    ta.setAttribute("aria-label", "Luau source");
    els.editorHost.replaceWith(ta);
    editor = {
      getValue: () => ta.value,
      setValue: (d) => {
        ta.value = d;
      },
      focus: () => ta.focus(),
      destroy: () => undefined,
    };
    setStatus("Ready (plain textarea fallback) — Run Luau.");
  });
