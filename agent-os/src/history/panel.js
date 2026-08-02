/**
 * Local version history — Overleaf-style timeline UI (drawer content).
 *
 * - Continuous auto checkpoints (host calls autoCommit on edits)
 * - Optional named labels via in-panel form (never window.prompt)
 * - Restore with in-panel confirm (never window.confirm)
 */

/**
 * @param {HTMLElement} host
 * @param {{
 *   onUndo?: () => void,
 *   onRedo?: () => void,
 *   onLabelVersion?: (name: string) => void | Promise<void>,
 *   onRestore?: (id: string) => void | Promise<void>,
 *   onClear?: () => void | Promise<void>,
 *   onClose?: () => void,
 * }} handlers
 */
export function mountHistoryPanel(host, handlers = {}) {
  host.classList.add("history-panel");
  host.replaceChildren();

  const header = document.createElement("div");
  header.className = "history-panel-header panel-head";

  const title = document.createElement("h2");
  title.className = "panel-title";
  title.id = "history-drawer-title";
  title.textContent = "History";
  header.appendChild(title);

  const tipEl = document.createElement("span");
  tipEl.className = "history-tip";
  tipEl.textContent = "Working copy";
  header.appendChild(tipEl);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "history-btn history-close";
  closeBtn.setAttribute("aria-label", "Close history");
  closeBtn.title = "Close (Esc)";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", () => handlers.onClose?.());
  header.appendChild(closeBtn);

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
  redoBtn.title = "Redo (Ctrl/Cmd+Y)";
  redoBtn.addEventListener("click", () => handlers.onRedo?.());

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "history-btn history-btn-danger";
  clearBtn.textContent = "Clear…";
  clearBtn.title = "Delete all history and reset the working copy";
  clearBtn.addEventListener("click", () => askClear());

  toolbar.append(undoBtn, redoBtn, clearBtn);
  host.appendChild(toolbar);

  // Label form — in-app, not browser prompt
  const labelBox = document.createElement("div");
  labelBox.className = "history-label-box";

  const labelHint = document.createElement("div");
  labelHint.className = "history-hint";
  labelHint.textContent =
    "Edits are saved to local history automatically. Name an important point anytime:";
  labelBox.appendChild(labelHint);

  const labelRow = document.createElement("div");
  labelRow.className = "history-label-row";

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.id = "history-version-label";
  labelInput.name = "history-version-label";
  labelInput.className = "history-label-input";
  labelInput.placeholder = "e.g. Flange with 6 bolts";
  labelInput.maxLength = 128;
  labelInput.setAttribute("aria-label", "Version label");
  labelInput.autocomplete = "off";

  const labelBtn = document.createElement("button");
  labelBtn.type = "button";
  labelBtn.className = "history-btn history-btn-accent";
  labelBtn.textContent = "Label";
  labelBtn.title = "Name the current working copy as a version";

  async function submitLabel() {
    const name = labelInput.value.trim();
    if (!name) {
      labelInput.focus();
      labelInput.classList.add("history-label-input-error");
      return;
    }
    labelInput.classList.remove("history-label-input-error");
    labelBtn.disabled = true;
    try {
      await handlers.onLabelVersion?.(name);
      labelInput.value = "";
    } finally {
      labelBtn.disabled = false;
    }
  }

  labelBtn.addEventListener("click", () => void submitLabel());
  labelInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void submitLabel();
    }
  });

  labelRow.append(labelInput, labelBtn);
  labelBox.appendChild(labelRow);
  host.appendChild(labelBox);

  // Inline confirm (restore or clear) — never window.confirm / prompt
  const confirmBar = document.createElement("div");
  confirmBar.className = "history-confirm";
  confirmBar.hidden = true;
  confirmBar.setAttribute("hidden", "");
  const confirmText = document.createElement("div");
  confirmText.className = "history-confirm-text";
  const confirmActions = document.createElement("div");
  confirmActions.className = "history-confirm-actions";
  const confirmYes = document.createElement("button");
  confirmYes.type = "button";
  confirmYes.className = "history-btn history-btn-accent";
  confirmYes.textContent = "Confirm";
  const confirmNo = document.createElement("button");
  confirmNo.type = "button";
  confirmNo.className = "history-btn";
  confirmNo.textContent = "Cancel";
  confirmActions.append(confirmNo, confirmYes);
  confirmBar.append(confirmText, confirmActions);
  host.appendChild(confirmBar);

  /** @type {null | { kind: "restore", id: string } | { kind: "clear" }} */
  let pendingConfirm = null;

  function hideConfirm() {
    pendingConfirm = null;
    confirmBar.hidden = true;
    confirmBar.setAttribute("hidden", "");
    confirmText.textContent = "";
    confirmYes.classList.remove("history-btn-danger");
    confirmYes.classList.add("history-btn-accent");
  }

  confirmNo.addEventListener("click", () => hideConfirm());
  confirmYes.addEventListener("click", () => {
    const p = pendingConfirm;
    hideConfirm();
    if (!p) return;
    if (p.kind === "restore") void handlers.onRestore?.(p.id);
    else if (p.kind === "clear") void handlers.onClear?.();
  });

  /**
   * @param {string} id
   * @param {string} displayName
   */
  function askRestore(id, displayName) {
    pendingConfirm = { kind: "restore", id };
    confirmText.textContent = `Restore “${displayName}” to the working copy? You can Undo afterward.`;
    confirmYes.textContent = "Restore";
    confirmYes.classList.remove("history-btn-danger");
    confirmYes.classList.add("history-btn-accent");
    confirmBar.hidden = false;
    confirmBar.removeAttribute("hidden");
    confirmYes.focus();
  }

  function askClear() {
    pendingConfirm = { kind: "clear" };
    confirmText.textContent =
      "Clear all version history and reset the design to the demo flange? This cannot be undone.";
    confirmYes.textContent = "Clear everything";
    confirmYes.classList.remove("history-btn-accent");
    confirmYes.classList.add("history-btn-danger");
    confirmBar.hidden = false;
    confirmBar.removeAttribute("hidden");
    confirmYes.focus();
  }

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
   *   alignedVersionId?: string | null,
   *   versions?: Array<{
   *     id: string,
   *     name?: string,
   *     message: string,
   *     ts: number,
   *     shortHash?: string,
   *     auto?: boolean,
   *   }>,
   *   badgeOnly?: boolean,
   * }} state
   */
  function update(state = {}) {
    if (state.canUndo !== undefined) undoBtn.disabled = !state.canUndo;
    if (state.canRedo !== undefined) redoBtn.disabled = !state.canRedo;

    if (state.tip?.id) currentTipId = state.tip.id;
    // Prefer explicit alignment (restored older checkpoint, or clean tip).
    if (state.alignedVersionId) currentTipId = state.alignedVersionId;

    if (state.dirty !== undefined || state.tip !== undefined) {
      if (state.dirty) {
        tipEl.textContent = "Unsaved";
        tipEl.dataset.dirty = "1";
      } else if (state.tip?.name) {
        tipEl.textContent = state.tip.name;
        tipEl.dataset.dirty = "0";
      } else if (state.tip?.shortHash) {
        tipEl.textContent = state.tip.shortHash;
        tipEl.dataset.dirty = "0";
      } else {
        tipEl.textContent = "Working copy";
        tipEl.dataset.dirty = "0";
      }
    }

    if (state.badgeOnly || state.versions === undefined) return;

    const versions = state.versions || [];
    list.replaceChildren();

    if (!versions.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent =
        "No history yet. Change a parameter or edit the code — checkpoints appear here automatically.";
      list.appendChild(empty);
      return;
    }

    const alignedId =
      state.alignedVersionId != null && state.alignedVersionId !== ""
        ? state.alignedVersionId
        : currentTipId;

    for (let i = 0; i < versions.length; i++) {
      const v = versions[i];
      const row = document.createElement("div");
      row.className = "history-row";
      row.setAttribute("role", "listitem");

      const isAuto =
        v.auto === true ||
        (!v.name && /^auto\s*·/i.test(String(v.message || "")));
      if (isAuto) row.classList.add("history-row-auto");

      // Working copy matches this checkpoint — not "tip && !dirty". After
      // restoring an older point, tip is still newer (dirty) but this row is
      // still Current.
      const isCurrent = !!alignedId && v.id === alignedId;
      if (isCurrent) row.dataset.current = "1";

      const main = document.createElement("div");
      main.className = "history-row-main";

      const name = document.createElement("div");
      name.className = "history-row-name";
      const displayName = v.name
        ? v.name
        : isAuto
          ? formatAutoTitle(v)
          : v.message || "Checkpoint";
      name.textContent = displayName;
      if (v.name) {
        const badge = document.createElement("span");
        badge.className = "history-badge-label";
        badge.textContent = "named";
        name.appendChild(document.createTextNode(" "));
        name.appendChild(badge);
      }

      const meta = document.createElement("div");
      meta.className = "history-row-meta";
      const when = formatTs(v.ts);
      const hash = v.shortHash || (v.id ? v.id.slice(0, 7) : "");
      const parts = [];
      if (when) parts.push(when);
      if (hash) parts.push(hash);
      if (isCurrent) parts.push("current");
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
        if (!isCurrent) askRestore(v.id, displayName);
      });

      row.append(main, restore);
      list.appendChild(row);
    }
  }

  return {
    update,
    focusClose: () => closeBtn.focus(),
    focusLabel: () => labelInput.focus(),
    dispose() {
      host.replaceChildren();
    },
  };
}

/** @param {{ message?: string, ts?: number }} v */
function formatAutoTitle(v) {
  // message: "auto · Aug 2, 3:42:01 PM · params"
  const m = String(v.message || "");
  const parts = m.split("·").map((s) => s.trim());
  if (parts[0]?.toLowerCase() === "auto" && parts[1]) {
    return parts[1] + (parts[2] ? ` · ${parts[2]}` : "");
  }
  if (v.ts) return formatTs(v.ts);
  return "Automatic checkpoint";
}

/** @param {number} ts */
function formatTs(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
