/**
 * Local version history UI — Overleaf / Onshape style.
 *
 * Local AgentOS GitEngine (or IDB/memory fallback) only. No remotes:
 * named versions, commit timeline, restore/rollback. Undo/redo cover
 * fine-grained working-copy edits; Save version freezes a named commit.
 */

/**
 * @param {HTMLElement} host
 * @param {{
 *   onUndo?: () => void,
 *   onRedo?: () => void,
 *   onSaveVersion?: () => void,
 *   onRestore?: (id: string) => void,
 * }} handlers
 */
export function mountHistoryPanel(host, handlers = {}) {
  host.classList.add("history-panel");
  host.replaceChildren();

  const header = document.createElement("div");
  header.className = "history-panel-header panel-head";

  const title = document.createElement("h2");
  title.className = "panel-title";
  title.textContent = "Versions";
  header.appendChild(title);

  const tipEl = document.createElement("span");
  tipEl.className = "history-tip";
  tipEl.textContent = "Working copy";
  tipEl.title = "Working copy state";
  header.appendChild(tipEl);

  host.appendChild(header);

  const toolbar = document.createElement("div");
  toolbar.className = "history-toolbar";

  const undoBtn = document.createElement("button");
  undoBtn.type = "button";
  undoBtn.className = "history-btn";
  undoBtn.textContent = "Undo";
  undoBtn.title = "Undo last edit (Ctrl/Cmd+Z)";
  undoBtn.addEventListener("click", () => handlers.onUndo?.());

  const redoBtn = document.createElement("button");
  redoBtn.type = "button";
  redoBtn.className = "history-btn";
  redoBtn.textContent = "Redo";
  redoBtn.title = "Redo (Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z)";
  redoBtn.addEventListener("click", () => handlers.onRedo?.());

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "history-btn history-btn-accent";
  saveBtn.textContent = "Save version";
  saveBtn.title = "Name and save a version of the working copy";
  saveBtn.addEventListener("click", () => handlers.onSaveVersion?.());

  toolbar.append(undoBtn, redoBtn, saveBtn);
  host.appendChild(toolbar);

  const hint = document.createElement("div");
  hint.className = "history-hint";
  hint.textContent =
    "Named checkpoints of this design. Restore rolls back source and params.";
  host.appendChild(hint);

  const list = document.createElement("div");
  list.className = "history-list";
  list.setAttribute("role", "list");
  list.setAttribute("aria-label", "Version history");
  host.appendChild(list);

  /** @type {string | null} */
  let currentTipId = null;

  /**
   * @param {{
   *   canUndo?: boolean,
   *   canRedo?: boolean,
   *   dirty?: boolean,
   *   tip?: { id?: string, shortHash?: string, name?: string, message?: string } | null,
   *   versions?: Array<{
   *     id: string,
   *     name?: string,
   *     message: string,
   *     ts: number,
   *     shortHash?: string,
   *   }>,
   *   badgeOnly?: boolean,
   *   backendKind?: string,
   * }} state
   */
  function update(state = {}) {
    if (state.canUndo !== undefined) undoBtn.disabled = !state.canUndo;
    if (state.canRedo !== undefined) redoBtn.disabled = !state.canRedo;

    if (state.tip?.id) currentTipId = state.tip.id;

    if (state.dirty !== undefined || state.tip !== undefined) {
      if (state.dirty) {
        tipEl.textContent = "Unsaved changes";
        tipEl.dataset.dirty = "1";
        tipEl.title = "Working copy differs from the latest version";
      } else if (state.tip?.name || state.tip?.message) {
        const label = state.tip.name || state.tip.message;
        tipEl.textContent = label;
        tipEl.dataset.dirty = "0";
        tipEl.title = state.tip.shortHash
          ? `${label} (${state.tip.shortHash})`
          : label;
      } else if (state.tip?.shortHash) {
        tipEl.textContent = state.tip.shortHash;
        tipEl.dataset.dirty = "0";
        tipEl.title = "Latest version";
      } else {
        tipEl.textContent = "Working copy";
        tipEl.dataset.dirty = "0";
        tipEl.title = "No versions yet";
      }
    }

    // badgeOnly / omitted versions: skip list rebuild (scrub path).
    if (state.badgeOnly || state.versions === undefined) return;

    const versions = state.versions || [];
    list.replaceChildren();

    // Working-copy row (always first when there are edits or no versions).
    if (state.dirty || !versions.length) {
      const work = document.createElement("div");
      work.className = "history-row history-row-working";
      work.setAttribute("role", "listitem");
      work.dataset.current = "1";

      const main = document.createElement("div");
      main.className = "history-row-main";

      const name = document.createElement("div");
      name.className = "history-row-name";
      name.textContent = "Working copy";

      const meta = document.createElement("div");
      meta.className = "history-row-meta";
      meta.textContent = state.dirty
        ? "Unsaved · edit freely, then Save version"
        : "No versions yet · Save version to checkpoint";

      main.append(name, meta);
      work.appendChild(main);
      list.appendChild(work);
    }

    if (!versions.length) {
      return;
    }

    for (let i = 0; i < versions.length; i++) {
      const v = versions[i];
      const row = document.createElement("div");
      row.className = "history-row";
      row.setAttribute("role", "listitem");

      const isCurrent =
        !state.dirty &&
        (v.id === currentTipId ||
          (i === 0 && !state.dirty) ||
          (state.tip?.id && v.id === state.tip.id));
      if (isCurrent) {
        row.dataset.current = "1";
      }

      const main = document.createElement("div");
      main.className = "history-row-main";

      const name = document.createElement("div");
      name.className = "history-row-name";
      const displayName = v.name || v.message || "Untitled version";
      name.textContent = displayName;

      const meta = document.createElement("div");
      meta.className = "history-row-meta";
      const when = formatTs(v.ts);
      const hash = v.shortHash || (v.id ? v.id.slice(0, 7) : "");
      const parts = [];
      if (when) parts.push(when);
      if (hash) parts.push(hash);
      if (isCurrent) parts.push("current");
      // Show message only when it differs from the display name (named versions).
      if (
        v.message &&
        v.name &&
        v.message !== v.name &&
        !v.message.startsWith(v.name)
      ) {
        parts.push(v.message);
      }
      meta.textContent = parts.join(" · ");

      main.append(name, meta);

      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "history-btn history-btn-small";
      restore.textContent = isCurrent ? "Current" : "Restore";
      restore.disabled = !!isCurrent;
      restore.title = isCurrent
        ? "This is the current version"
        : `Restore “${displayName}”`;
      restore.addEventListener("click", () => {
        if (!isCurrent) handlers.onRestore?.(v.id);
      });

      row.append(main, restore);
      list.appendChild(row);
    }
  }

  return {
    update,
    dispose() {
      host.replaceChildren();
    },
  };
}

/** @param {number} ts */
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
