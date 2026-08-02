/**
 * History / Versions panel chrome for the CAD demo.
 * Style-aligned with param-sheet headers and panel titles.
 *
 * Includes Remotes row: URL + optional token (sessionStorage only) +
 * Clone / Pull / Push. Token is never logged or written to the page log.
 */

import { remoteTokenStorage } from "./git-backend.js";

/**
 * @param {HTMLElement} host
 * @param {{
 *   onUndo?: () => void,
 *   onRedo?: () => void,
 *   onSaveVersion?: () => void,
 *   onRestore?: (id: string) => void,
 *   onRemoteClone?: (url: string, token: string) => void | Promise<void>,
 *   onRemotePull?: (url: string, token: string) => void | Promise<void>,
 *   onRemotePush?: (url: string, token: string) => void | Promise<void>,
 * }} handlers
 */
export function mountHistoryPanel(host, handlers = {}) {
  host.classList.add("history-panel");
  host.replaceChildren();

  const header = document.createElement("div");
  header.className = "history-panel-header panel-head";
  const title = document.createElement("h2");
  title.className = "panel-title";
  title.textContent = "History";
  header.appendChild(title);

  const tipEl = document.createElement("span");
  tipEl.className = "history-tip";
  tipEl.textContent = "unsaved";
  tipEl.title = "Current tip";
  header.appendChild(tipEl);

  const backendEl = document.createElement("span");
  backendEl.className = "history-backend";
  backendEl.textContent = "";
  backendEl.title = "History backend";
  header.appendChild(backendEl);

  host.appendChild(header);

  const toolbar = document.createElement("div");
  toolbar.className = "history-toolbar";

  const undoBtn = document.createElement("button");
  undoBtn.type = "button";
  undoBtn.className = "history-btn";
  undoBtn.textContent = "Undo";
  undoBtn.title = "Undo (Ctrl+Z)";
  undoBtn.addEventListener("click", () => handlers.onUndo?.());

  const redoBtn = document.createElement("button");
  redoBtn.type = "button";
  redoBtn.className = "history-btn";
  redoBtn.textContent = "Redo";
  redoBtn.title = "Redo (Ctrl+Y / Ctrl+Shift+Z)";
  redoBtn.addEventListener("click", () => handlers.onRedo?.());

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "history-btn history-btn-accent";
  saveBtn.textContent = "Save version…";
  saveBtn.title = "Save a named version";
  saveBtn.addEventListener("click", () => handlers.onSaveVersion?.());

  toolbar.append(undoBtn, redoBtn, saveBtn);
  host.appendChild(toolbar);

  // ── Remotes ──────────────────────────────────────────────────────────────
  const remoteBox = document.createElement("div");
  remoteBox.className = "history-remote";
  remoteBox.setAttribute("aria-label", "Git remote");

  const remoteLabel = document.createElement("div");
  remoteLabel.className = "history-remote-label";
  remoteLabel.textContent = "Remote";
  remoteBox.appendChild(remoteLabel);

  const urlRow = document.createElement("div");
  urlRow.className = "history-remote-row";
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.className = "history-remote-input";
  urlInput.placeholder = "https://github.com/org/repo.git";
  urlInput.autocomplete = "off";
  urlInput.spellcheck = false;
  urlInput.setAttribute("aria-label", "Remote URL");
  urlRow.appendChild(urlInput);
  remoteBox.appendChild(urlRow);

  const tokenRow = document.createElement("div");
  tokenRow.className = "history-remote-row";
  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.className = "history-remote-input";
  tokenInput.placeholder = "Token (session only, optional)";
  tokenInput.autocomplete = "off";
  tokenInput.spellcheck = false;
  tokenInput.setAttribute("aria-label", "Remote token");
  // Hydrate from sessionStorage; never echo into logs.
  try {
    const saved = remoteTokenStorage.get();
    if (saved) tokenInput.value = saved;
  } catch {
    /* */
  }
  tokenInput.addEventListener("change", () => {
    remoteTokenStorage.set(tokenInput.value);
  });
  tokenRow.appendChild(tokenInput);
  remoteBox.appendChild(tokenRow);

  const remoteActions = document.createElement("div");
  remoteActions.className = "history-remote-actions";

  const cloneBtn = document.createElement("button");
  cloneBtn.type = "button";
  cloneBtn.className = "history-btn history-btn-small";
  cloneBtn.textContent = "Clone";
  cloneBtn.title = "Clone remote into this project (host-mediated)";

  const pullBtn = document.createElement("button");
  pullBtn.type = "button";
  pullBtn.className = "history-btn history-btn-small";
  pullBtn.textContent = "Pull";
  pullBtn.title = "Pull from remote";

  const pushBtn = document.createElement("button");
  pushBtn.type = "button";
  pushBtn.className = "history-btn history-btn-small";
  pushBtn.textContent = "Push";
  pushBtn.title = "Push to remote";

  remoteActions.append(cloneBtn, pullBtn, pushBtn);
  remoteBox.appendChild(remoteActions);

  const remoteStatus = document.createElement("div");
  remoteStatus.className = "history-remote-status";
  remoteStatus.hidden = true;
  remoteBox.appendChild(remoteStatus);

  host.appendChild(remoteBox);

  /**
   * @param {string} msg
   * @param {boolean} [isError]
   */
  function setRemoteStatus(msg, isError = false) {
    const t = String(msg || "").trim();
    if (!t) {
      remoteStatus.hidden = true;
      remoteStatus.textContent = "";
      return;
    }
    remoteStatus.hidden = false;
    remoteStatus.textContent = t;
    remoteStatus.dataset.error = isError ? "1" : "0";
  }

  function currentRemoteArgs() {
    const url = urlInput.value.trim();
    const token = tokenInput.value; // may be empty
    remoteTokenStorage.set(token);
    return { url, token };
  }

  /**
   * @param {"clone"|"pull"|"push"} op
   * @param {(() => void | Promise<void>) | undefined} fn
   */
  async function runRemote(op, fn) {
    if (!fn) {
      setRemoteStatus(`${op}: not wired`, true);
      return;
    }
    const { url, token } = currentRemoteArgs();
    if ((op === "clone" || op === "push" || op === "pull") && !url && op === "clone") {
      setRemoteStatus("Remote URL required", true);
      return;
    }
    cloneBtn.disabled = true;
    pullBtn.disabled = true;
    pushBtn.disabled = true;
    setRemoteStatus(`${op}…`);
    try {
      // Handlers receive url + token; they must not log token.
      await fn(url, token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRemoteStatus(msg, true);
    } finally {
      cloneBtn.disabled = false;
      pullBtn.disabled = false;
      pushBtn.disabled = false;
    }
  }

  cloneBtn.addEventListener("click", () => {
    void runRemote("clone", async (url, token) => {
      await handlers.onRemoteClone?.(url, token);
    });
  });
  pullBtn.addEventListener("click", () => {
    void runRemote("pull", async (url, token) => {
      await handlers.onRemotePull?.(url, token);
    });
  });
  pushBtn.addEventListener("click", () => {
    void runRemote("push", async (url, token) => {
      await handlers.onRemotePush?.(url, token);
    });
  });

  const list = document.createElement("div");
  list.className = "history-list";
  list.setAttribute("role", "list");
  host.appendChild(list);

  /**
   * @param {{
   *   canUndo?: boolean,
   *   canRedo?: boolean,
   *   dirty?: boolean,
   *   tip?: { shortHash?: string, name?: string, message?: string } | null,
   *   versions?: Array<{ id: string, name?: string, message: string, ts: number, shortHash?: string }>,
   *   badgeOnly?: boolean,
   *   backendKind?: string,
   *   remoteUrl?: string | null,
   *   remoteMessage?: string,
   *   remoteError?: boolean,
   * }} state
   */
  function update(state = {}) {
    if (state.canUndo !== undefined) undoBtn.disabled = !state.canUndo;
    if (state.canRedo !== undefined) redoBtn.disabled = !state.canRedo;

    if (state.backendKind) {
      backendEl.textContent = state.backendKind;
      backendEl.title = `History backend: ${state.backendKind}`;
    }

    if (state.remoteUrl != null && state.remoteUrl !== undefined) {
      if (state.remoteUrl && !urlInput.value) {
        urlInput.value = state.remoteUrl;
      }
    }
    if (state.remoteMessage != null) {
      setRemoteStatus(state.remoteMessage, !!state.remoteError);
    }

    if (state.dirty !== undefined || state.tip !== undefined) {
      if (state.dirty) {
        tipEl.textContent = "unsaved";
        tipEl.dataset.dirty = "1";
      } else if (state.tip?.shortHash) {
        tipEl.textContent = state.tip.shortHash;
        tipEl.dataset.dirty = "0";
        tipEl.title = state.tip.name || state.tip.message || state.tip.shortHash;
      } else if (state.tip?.name) {
        tipEl.textContent = state.tip.name;
        tipEl.dataset.dirty = "0";
      } else if (!state.dirty) {
        tipEl.textContent = "—";
        tipEl.dataset.dirty = "0";
      }
    }

    // badgeOnly / omitted versions: skip list rebuild (scrub path).
    if (state.badgeOnly || state.versions === undefined) return;

    const versions = state.versions || [];
    list.replaceChildren();
    if (!versions.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = "No saved versions yet";
      list.appendChild(empty);
      return;
    }
    for (const v of versions) {
      const row = document.createElement("div");
      row.className = "history-row";
      row.setAttribute("role", "listitem");

      const main = document.createElement("div");
      main.className = "history-row-main";

      const name = document.createElement("div");
      name.className = "history-row-name";
      name.textContent = v.name || v.message || v.shortHash || v.id.slice(0, 7);

      const meta = document.createElement("div");
      meta.className = "history-row-meta";
      const when = formatTs(v.ts);
      const hash = v.shortHash || v.id.slice(0, 7);
      meta.textContent = v.name
        ? `${hash} · ${when}${v.message && v.message !== v.name ? ` · ${v.message}` : ""}`
        : `${hash} · ${when}`;

      main.append(name, meta);

      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "history-btn history-btn-small";
      restore.textContent = "Restore";
      restore.title = `Restore ${name.textContent}`;
      restore.addEventListener("click", () => {
        handlers.onRestore?.(v.id);
      });

      row.append(main, restore);
      list.appendChild(row);
    }
  }

  return {
    update,
    setRemoteStatus,
    getRemoteUrl: () => urlInput.value.trim(),
    getRemoteToken: () => tokenInput.value,
    dispose() {
      host.replaceChildren();
    },
  };
}

function formatTs(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
