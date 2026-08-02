/**
 * Document history (local Overleaf-style versions).
 *
 * Product path: createDefaultHistoryBackend (IDB primary + optional git dual-write)
 * + createProjectController + mountHistoryPanel.
 */

export { createUndoStack } from "./undo-stack.js";
export {
  createMemoryHistoryBackend,
  cloneDoc,
  docsContentEqual,
  PRODUCT_GIT_IDENTITY,
  sanitizeProjectId,
  validateVersionName,
  validateVersionMessage,
  validateVersionRef,
} from "./backend.js";
export {
  createIdbHistoryBackend,
  createDefaultHistoryBackend,
} from "./opfs-backend.js";
export {
  createGitHistoryBackend,
  tryCreateGitHistoryBackend,
  resolveGitEngineBytes,
  parseGitLog,
} from "./git-backend.js";
export { createProjectController } from "./project-controller.js";
export { mountHistoryPanel } from "./panel.js";
