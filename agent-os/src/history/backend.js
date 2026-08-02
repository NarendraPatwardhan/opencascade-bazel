/**
 * HistoryBackend interface + in-memory implementation.
 *
 * Durable backends (IndexedDB snapshot, AgentOS git) implement the same surface
 * so the ProjectController can swap without UI changes.
 *
 * Document model (source authority — never meshes):
 *   main.luau, project.json, optional .cad/meta.json
 *   values{} also stored — store is SoT while scrubbing (inject-only execute).
 */

/**
 * @typedef {{
 *   id: string,
 *   name?: string,
 *   message: string,
 *   ts: number,
 *   parentId?: string | null,
 *   shortHash?: string,
 * }} HistoryCommit
 */

/**
 * @typedef {{
 *   source: string,
 *   project?: { name?: string, schema_version?: number },
 *   meta?: Record<string, any>,
 *   values?: Record<string, any>,
 * }} WorktreeDoc
 */

/**
 * @typedef {{
 *   open: (projectId: string) => Promise<WorktreeDoc | null>,
 *   saveWorktree: (projectId: string, doc: WorktreeDoc) => Promise<void>,
 *   commit: (projectId: string, doc: WorktreeDoc, opts: { name?: string, message: string }) => Promise<HistoryCommit>,
 *   listVersions: (projectId: string) => Promise<HistoryCommit[]>,
 *   restore: (projectId: string, ref: string) => Promise<WorktreeDoc>,
 *   tip: (projectId: string) => Promise<HistoryCommit | null>,
 *   readVersion?: (projectId: string, ref: string) => Promise<WorktreeDoc | null>,
 *   close?: (projectId: string) => Promise<void>,
 *   kind: string,
 * }} HistoryBackend
 */

export const MAX_VERSION_NAME = 128;
export const MAX_VERSION_MESSAGE = 512;
export const PROJECT_ID_RE = /^[a-zA-Z0-9_:-]{1,64}$/;
/**
 * Version refs: memory/IDB short ids (6–32 alnum) or full git OIDs (40 hex).
 * Accept up to 40 so GitEngine commit hashes pass validateVersionRef.
 */
export const VERSION_REF_RE = /^[a-zA-Z0-9]{6,40}$/;

/**
 * @param {string} projectId
 * @returns {string}
 */
export function sanitizeProjectId(projectId) {
  const s = String(projectId ?? "default");
  if (!PROJECT_ID_RE.test(s)) {
    throw new Error("invalid project id");
  }
  return s;
}

/**
 * @param {string | undefined} name
 * @param {boolean} required
 * @returns {string | undefined}
 */
export function validateVersionName(name, required = false) {
  if (name == null) {
    if (required) throw new Error("version name must not be empty");
    return undefined;
  }
  const trimmed = String(name).trim();
  if (trimmed === "") throw new Error("version name must not be empty");
  if (trimmed.length > MAX_VERSION_NAME) {
    throw new Error(`version name too long (max ${MAX_VERSION_NAME})`);
  }
  return trimmed;
}

/**
 * @param {string} message
 * @returns {string}
 */
export function validateVersionMessage(message) {
  const trimmed = String(message ?? "").trim() || "checkpoint";
  if (trimmed.length > MAX_VERSION_MESSAGE) {
    return trimmed.slice(0, MAX_VERSION_MESSAGE);
  }
  return trimmed;
}

/**
 * @param {string} ref
 * @returns {string}
 */
export function validateVersionRef(ref) {
  const s = String(ref ?? "").trim();
  if (!VERSION_REF_RE.test(s)) {
    throw new Error("Unknown version");
  }
  return s;
}

/**
 * Safe plain-object values map (no prototype pollution).
 * @param {Record<string, any> | null | undefined} values
 * @returns {Record<string, any>}
 */
export function sanitizeValues(values) {
  /** @type {Record<string, any>} */
  const out = Object.create(null);
  if (!values || typeof values !== "object") return out;
  for (const key of Object.keys(values)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) continue;
    const v = values[key];
    if (
      v === null ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      out[key] = v;
    }
  }
  return out;
}

/**
 * @param {any} project
 * @returns {{ name: string, schema_version: number }}
 */
export function sanitizeProject(project) {
  const name =
    project && typeof project.name === "string"
      ? project.name.slice(0, 128)
      : "untitled";
  const schema_version =
    project && typeof project.schema_version === "number"
      ? project.schema_version | 0
      : 1;
  return { name, schema_version };
}

/**
 * @param {any} meta
 * @returns {Record<string, any>}
 */
export function sanitizeMeta(meta) {
  /** @type {Record<string, any>} */
  const out = Object.create(null);
  if (!meta || typeof meta !== "object") return out;
  for (const key of Object.keys(meta)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    const v = meta[key];
    if (
      v === null ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Hardened document clone — key-filtered, null-prototype bags.
 * @param {WorktreeDoc | null | undefined} doc
 * @returns {WorktreeDoc}
 */
export function cloneDoc(doc) {
  return {
    source: String(doc?.source ?? ""),
    project: sanitizeProject(doc?.project),
    meta: sanitizeMeta(doc?.meta),
    values: sanitizeValues(doc?.values),
  };
}

/**
 * Compare source + values for dirty-vs-tip checks.
 * @param {WorktreeDoc} a
 * @param {WorktreeDoc} b
 */
export function docsContentEqual(a, b) {
  if (!a || !b) return false;
  if (String(a.source) !== String(b.source)) return false;
  const av = a.values || {};
  const bv = b.values || {};
  const keys = new Set([...Object.keys(av), ...Object.keys(bv)]);
  for (const k of keys) {
    if (av[k] !== bv[k]) return false;
  }
  return true;
}

/**
 * In-memory durable store (also used when IndexedDB is unavailable).
 * Survives for the page lifetime only.
 * @returns {HistoryBackend}
 */
export function createMemoryHistoryBackend() {
  /** @type {Map<string, { worktree: WorktreeDoc | null, commits: HistoryCommit[], blobs: Map<string, WorktreeDoc> }>} */
  const projects = new Map();

  function ensure(projectId) {
    const id = sanitizeProjectId(projectId);
    let p = projects.get(id);
    if (!p) {
      p = { worktree: null, commits: [], blobs: new Map() };
      projects.set(id, p);
    }
    return p;
  }

  function shortId() {
    return Math.random().toString(36).slice(2, 10);
  }

  return {
    kind: "memory",

    async open(projectId) {
      const p = ensure(projectId);
      return p.worktree ? cloneDoc(p.worktree) : null;
    },

    async saveWorktree(projectId, doc) {
      const p = ensure(projectId);
      p.worktree = cloneDoc(doc);
    },

    async commit(projectId, doc, opts) {
      const name = validateVersionName(opts?.name, false);
      const message = validateVersionMessage(opts?.message || name || "checkpoint");
      const p = ensure(projectId);
      const id = shortId();
      const parentId = p.commits.length
        ? p.commits[p.commits.length - 1].id
        : null;
      const entry = {
        id,
        name: name || undefined,
        message,
        ts: Date.now(),
        parentId,
        shortHash: id.slice(0, 7),
      };
      p.blobs.set(id, cloneDoc(doc));
      p.commits.push(entry);
      p.worktree = cloneDoc(doc);
      return { ...entry };
    },

    async listVersions(projectId) {
      const p = ensure(projectId);
      return p.commits
        .slice()
        .reverse()
        .map((c) => ({ ...c }));
    },

    async restore(projectId, ref) {
      const id = validateVersionRef(ref);
      const p = ensure(projectId);
      const blob = p.blobs.get(id);
      if (!blob) throw new Error("Unknown version");
      p.worktree = cloneDoc(blob);
      return cloneDoc(blob);
    },

    /**
     * Read a commit blob without mutating worktree (for tip dirty compare).
     * @param {string} projectId
     * @param {string} ref
     */
    async readVersion(projectId, ref) {
      const id = validateVersionRef(ref);
      const p = ensure(projectId);
      const blob = p.blobs.get(id);
      return blob ? cloneDoc(blob) : null;
    },

    async tip(projectId) {
      const p = ensure(projectId);
      if (!p.commits.length) return null;
      return { ...p.commits[p.commits.length - 1] };
    },

    async close(projectId) {
      try {
        projects.delete(sanitizeProjectId(projectId));
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Product-local git identity — never read host gitconfig.
 */
export const PRODUCT_GIT_IDENTITY = Object.freeze({
  name: "occ_c",
  email: "cad@local",
});
