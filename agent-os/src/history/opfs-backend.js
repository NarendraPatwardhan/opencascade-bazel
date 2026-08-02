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
  };
}

/** @deprecated use createIdbHistoryBackend */
export function createOpfsHistoryBackend() {
  return createIdbHistoryBackend();
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
 * Prefer GitEngine when git-engine.tar + mc-core load; else IDB; else memory.
 *
 * Returns a facade immediately; the first backend call resolves git (async).
 * Pass `opts` with `assetBase` / `engineBytes` / `durableDir` for product wiring.
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
  const fallback = createFallbackHistoryBackend();
  if (!preferGit) return fallback;

  /** @type {import('./backend.js').HistoryBackend | null} */
  let resolved = null;
  /** @type {Promise<import('./backend.js').HistoryBackend> | null} */
  let resolving = null;

  async function ensure() {
    if (resolved) return resolved;
    if (!resolving) {
      resolving = (async () => {
        try {
          const { tryCreateGitHistoryBackend } = await import("./git-backend.js");
          const git = await tryCreateGitHistoryBackend(opts);
          if (git) {
            resolved = git;
            return git;
          }
        } catch {
          /* fall through */
        }
        resolved = fallback;
        return fallback;
      })();
    }
    return resolving;
  }

  /** @type {import('./backend.js').HistoryBackend} */
  const facade = {
    get kind() {
      return resolved?.kind || "default";
    },

    async open(projectId) {
      return (await ensure()).open(projectId);
    },
    async saveWorktree(projectId, doc) {
      return (await ensure()).saveWorktree(projectId, doc);
    },
    async commit(projectId, doc, o) {
      return (await ensure()).commit(projectId, doc, o);
    },
    async listVersions(projectId) {
      return (await ensure()).listVersions(projectId);
    },
    async restore(projectId, ref) {
      return (await ensure()).restore(projectId, ref);
    },
    async readVersion(projectId, ref) {
      const b = await ensure();
      if (typeof b.readVersion === "function") {
        return b.readVersion(projectId, ref);
      }
      return null;
    },
    async tip(projectId) {
      return (await ensure()).tip(projectId);
    },
    async close(projectId) {
      const b = await ensure();
      if (typeof b.close === "function") return b.close(projectId);
    },
  };

  // Expose remote ops when the resolved backend is git (panel uses these).
  Object.defineProperty(facade, "available", {
    get() {
      return resolved?.kind === "git";
    },
    enumerable: true,
  });

  /**
   * @param {string} name
   */
  function forwardRemote(name) {
    return async (...args) => {
      const b = /** @type {any} */ (await ensure());
      if (typeof b[name] === "function") {
        return b[name](...args);
      }
      return {
        ok: false,
        message: `Remote ${name} unavailable (history backend is ${b.kind || "unknown"})`,
      };
    };
  }

  /** @type {any} */ (facade).setRemote = forwardRemote("setRemote");
  /** @type {any} */ (facade).getRemote = async () => {
    const b = /** @type {any} */ (await ensure());
    if (typeof b.getRemote === "function") return b.getRemote();
    return null;
  };
  /** @type {any} */ (facade).push = forwardRemote("push");
  /** @type {any} */ (facade).pull = forwardRemote("pull");
  /** @type {any} */ (facade).clone = forwardRemote("clone");

  // Kick resolution early so kind settles before first UI paint when possible.
  void ensure();

  return facade;
}
