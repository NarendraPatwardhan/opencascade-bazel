/**
 * Document history: undo stack + durable versions (GitEngine / IDB / memory).
 *
 * Document fields: main.luau source + project.json + optional meta.
 * `values` is also stored so scrub SoT (inject-only execute) survives reload.
 *
 * Preference: GitEngine (git-engine.tar) → IndexedDB → memory.
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
  createOpfsHistoryBackend,
  createDefaultHistoryBackend,
} from "./opfs-backend.js";
export {
  createGitHistoryBackend,
  tryCreateGitHistoryBackend,
  resolveGitEngineBytes,
  loadMcCore,
  parseGitLog,
  remoteTokenStorage,
  remoteOriginOf,
  createMemoryDurable,
  createOpfsBlobDurable,
} from "./git-backend.js";
export { createProjectController } from "./project-controller.js";
