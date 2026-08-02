/**
 * Safe join of asset base + relative path for fetch / dynamic import.
 *
 * `new URL(rel, base)` throws "Invalid base URL" when base is path-only
 * ("/agent-os/"). fetch() accepts path-absolute URLs, so we fall back to
 * string join when the base is not an absolute URL.
 *
 * @param {string} base
 * @param {string} rel
 * @returns {string}
 */
export function joinAssetUrl(base, rel) {
  const r = String(rel || "").replace(/^\//, "");
  let b = String(base || "");
  if (!b) b = "/";
  if (!b.endsWith("/")) b += "/";

  // Absolute URL base (https://host/agent-os/)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(b)) {
    try {
      return new URL(r, b).href;
    } catch {
      return b + r;
    }
  }

  // Path-absolute base (/agent-os/) — valid for fetch(), not for URL() base.
  if (b.startsWith("/")) {
    return b + r;
  }

  // Relative base — resolve against page/worker location when possible.
  try {
    const origin =
      (typeof self !== "undefined" && self.location && self.location.href) ||
      (typeof location !== "undefined" && location.href) ||
      undefined;
    if (origin) return new URL(b + r, origin).href;
  } catch {
    /* fall through */
  }
  return b + r;
}

/**
 * Normalize asset base to a form safe for joinAssetUrl.
 * Prefer absolute URL when we can derive one from import.meta / location.
 *
 * @param {string} [configured]
 * @param {string} [moduleUrl] import.meta.url of the caller
 * @returns {string} always ends with /
 */
export function normalizeAssetBase(configured, moduleUrl) {
  let b = configured != null ? String(configured).trim() : "";

  if (!b && moduleUrl) {
    try {
      // …/app/<hash>/main.js or runtime-worker.js → stage root (…/agent-os/)
      if (/\/app\/[a-f0-9]{12}\//i.test(moduleUrl)) {
        b = new URL("../../", moduleUrl).href;
      } else {
        // …/src/main.js → parent
        b = new URL("../", moduleUrl).href;
      }
    } catch {
      b = "/agent-os/";
    }
  }

  if (!b) b = "/agent-os/";

  // Path-absolute → absolute via location when available
  if (b.startsWith("/") && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(b)) {
    try {
      const page =
        (typeof location !== "undefined" && location.href) ||
        (typeof self !== "undefined" && self.location && self.location.href) ||
        moduleUrl;
      if (page && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(page)) {
        b = new URL(b.endsWith("/") ? b : `${b}/`, page).href;
      }
    } catch {
      /* keep path base — joinAssetUrl handles it */
    }
  }

  if (!b.endsWith("/")) b += "/";
  return b;
}
