/**
 * Browser snapshot history backend (IndexedDB).
 *
 * Same UX surface as git versions without requiring git-engine packaging.
 * Stores commits as JSON snapshots keyed by project id.
 *
 * kind: "idb" when durable storage works; "memory" if init fails at factory.
 * (Named historically "OPFS"; storage is IndexedDB for wide browser support.)
 *
 * Graceful: if storage APIs missing or fail, falls back to memory backend.
 */

import {
  cloneDoc,
  createMemoryHistoryBackend,
  PRODUCT_GIT_IDENTITY,
  sanitizeProjectId,
  validateVersionName,
  validateVersionMessage,
  validateVersionRef,
} from "./backend.js";

const DB_NAME = "occ_c_cad_history";
const DB_VERSION = 1;
const STORE = "projects";

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error("idb open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "projectId" });
      }
    };
  });
}

/**
 * @param {IDBDatabase} db
 * @param {string} projectId
 */
function idbGet(db, projectId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(projectId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {IDBDatabase} db
 * @param {object} record
 */
function idbPut(db, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put(record);
    req.onsuccess = () => resolve(undefined);
    req.onerror = () => reject(req.error);
  });
}

function shortId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

/**
 * Normalize a raw IDB record into a safe in-memory shape.
 * @param {string} projectId
 * @param {any} raw
 */
function normalizeRecord(projectId, raw) {
  const identity = PRODUCT_GIT_IDENTITY;
  /** @type {{ projectId: string, worktree: any, commits: any[], blobs: Record<string, any>, identity: typeof PRODUCT_GIT_IDENTITY }} */
  const rec = {
    projectId,
    worktree: null,
    commits: [],
    blobs: Object.create(null),
    identity,
  };
  if (!raw || typeof raw !== "object") return rec;

  if (raw.worktree && typeof raw.worktree === "object") {
    try {
      rec.worktree = cloneDoc(raw.worktree);
    } catch {
      rec.worktree = null;
    }
  }

  const commitsIn = Array.isArray(raw.commits) ? raw.commits : [];
  const blobsIn =
    raw.blobs && typeof raw.blobs === "object" && !Array.isArray(raw.blobs)
      ? raw.blobs
      : Object.create(null);

  for (const c of commitsIn) {
    if (!c || typeof c !== "object") continue;
    const id = typeof c.id === "string" ? c.id : "";
    if (!VERSION_REF_RE_SOFT.test(id)) continue;
    // Only keep commits that have a matching blob.
    const blobRaw = Object.prototype.hasOwnProperty.call(blobsIn, id)
      ? blobsIn[id]
      : null;
    if (!blobRaw || typeof blobRaw !== "object") continue;
    let blob;
    try {
      blob = cloneDoc(blobRaw);
    } catch {
      continue;
    }
    rec.blobs[id] = blob;
    rec.commits.push({
      id,
      name: typeof c.name === "string" ? c.name.slice(0, 128) : undefined,
      message:
        typeof c.message === "string"
          ? c.message.slice(0, 512)
          : "checkpoint",
      ts: typeof c.ts === "number" ? c.ts : Date.now(),
      parentId: typeof c.parentId === "string" ? c.parentId : null,
      shortHash:
        typeof c.shortHash === "string" ? c.shortHash : id.slice(0, 7),
    });
  }
  return rec;
}

const VERSION_REF_RE_SOFT = /^[a-zA-Z0-9]{6,40}$/;

/**
 * IndexedDB snapshot backend.
 * @returns {import('./backend.js').HistoryBackend}
 */
export function createIdbHistoryBackend() {
  const memory = createMemoryHistoryBackend();
  /** @type {IDBDatabase | null} */
  let db = null;
  let initFailed = false;
  const identity = PRODUCT_GIT_IDENTITY;
  /** @type {Map<string, any>} */
  const projectRecords = new Map();

  async function ensureDb() {
    if (initFailed) return null;
    if (db) return db;
    try {
      db = await openDb();
      return db;
    } catch {
      initFailed = true;
      db = null;
      return null;
    }
  }

  /**
   * @param {string} projectId
   */
  async function hydrate(projectId) {
    if (projectRecords.has(projectId)) return;
    const d = await ensureDb();
    if (!d) return;
    try {
      const raw = await idbGet(d, projectId);
      if (!raw) return;
      const rec = normalizeRecord(projectId, raw);
      projectRecords.set(projectId, rec);
      if (rec.worktree) {
        await memory.saveWorktree(projectId, rec.worktree);
      }
    } catch {
      /* ignore hydrate errors — leave empty */
    }
  }

  async function persist(projectId) {
    const d = await ensureDb();
    if (!d) return;
    const rec = projectRecords.get(projectId);
    if (!rec) return;
    // Serialize null-prototype blobs to plain object for IDB.
    const blobsPlain = Object.create(null);
    for (const k of Object.keys(rec.blobs)) {
      if (Object.prototype.hasOwnProperty.call(rec.blobs, k)) {
        blobsPlain[k] = rec.blobs[k];
      }
    }
    try {
      await idbPut(d, {
        projectId: rec.projectId,
        worktree: rec.worktree,
        commits: rec.commits,
        blobs: blobsPlain,
        identity,
      });
    } catch {
      /* quota / private mode */
    }
  }

  function getRec(projectId) {
    let rec = projectRecords.get(projectId);
    if (!rec) {
      rec = {
        projectId,
        worktree: null,
        commits: [],
        blobs: Object.create(null),
        identity,
      };
      projectRecords.set(projectId, rec);
    }
    return rec;
  }

  return {
    // Durable path is IndexedDB (not OPFS file handles).
    kind: "idb",

    async open(projectId) {
      const id = sanitizeProjectId(projectId);
      try {
        await hydrate(id);
      } catch {
        /* open fails soft → seed path */
      }
      const rec = projectRecords.get(id);
      if (rec?.worktree) return cloneDoc(rec.worktree);
      try {
        return await memory.open(id);
      } catch {
        return null;
      }
    },

    async saveWorktree(projectId, doc) {
      const id = sanitizeProjectId(projectId);
      const rec = getRec(id);
      rec.worktree = cloneDoc(doc);
      await memory.saveWorktree(id, doc);
      void persist(id);
    },

    async commit(projectId, doc, opts) {
      const id = sanitizeProjectId(projectId);
      const name = validateVersionName(opts?.name, false);
      const message = validateVersionMessage(
        opts?.message || name || "checkpoint",
      );
      const rec = getRec(id);
      const commitId = shortId();
      const parentId = rec.commits.length
        ? rec.commits[rec.commits.length - 1].id
        : null;
      const entry = {
        id: commitId,
        name: name || undefined,
        message,
        ts: Date.now(),
        parentId,
        shortHash: commitId.slice(0, 7),
        auto: !name || /^auto\s*·/i.test(message),
      };
      rec.blobs[commitId] = cloneDoc(doc);
      rec.commits.push(entry);
      rec.worktree = cloneDoc(doc);
      await memory.saveWorktree(id, doc);
      await persist(id);
      return { ...entry };
    },

    async listVersions(projectId) {
      const id = sanitizeProjectId(projectId);
      await hydrate(id);
      const rec = projectRecords.get(id);
      if (!rec) return memory.listVersions(id);
      return rec.commits
        .slice()
        .reverse()
        .map((c) => ({ ...c }));
    },

    async restore(projectId, ref) {
      const id = sanitizeProjectId(projectId);
      const refId = validateVersionRef(ref);
      await hydrate(id);
      const rec = getRec(id);
      if (!Object.prototype.hasOwnProperty.call(rec.blobs, refId)) {
        throw new Error("Unknown version");
      }
      const blob = rec.blobs[refId];
      if (!blob || typeof blob !== "object") {
        throw new Error("Unknown version");
      }
      rec.worktree = cloneDoc(blob);
      await memory.saveWorktree(id, blob);
      void persist(id);
      return cloneDoc(blob);
    },

    async readVersion(projectId, ref) {
      const id = sanitizeProjectId(projectId);
      const refId = validateVersionRef(ref);
      await hydrate(id);
      const rec = projectRecords.get(id);
      if (!rec || !Object.prototype.hasOwnProperty.call(rec.blobs, refId)) {
        return null;
      }
      const blob = rec.blobs[refId];
      return blob && typeof blob === "object" ? cloneDoc(blob) : null;
    },

    async tip(projectId) {
      const id = sanitizeProjectId(projectId);
      await hydrate(id);
      const rec = projectRecords.get(id);
      if (!rec?.commits?.length) return null;
      return { ...rec.commits[rec.commits.length - 1] };
    },

    async clear(projectId) {
      const id = sanitizeProjectId(projectId);
      projectRecords.delete(id);
      await memory.clear(id);
      try {
        const d = await openDb();
        await new Promise((resolve, reject) => {
          const tx = d.transaction(STORE, "readwrite");
          const req = tx.objectStore(STORE).delete(id);
          req.onsuccess = () => resolve(undefined);
          req.onerror = () => reject(req.error);
        });
      } catch {
        /* private mode / no idb */
      }
    },
  };
}

/**
 * Secondary snapshot store (IDB when available, else memory).
 * @returns {import('./backend.js').HistoryBackend}
 */
function createFallbackHistoryBackend() {
  if (typeof indexedDB !== "undefined") {
    try {
      return createIdbHistoryBackend();
    } catch {
      /* fall through */
    }
  }
  return createMemoryHistoryBackend();
}

/**
 * Product history backend: **IDB/memory is always the UI timeline** (reliable
 * in browser). Optionally dual-writes to AgentOS GitEngine when it loads.
 *
 * Why hybrid: pure git-only path often left the History drawer empty when
 * engine load/commit failed silently in the browser. Overleaf-style UX needs
 * a list that always works.
 *
 * @param {{
 *   assetBase?: string,
 *   engineBytes?: Uint8Array,
 *   engineUrl?: string,
 *   enginePath?: string,
 *   mcUrl?: string,
 *   mcModule?: any,
 *   durableDir?: string,
 *   projectId?: string,
 *   preferGit?: boolean,
 * }} [opts]
 * @returns {import('./backend.js').HistoryBackend}
 */
export function createDefaultHistoryBackend(opts = {}) {
  const preferGit = opts.preferGit !== false;
  const primary = createFallbackHistoryBackend(); // idb or memory

  /** @type {import('./backend.js').HistoryBackend | null} */
  let git = null;
  /** @type {Promise<void> | null} */
  let gitWarm = null;

  function warmGit() {
    if (!preferGit) return Promise.resolve();
    if (gitWarm) return gitWarm;
    gitWarm = (async () => {
      try {
        const { tryCreateGitHistoryBackend } = await import("./git-backend.js");
        git = await tryCreateGitHistoryBackend(opts);
      } catch (err) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn(
            "[history] GitEngine warm failed:",
            err instanceof Error ? err.message : err,
          );
        }
        git = null;
      }
    })();
    return gitWarm;
  }

  // Kick warm in background; first commit does not wait for git.
  void warmGit();

  /** @type {import('./backend.js').HistoryBackend} */
  const facade = {
    get kind() {
      return git ? `local+${git.kind}` : primary.kind || "local";
    },

    async open(projectId) {
      void warmGit();
      // Prefer primary worktree; fall back to git worktree if IDB empty.
      let doc = null;
      try {
        doc = await primary.open(projectId);
      } catch {
        doc = null;
      }
      if (!doc && git) {
        try {
          doc = await git.open(projectId);
          if (doc) await primary.saveWorktree(projectId, doc);
        } catch {
          /* */
        }
      }
      return doc;
    },

    async saveWorktree(projectId, doc) {
      await primary.saveWorktree(projectId, doc);
      if (git) {
        try {
          await git.saveWorktree(projectId, doc);
        } catch {
          /* best-effort */
        }
      }
    },

    async commit(projectId, doc, o) {
      // UI timeline always from primary (IDB) so listVersions is never empty
      // after a successful local commit.
      const entry = await primary.commit(projectId, doc, o);
      if (git) {
        try {
          await git.commit(projectId, doc, o);
        } catch (err) {
          if (typeof console !== "undefined" && console.warn) {
            console.warn(
              "[history] git dual-write commit failed:",
              err instanceof Error ? err.message : err,
            );
          }
        }
      }
      return entry;
    },

    async listVersions(projectId) {
      void warmGit();
      let list = [];
      try {
        list = (await primary.listVersions(projectId)) || [];
      } catch {
        list = [];
      }
      // If primary empty but git has history (e.g. after reload with only git durable).
      if (!list.length && git) {
        try {
          const g = (await git.listVersions(projectId)) || [];
          if (g.length) {
            // Mirror into primary so future lists stay local.
            for (let i = g.length - 1; i >= 0; i--) {
              const v = g[i];
              try {
                const blob =
                  typeof git.readVersion === "function"
                    ? await git.readVersion(projectId, v.id)
                    : null;
                if (blob) {
                  await primary.commit(projectId, blob, {
                    name: v.name,
                    message: v.message,
                  });
                }
              } catch {
                /* skip one */
              }
            }
            list = (await primary.listVersions(projectId)) || g;
          }
        } catch {
          /* */
        }
      }
      return list;
    },

    async restore(projectId, ref) {
      // Prefer primary (ids are from primary list).
      try {
        return await primary.restore(projectId, ref);
      } catch (e) {
        if (git) {
          const doc = await git.restore(projectId, ref);
          await primary.saveWorktree(projectId, doc);
          return doc;
        }
        throw e;
      }
    },

    async readVersion(projectId, ref) {
      if (typeof primary.readVersion === "function") {
        const d = await primary.readVersion(projectId, ref);
        if (d) return d;
      }
      if (git && typeof git.readVersion === "function") {
        return git.readVersion(projectId, ref);
      }
      return null;
    },

    async tip(projectId) {
      try {
        const t = await primary.tip(projectId);
        if (t) return t;
      } catch {
        /* */
      }
      if (git) {
        try {
          return await git.tip(projectId);
        } catch {
          /* */
        }
      }
      return null;
    },

    async close(projectId) {
      if (typeof primary.close === "function") await primary.close(projectId);
      if (git && typeof git.close === "function") await git.close(projectId);
    },

    async clear(projectId) {
      if (typeof primary.clear === "function") {
        await primary.clear(projectId);
      }
      if (git && typeof /** @type {any} */ (git).clear === "function") {
        try {
          await /** @type {any} */ (git).clear(projectId);
        } catch {
          /* best-effort */
        }
      }
      // Drop git instance so next warm is a clean engine/repo.
      if (git) {
        try {
          if (typeof git.close === "function") await git.close(projectId);
        } catch {
          /* */
        }
      }
      git = null;
      gitWarm = null;
      void warmGit();
    },
  };

  return facade;
}
