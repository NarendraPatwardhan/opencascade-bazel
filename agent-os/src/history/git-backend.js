/**
 * AgentOS GitEngine history backend (real, not a stub).
 *
 * Document worktree (source authority — never meshes):
 *   main.luau
 *   project.json  — { project, meta, values }
 *
 * Identity is product-local (occ_c / cad@local) — never host gitconfig.
 *
 * Remotes: local ops via engine.run; clone/fetch/pull/push via
 * GitRemoteOrchestrator (host-mediated; credentials stay in connections,
 * never logged). Browser may lack network policy — errors are clear.
 *
 * Durable:
 *   - Node: prefer durableDir (HostDirDurable path)
 *   - Browser: AGIT blob durable (memory or OPFS snapshot) when available
 *   - After commit: engine.checkpoint() when durable is attached
 */

import {
  cloneDoc,
  PRODUCT_GIT_IDENTITY,
  sanitizeProjectId,
  validateVersionName,
  validateVersionMessage,
  validateVersionRef,
} from "./backend.js";

const SOURCE_PATH = "main.luau";
const PROJECT_PATH = "project.json";
const REMOTE_NAME = "origin";
const TOKEN_SESSION_KEY = "occ_c_git_remote_token";

/**
 * Minimal AGIT blob durable (mc-core does not re-export MemoryDurable).
 * @param {string} [id]
 * @returns {{ id: string, kind: "blob", save: Function, load: Function, clear: Function }}
 */
export function createMemoryDurable(id = "memory") {
  /** @type {Uint8Array | null} */
  let data = null;
  return {
    id: String(id || "memory"),
    kind: /** @type {const} */ ("blob"),
    async save(snapshot) {
      data = snapshot instanceof Uint8Array ? snapshot.slice() : null;
    },
    async load() {
      return data ? data.slice() : null;
    },
    async clear() {
      data = null;
    },
  };
}

/**
 * OPFS AGIT blob durable under agentos-git/{id}/snapshot.bin.
 * @param {string} [id]
 * @returns {Promise<ReturnType<typeof createMemoryDurable> | null>}
 */
export async function createOpfsBlobDurable(id = "default") {
  try {
    const nav = globalThis.navigator;
    const storage = nav && /** @type {any} */ (nav).storage;
    if (!storage || typeof storage.getDirectory !== "function") return null;
    const opfs = await storage.getDirectory();
    const agent = await opfs.getDirectoryHandle("agentos-git", { create: true });
    const root = await agent.getDirectoryHandle(String(id || "default"), {
      create: true,
    });
    return {
      id: String(id || "default"),
      kind: /** @type {const} */ ("blob"),
      async save(snapshot) {
        const fh = await root.getFileHandle("snapshot.bin", { create: true });
        const w = await fh.createWritable();
        await w.write(snapshot);
        await w.close();
      },
      async load() {
        try {
          const fh = await root.getFileHandle("snapshot.bin");
          const file = await fh.getFile();
          return new Uint8Array(await file.arrayBuffer());
        } catch {
          return null;
        }
      },
      async clear() {
        try {
          await root.removeEntry("snapshot.bin");
        } catch {
          /* missing */
        }
      },
    };
  } catch {
    return null;
  }
}

/**
 * @param {any} resp
 * @param {string} what
 */
function assertOk(resp, what) {
  if (!resp || !resp.ok) {
    const err =
      (resp && (resp.stderr || resp.stdout)) ||
      `${what} failed`;
    throw new Error(String(err).trim() || `${what} failed`);
  }
  return resp;
}

/**
 * @param {string} text
 * @returns {string}
 */
function firstLine(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean) || "";
}

/**
 * Parse `log` stdout: lines of `<40hex> <summary>` (footer lines start with #).
 * @param {string} stdout
 * @returns {Array<{ id: string, message: string, shortHash: string, name?: string, ts: number, parentId?: null }>}
 */
export function parseGitLog(stdout) {
  const lines = String(stdout || "").split(/\r?\n/);
  /** @type {Array<{ id: string, message: string, shortHash: string, name?: string, ts: number, parentId?: null }>} */
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const sp = t.indexOf(" ");
    const id = sp < 0 ? t : t.slice(0, sp);
    if (!/^[0-9a-f]{7,40}$/i.test(id)) continue;
    const message = sp < 0 ? "" : t.slice(sp + 1).trim();
    out.push({
      id: id.toLowerCase(),
      message: message || "checkpoint",
      name: message || undefined,
      shortHash: id.slice(0, 7).toLowerCase(),
      ts: Date.now(),
      parentId: null,
    });
  }
  return out;
}

/**
 * @param {any} eng
 * @param {string} path
 * @returns {Promise<string | null>}
 */
async function readWorktreeFile(eng, path) {
  try {
    const driver = eng.asMountDriver();
    const bytes = await driver.open("/" + path.replace(/^\/+/, ""));
    if (!bytes) return null;
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * @param {string | null | undefined} raw
 * @returns {import('./backend.js').WorktreeDoc | null}
 */
function docFromFiles(sourceText, projectJsonText) {
  if (sourceText == null && projectJsonText == null) return null;
  let project = { name: "untitled", schema_version: 1 };
  /** @type {Record<string, any>} */
  let meta = {};
  /** @type {Record<string, any>} */
  let values = {};
  if (projectJsonText) {
    try {
      const parsed = JSON.parse(projectJsonText);
      if (parsed && typeof parsed === "object") {
        if (parsed.project && typeof parsed.project === "object") {
          project = parsed.project;
        }
        if (parsed.meta && typeof parsed.meta === "object") {
          meta = parsed.meta;
        }
        if (parsed.values && typeof parsed.values === "object") {
          values = parsed.values;
        }
      }
    } catch {
      /* keep defaults */
    }
  }
  return cloneDoc({
    source: sourceText != null ? String(sourceText) : "",
    project,
    meta,
    values,
  });
}

/**
 * @param {import('./backend.js').WorktreeDoc} doc
 */
function projectJsonFromDoc(doc) {
  const c = cloneDoc(doc);
  return JSON.stringify({
    project: c.project,
    meta: c.meta,
    values: c.values,
  });
}

/**
 * Public remote URL origin helper (http/https only).
 * @param {string} url
 * @returns {string | null}
 */
export function remoteOriginOf(url) {
  try {
    const u = new URL(String(url || "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Session-only token helpers (never log the value).
 */
export const remoteTokenStorage = {
  key: TOKEN_SESSION_KEY,
  /** @returns {string} */
  get() {
    try {
      if (typeof sessionStorage === "undefined") return "";
      return String(sessionStorage.getItem(TOKEN_SESSION_KEY) || "");
    } catch {
      return "";
    }
  },
  /** @param {string} token */
  set(token) {
    try {
      if (typeof sessionStorage === "undefined") return;
      const t = String(token || "");
      if (!t) sessionStorage.removeItem(TOKEN_SESSION_KEY);
      else sessionStorage.setItem(TOKEN_SESSION_KEY, t);
    } catch {
      /* private mode */
    }
  },
  clear() {
    try {
      if (typeof sessionStorage === "undefined") return;
      sessionStorage.removeItem(TOKEN_SESSION_KEY);
    } catch {
      /* */
    }
  },
};

/**
 * @typedef {import('./backend.js').HistoryBackend & {
 *   available: boolean,
 *   identity: typeof PRODUCT_GIT_IDENTITY,
 *   setRemote: (url: string, opts?: { name?: string, token?: string }) => Promise<{ ok: boolean, message?: string }>,
 *   getRemote: () => Promise<string | null>,
 *   push: (opts?: { remote?: string, token?: string }) => Promise<{ ok: boolean, message?: string }>,
 *   pull: (opts?: { remote?: string, token?: string }) => Promise<{ ok: boolean, message?: string }>,
 *   clone: (url: string, opts?: { token?: string, depth?: number }) => Promise<{ ok: boolean, message?: string }>,
 *   engine?: any,
 * }} GitHistoryBackend
 */

/**
 * Build a live GitEngine-backed history store.
 *
 * @param {{
 *   engine?: any,
 *   GitEngine?: any,
 *   GitRemoteOrchestrator?: any,
 *   engineBytes?: Uint8Array,
 *   durable?: any,
 *   durableDir?: string,
 *   identity?: { name: string, email: string },
 *   mcModule?: any,
 * }} [opts]
 * @returns {Promise<GitHistoryBackend>}
 */
export async function createGitHistoryBackend(opts = {}) {
  const identity = opts.identity || PRODUCT_GIT_IDENTITY;
  let engine = opts.engine || null;
  let GitRemoteOrchestrator = opts.GitRemoteOrchestrator || null;
  const mcMod = opts.mcModule || null;
  const GitEngineCls =
    opts.GitEngine || mcMod?.GitEngine || null;
  /** @type {Record<string, any> | null} */
  let engineLoadOpts = null;

  if (!engine) {
    if (!GitEngineCls || typeof GitEngineCls.load !== "function") {
      throw new Error("GitEngine not available");
    }
    if (!opts.engineBytes || !(opts.engineBytes instanceof Uint8Array)) {
      throw new Error("git-engine.tar bytes required");
    }
    engineLoadOpts = {
      engine: opts.engineBytes,
      identity,
    };
    if (opts.durableDir) {
      engineLoadOpts.durableDir = opts.durableDir;
    } else if (opts.durable) {
      engineLoadOpts.durable = opts.durable;
    }
    engine = await GitEngineCls.load(engineLoadOpts);
  }

  if (!GitRemoteOrchestrator && mcMod?.GitRemoteOrchestrator) {
    GitRemoteOrchestrator = mcMod.GitRemoteOrchestrator;
  }

  /** @type {string | null} */
  let remoteUrl = null;
  /** @type {boolean} */
  let inited = false;
  /** Serialize engine ops per backend. */
  /** @type {Promise<void>} */
  let chain = Promise.resolve();

  /**
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function serial(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function ensureRepo() {
    if (inited) return;
    // Detect existing repo via rev-parse or status.
    const st = await engine.run({ op: "status", args: { short: true } });
    if (st && st.ok) {
      inited = true;
      return;
    }
    const init = await engine.run({ op: "init" });
    assertOk(init, "git init");
    inited = true;
  }

  /**
   * @param {import('./backend.js').WorktreeDoc} doc
   */
  async function writeDocFiles(doc) {
    await ensureRepo();
    const source = String(doc?.source ?? "");
    const pj = projectJsonFromDoc(doc);
    assertOk(
      await engine.run({
        op: "write",
        args: { path: SOURCE_PATH, content: source },
      }),
      "write main.luau",
    );
    assertOk(
      await engine.run({
        op: "write",
        args: { path: PROJECT_PATH, content: pj },
      }),
      "write project.json",
    );
  }

  async function readDocFromWorktree() {
    await ensureRepo();
    const source = await readWorktreeFile(engine, SOURCE_PATH);
    const pj = await readWorktreeFile(engine, PROJECT_PATH);
    if (source == null && pj == null) return null;
    return docFromFiles(source, pj);
  }

  async function maybeCheckpoint() {
    try {
      if (typeof engine.checkpoint === "function") {
        await engine.checkpoint();
      }
    } catch {
      /* unborn / empty durable — non-fatal */
    }
  }

  /**
   * @param {string} [token]
   * @param {string} [url]
   */
  function makeOrchestrator(token, url) {
    if (!GitRemoteOrchestrator) {
      throw new Error(
        "Git remotes unavailable: GitRemoteOrchestrator not loaded from mc-core",
      );
    }
    const loc = String(url || remoteUrl || "").trim();
    const origin = remoteOriginOf(loc);
    /** @type {any[]} */
    const connections = [];
    /** @type {Record<string, string>} */
    const remoteUrls = {};
    /** @type {Record<string, string>} */
    const remoteConnections = {};
    /** @type {string[]} */
    const allowOrigins = [];

    if (loc) {
      remoteUrls[REMOTE_NAME] = loc;
    }
    const tok = String(token || "").trim();
    if (tok && origin) {
      connections.push({
        ref: "product.remote",
        auth: { kind: "bearer", token: tok },
        origins: [origin],
      });
      remoteConnections[REMOTE_NAME] = "product.remote";
    } else if (origin) {
      // Bare public URL — host allowlist required (no secrets).
      allowOrigins.push(origin);
    }

    return new GitRemoteOrchestrator(engine, {
      connections,
      allowOrigins,
      remoteUrls,
      remoteConnections,
      identity,
    });
  }

  /**
   * @param {any} resp
   * @param {string} op
   */
  function remoteResult(resp, op) {
    if (resp && resp.ok) {
      return {
        ok: true,
        message: firstLine(resp.stdout) || `${op} ok`,
      };
    }
    const msg = firstLine(resp?.stderr || resp?.stdout) || `${op} failed`;
    // Never include token material; orchestrator already redacts.
    return { ok: false, message: msg };
  }

  /** @type {GitHistoryBackend} */
  const backend = {
    kind: "git",
    identity,
    available: true,
    engine,

    async open(projectId) {
      return serial(async () => {
        sanitizeProjectId(projectId);
        try {
          return await readDocFromWorktree();
        } catch {
          return null;
        }
      });
    },

    async saveWorktree(projectId, doc) {
      return serial(async () => {
        sanitizeProjectId(projectId);
        await writeDocFiles(doc);
        await maybeCheckpoint();
      });
    },

    async commit(projectId, doc, o) {
      return serial(async () => {
        sanitizeProjectId(projectId);
        const name = validateVersionName(o?.name, false);
        // Commit message = version name (product UX), fall back to message.
        const message = validateVersionMessage(
          name || o?.message || "checkpoint",
        );
        await writeDocFiles(doc);
        assertOk(
          await engine.run({ op: "add", args: { path: SOURCE_PATH } }),
          "git add main.luau",
        );
        assertOk(
          await engine.run({ op: "add", args: { path: PROJECT_PATH } }),
          "git add project.json",
        );
        const commitResp = await engine.run({
          op: "commit",
          args: {
            message,
            // Identity also injected by engine when configured.
            name: identity.name,
            email: identity.email,
          },
        });
        assertOk(commitResp, "git commit");

        let id = "";
        if (
          commitResp.result &&
          typeof commitResp.result === "object" &&
          typeof /** @type {any} */ (commitResp.result).hash === "string"
        ) {
          id = String(/** @type {any} */ (commitResp.result).hash);
        }
        if (!id) {
          const rp = await engine.run({
            op: "rev-parse",
            args: { rev: "HEAD" },
          });
          assertOk(rp, "rev-parse HEAD");
          id = firstLine(rp.stdout).split(/\s+/)[0] || "";
        }
        if (!id || id.length < 6) {
          throw new Error("git commit: missing hash");
        }
        id = id.toLowerCase();

        await maybeCheckpoint();

        return {
          id,
          // Only set name when the user labeled; auto messages stay unnamed.
          name: name || undefined,
          message,
          ts: Date.now(),
          parentId: null,
          shortHash: id.slice(0, 7),
          auto: !name,
        };
      });
    },

    async listVersions(projectId) {
      return serial(async () => {
        sanitizeProjectId(projectId);
        try {
          await ensureRepo();
        } catch {
          return [];
        }
        const log = await engine.run({
          op: "log",
          args: { max_count: 100 },
        });
        if (!log.ok) return [];
        return parseGitLog(log.stdout || "");
      });
    },

    async restore(projectId, ref) {
      return serial(async () => {
        sanitizeProjectId(projectId);
        const refId = validateVersionRef(ref);
        await ensureRepo();
        // Prefer hard reset to the commit (restores worktree files).
        const reset = await engine.run({
          op: "reset",
          args: { rev: refId, mode: "hard" },
        });
        if (!reset.ok) {
          // Fallback: checkout by name/oid
          const co = await engine.run({
            op: "checkout",
            args: { name: refId },
          });
          if (!co.ok) {
            throw new Error("Unknown version");
          }
        }
        const doc = await readDocFromWorktree();
        if (!doc) throw new Error("Unknown version");
        await maybeCheckpoint();
        return doc;
      });
    },

    async readVersion(projectId, ref) {
      return serial(async () => {
        sanitizeProjectId(projectId);
        const refId = validateVersionRef(ref);
        await ensureRepo();
        // Snapshot HEAD, hard-reset to ref, read, restore HEAD.
        let head = "";
        try {
          const rp = await engine.run({
            op: "rev-parse",
            args: { rev: "HEAD" },
          });
          if (rp.ok) head = firstLine(rp.stdout).split(/\s+/)[0] || "";
        } catch {
          head = "";
        }
        const reset = await engine.run({
          op: "reset",
          args: { rev: refId, mode: "hard" },
        });
        if (!reset.ok) return null;
        const doc = await readDocFromWorktree();
        if (head) {
          await engine.run({
            op: "reset",
            args: { rev: head, mode: "hard" },
          });
        }
        return doc;
      });
    },

    async tip(projectId) {
      return serial(async () => {
        sanitizeProjectId(projectId);
        try {
          await ensureRepo();
        } catch {
          return null;
        }
        const rp = await engine.run({
          op: "rev-parse",
          args: { rev: "HEAD" },
        });
        if (!rp.ok) return null;
        const id = firstLine(rp.stdout).split(/\s+/)[0] || "";
        if (!id || id.length < 6) return null;
        let message = "checkpoint";
        try {
          const sh = await engine.run({
            op: "show",
            args: { rev: id },
          });
          if (sh.ok && sh.stdout) {
            // show body: commit …\nAuthor…\n\n<message>\n
            const parts = String(sh.stdout).split(/\n\n/);
            if (parts.length >= 2) {
              message = parts.slice(1).join("\n\n").trim() || message;
            }
          }
        } catch {
          /* */
        }
        const summary = firstLine(message);
        return {
          id: id.toLowerCase(),
          name: summary || undefined,
          message: summary || "checkpoint",
          ts: Date.now(),
          parentId: null,
          shortHash: id.slice(0, 7).toLowerCase(),
        };
      });
    },

    async close(_projectId) {
      return serial(async () => {
        try {
          if (typeof engine.close === "function") await engine.close();
        } catch {
          /* */
        }
      });
    },

    /**
     * Wipe worktree + re-init empty repo (local fresh start).
     * Reloads GitEngine when possible so history ODB is empty.
     */
    async clear(_projectId) {
      return serial(async () => {
        remoteUrl = null;
        try {
          if (opts.durable && typeof opts.durable.clear === "function") {
            await opts.durable.clear();
          }
        } catch {
          /* */
        }
        try {
          if (typeof engine.close === "function") await engine.close();
        } catch {
          /* */
        }
        // Fresh engine = empty repo (new MEMFS / cleared durable).
        if (GitEngineCls && engineLoadOpts) {
          engine = await GitEngineCls.load({ ...engineLoadOpts });
          inited = false;
          await ensureRepo();
          await maybeCheckpoint();
          return;
        }
        // Fallback: empty files on existing engine.
        inited = false;
        try {
          await ensureRepo();
          await engine.run({
            op: "write",
            args: { path: SOURCE_PATH, content: "" },
          });
          await engine.run({
            op: "write",
            args: {
              path: PROJECT_PATH,
              content: JSON.stringify({
                project: { name: "untitled", schema_version: 1 },
                meta: {},
                values: {},
              }),
            },
          });
        } catch {
          /* */
        }
        await maybeCheckpoint();
      });
    },

    // ── RemoteHistoryBackend (optional host API; not demo UI) ────────────

    /**
     * Internal remote list (must only run under serial).
     * @returns {Promise<string | null>}
     */
    async _refreshRemoteUrl() {
      try {
        await ensureRepo();
        const list = await engine.run({
          op: "remote",
          args: { action: "list" },
        });
        if (!list.ok) return remoteUrl;
        const line = String(list.stdout || "")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find(
            (l) =>
              l.startsWith(REMOTE_NAME + "\t") ||
              l.startsWith(REMOTE_NAME + " "),
          );
        if (line) {
          const parts = line.split(/\s+/);
          const url = parts[1] || "";
          if (url) remoteUrl = url;
        }
        return remoteUrl;
      } catch {
        return remoteUrl;
      }
    },

    async getRemote() {
      return serial(async () => backend._refreshRemoteUrl());
    },

    async setRemote(url, o = {}) {
      return serial(async () => {
        const loc = String(url || "").trim();
        if (!loc) {
          return { ok: false, message: "Remote URL required" };
        }
        if (!remoteOriginOf(loc)) {
          return {
            ok: false,
            message: "Remote URL must be http(s) without embedded credentials",
          };
        }
        await ensureRepo();
        const name = String(o.name || REMOTE_NAME);
        // Remove existing then add (idempotent-ish).
        await engine.run({
          op: "remote",
          args: { action: "remove", name },
        });
        const add = await engine.run({
          op: "remote",
          args: { action: "add", name, url: loc },
        });
        if (!add.ok) {
          return remoteResult(add, "setRemote");
        }
        remoteUrl = loc;
        if (o.token != null) {
          remoteTokenStorage.set(String(o.token || ""));
        }
        await maybeCheckpoint();
        return { ok: true, message: `remote ${name} → ${loc}` };
      });
    },

    async push(o = {}) {
      return serial(async () => {
        await ensureRepo();
        const token =
          o.token != null ? String(o.token) : remoteTokenStorage.get();
        const url = remoteUrl || (await backend._refreshRemoteUrl()) || "";
        if (!url) {
          return {
            ok: false,
            message: "No remote configured — set a Remote URL first",
          };
        }
        try {
          const orch = makeOrchestrator(token, url);
          const resp = await orch.handle({
            op: "push",
            args: {
              remote: o.remote || REMOTE_NAME,
              url,
            },
          });
          return remoteResult(resp, "push");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/orchestrator|dial|CAP_NET|network/i.test(msg)) {
            return {
              ok: false,
              message:
                "Push unavailable in this host (remotes need GitRemoteOrchestrator + network)",
            };
          }
          return { ok: false, message: msg };
        }
      });
    },

    async pull(o = {}) {
      return serial(async () => {
        await ensureRepo();
        const token =
          o.token != null ? String(o.token) : remoteTokenStorage.get();
        const url = remoteUrl || (await backend._refreshRemoteUrl()) || "";
        if (!url) {
          return {
            ok: false,
            message: "No remote configured — set a Remote URL first",
          };
        }
        try {
          const orch = makeOrchestrator(token, url);
          const resp = await orch.handle({
            op: "pull",
            args: {
              remote: o.remote || REMOTE_NAME,
              url,
            },
          });
          if (resp.ok) await maybeCheckpoint();
          return remoteResult(resp, "pull");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/orchestrator|dial|CAP_NET|network/i.test(msg)) {
            return {
              ok: false,
              message:
                "Pull unavailable in this host (remotes need GitRemoteOrchestrator + network)",
            };
          }
          return { ok: false, message: msg };
        }
      });
    },

    async clone(url, o = {}) {
      return serial(async () => {
        const loc = String(url || "").trim();
        if (!loc) return { ok: false, message: "Clone URL required" };
        if (!remoteOriginOf(loc)) {
          return {
            ok: false,
            message: "Clone URL must be http(s) without embedded credentials",
          };
        }
        const token =
          o.token != null ? String(o.token) : remoteTokenStorage.get();
        try {
          const orch = makeOrchestrator(token, loc);
          const args = /** @type {Record<string, unknown>} */ ({
            url: loc,
            remote: REMOTE_NAME,
          });
          if (typeof o.depth === "number") args.depth = o.depth;
          const resp = await orch.handle({ op: "clone", args });
          if (resp.ok) {
            inited = true;
            remoteUrl = loc;
            // Record remote for later push/pull.
            await engine.run({
              op: "remote",
              args: { action: "remove", name: REMOTE_NAME },
            });
            await engine.run({
              op: "remote",
              args: { action: "add", name: REMOTE_NAME, url: loc },
            });
            if (token) remoteTokenStorage.set(token);
            await maybeCheckpoint();
          }
          return remoteResult(resp, "clone");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/orchestrator|dial|CAP_NET|network/i.test(msg)) {
            return {
              ok: false,
              message:
                "Clone unavailable in this host (remotes need GitRemoteOrchestrator + network)",
            };
          }
          return { ok: false, message: msg };
        }
      });
    },
  };

  return backend;
}

/**
 * Resolve git-engine.tar bytes from common product locations.
 * @param {{
 *   engineBytes?: Uint8Array,
 *   engineUrl?: string,
 *   enginePath?: string,
 *   assetBase?: string,
 * }} [opts]
 * @returns {Promise<Uint8Array | null>}
 */
export async function resolveGitEngineBytes(opts = {}) {
  if (opts.engineBytes instanceof Uint8Array && opts.engineBytes.byteLength > 0) {
    return opts.engineBytes;
  }

  // Node: env path or explicit path
  const envPath =
    (typeof process !== "undefined" && process.env?.MC_GIT_ENGINE_TAR) ||
    opts.enginePath ||
    "";
  if (envPath) {
    try {
      const { readFileSync, existsSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const p = resolve(envPath);
      if (existsSync(p)) {
        return new Uint8Array(readFileSync(p));
      }
    } catch {
      /* not node or missing */
    }
  }

  // Browser / fetch
  const base = opts.assetBase || "";
  const url =
    opts.engineUrl ||
    (base
      ? new URL("git-engine.tar", base.endsWith("/") ? base : base + "/").href
      : "");
  if (url && typeof fetch === "function") {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return new Uint8Array(await res.arrayBuffer());
      }
    } catch {
      /* offline / missing */
    }
  }

  return null;
}

/**
 * Import mc-core (Node release or browserified stage copy).
 * @param {{ mcUrl?: string, assetBase?: string, mcModule?: any }} [opts]
 */
export async function loadMcCore(opts = {}) {
  if (opts.mcModule) return opts.mcModule;
  const candidates = [];
  if (opts.mcUrl) candidates.push(opts.mcUrl);
  if (opts.assetBase) {
    const b = opts.assetBase.endsWith("/") ? opts.assetBase : opts.assetBase + "/";
    candidates.push(new URL("mc-core.mjs", b).href);
  }
  // Node vendor relative to this package
  if (typeof process !== "undefined" && process.versions?.node) {
    try {
      const { pathToFileURL } = await import("node:url");
      const { existsSync } = await import("node:fs");
      const { resolve, dirname } = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const here = dirname(fileURLToPath(import.meta.url));
      const vendor = resolve(here, "../../vendor/mc-core.mjs");
      if (existsSync(vendor)) {
        candidates.push(pathToFileURL(vendor).href);
      }
    } catch {
      /* */
    }
  }
  for (const href of candidates) {
    try {
      const mod = await import(/* @vite-ignore */ href);
      if (mod?.GitEngine) return mod;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Try to open a real Git history backend; return null on any failure.
 * @param {{
 *   engineBytes?: Uint8Array,
 *   engineUrl?: string,
 *   enginePath?: string,
 *   assetBase?: string,
 *   mcUrl?: string,
 *   mcModule?: any,
 *   durableDir?: string,
 *   durable?: any,
 *   projectId?: string,
 *   identity?: { name: string, email: string },
 * }} [opts]
 * @returns {Promise<GitHistoryBackend | null>}
 */
export async function tryCreateGitHistoryBackend(opts = {}) {
  try {
    const mcModule = await loadMcCore(opts);
    if (!mcModule?.GitEngine) return null;
    const engineBytes = await resolveGitEngineBytes(opts);
    if (!engineBytes) return null;

    let durable = opts.durable;
    let durableDir = opts.durableDir;
    if (!durable && !durableDir) {
      // Browser: prefer OPFS AGIT blob; else memory blob (session-only).
      if (typeof window !== "undefined") {
        const id = opts.projectId || "default";
        durable =
          (await createOpfsBlobDurable(`cad-${id}`)) ||
          createMemoryDurable(`cad-${id}`);
      }
      // Node without durableDir: ephemeral MEMFS (fine for smoke).
    }

    return await createGitHistoryBackend({
      mcModule,
      GitEngine: mcModule.GitEngine,
      GitRemoteOrchestrator: mcModule.GitRemoteOrchestrator,
      engineBytes,
      durable,
      durableDir,
      identity: opts.identity || PRODUCT_GIT_IDENTITY,
    });
  } catch (err) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn(
        "[history] GitEngine unavailable, falling back:",
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  }
}
