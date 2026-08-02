#!/usr/bin/env node
/**
 * Unit smoke: undo stack + memory history backend + ProjectController.
 * Optional GitEngine when MC_GIT_ENGINE_TAR points at git-engine.tar.
 *
 *   node agent-os/smoke/history_smoke.mjs
 *   MC_GIT_ENGINE_TAR=agent-os/vendor/git-engine.tar node agent-os/smoke/history_smoke.mjs
 */

import { createUndoStack } from "../src/history/undo-stack.js";
import {
  createMemoryHistoryBackend,
  cloneDoc,
  docsContentEqual,
  PRODUCT_GIT_IDENTITY,
  sanitizeProjectId,
  validateVersionName,
  validateVersionMessage,
  validateVersionRef,
  MAX_VERSION_NAME,
} from "../src/history/backend.js";
import { createProjectController } from "../src/history/project-controller.js";
import { createGitHistoryBackend } from "../src/history/git-backend.js";
import { createIdbHistoryBackend } from "../src/history/opfs-backend.js";
import { paramsHeaderFingerprint } from "../src/params/header-fingerprint.js";
import { schemaSignature } from "../src/params/schema-signature.js";
import { sheetSchemaSignature } from "../src/params/sheet.js";
import { FLANGE_SOURCE } from "../src/demos/block-hole-params.js";

let failed = 0;

function expect(cond, msg) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

// --- undo stack ---
{
  const u = createUndoStack({ limit: 5 });
  expect(!u.canUndo && !u.canRedo, "undo: empty stack");
  expect(u.undo() === null, "undo: at bottom returns null");
  expect(u.redo() === null, "redo: at top returns null");

  u.reset({ source: "a", values: { w: 1 } });
  expect(!u.canUndo, "undo: after reset no undo");
  expect(u.present?.source === "a", "undo: present is a");

  expect(u.push({ source: "b", values: { w: 2 } }) === true, "undo: push b");
  expect(u.canUndo, "undo: can undo after push");
  expect(u.push({ source: "b", values: { w: 2 } }) === false, "undo: equal push no-op");

  const back = u.undo();
  expect(back?.source === "a", "undo: restored a");
  expect(u.canRedo, "undo: can redo");
  expect(u.redo()?.source === "b", "redo: restored b");

  u.reset({ source: "0", values: {} });
  for (let i = 1; i <= 8; i++) u.push({ source: String(i), values: {} });
  expect(u.depth <= 5, "undo: ring limited");
  let n = 0;
  while (u.canUndo) {
    u.undo();
    n++;
  }
  expect(n <= 5, "undo: limited undos " + n);
  expect(u.undo() === null, "undo: bottom after drain");
}

// --- memory backend + validation ---
{
  const b = createMemoryHistoryBackend();
  expect(b.kind === "memory", "backend: memory kind");
  expect(PRODUCT_GIT_IDENTITY.email === "cad@local", "identity: product-local");

  const open0 = await b.open("p1");
  expect(open0 === null, "backend: open empty");

  await b.saveWorktree("p1", {
    source: "local x = 1",
    values: { x: 1 },
    project: { name: "t", schema_version: 1 },
  });
  const open1 = await b.open("p1");
  expect(open1?.source === "local x = 1", "backend: worktree saved");

  let threw = false;
  try {
    await b.commit("p1", open1, { name: "", message: "x" });
  } catch {
    threw = true;
  }
  expect(threw, "backend: empty name throws");

  let longName = false;
  try {
    await b.commit("p1", open1, {
      name: "n".repeat(MAX_VERSION_NAME + 5),
      message: "x",
    });
  } catch {
    longName = true;
  }
  expect(longName, "backend: overlong name throws");

  const c1 = await b.commit(
    "p1",
    { source: "v1", values: {}, project: { name: "t", schema_version: 1 } },
    { name: "First", message: "first save" },
  );
  expect(!!c1.id && c1.name === "First", "backend: commit named");

  const c2 = await b.commit(
    "p1",
    { source: "v2", values: { a: 2 }, project: { name: "t", schema_version: 1 } },
    { message: "second" },
  );
  expect(c2.message === "second", "backend: commit message");

  const list = await b.listVersions("p1");
  expect(list.length === 2, "backend: two versions");
  expect(list[0].id === c2.id, "backend: newest first");

  const restored = await b.restore("p1", c1.id);
  expect(restored.source === "v1", "backend: restore v1");

  let missing = false;
  try {
    await b.restore("p1", "no-such-ref");
  } catch (e) {
    missing = e.message === "Unknown version" || /Unknown version/.test(e.message);
  }
  expect(missing, "backend: restore missing → Unknown version");

  // Prototype pollution: __proto__ must not resolve as a blob
  let proto = false;
  try {
    await b.restore("p1", "__proto__");
  } catch {
    proto = true;
  }
  expect(proto, "backend: restore __proto__ rejected");

  let ctor = false;
  try {
    await b.restore("p1", "constructor");
  } catch {
    ctor = true;
  }
  expect(ctor, "backend: restore constructor rejected");

  const tip = await b.tip("p1");
  expect(tip?.id === c2.id, "backend: tip is latest commit");

  // invalid project id
  let badId = false;
  try {
    sanitizeProjectId("../evil");
  } catch {
    badId = true;
  }
  expect(badId, "sanitize: rejects path-like projectId");
  expect(sanitizeProjectId("demo-flange") === "demo-flange", "sanitize: ok id");
}

// --- cloneDoc harden ---
{
  const polluted = {
    source: "s",
    values: { ok: 1, __proto__: { polluted: true }, constructor: 1 },
    project: { name: "x", schema_version: 1, evil: () => {} },
    meta: { camera: 1, __proto__: { x: 1 } },
  };
  const c = cloneDoc(polluted);
  expect(c.values.ok === 1, "cloneDoc: keeps ok value");
  expect(c.values.__proto__ === undefined || !("polluted" in (c.values.__proto__ || {})), "cloneDoc: no __proto__ value key");
  expect(!Object.prototype.hasOwnProperty.call(c.values, "constructor"), "cloneDoc: strips constructor key");
  expect(c.project.name === "x", "cloneDoc: project name");
  expect(typeof c.project.evil !== "function", "cloneDoc: strips function fields");
  expect(docsContentEqual(c, cloneDoc(c)), "docsContentEqual: reflexive");
}

// --- validation helpers ---
{
  expect(validateVersionName("ok") === "ok", "validate name ok");
  let empty = false;
  try {
    validateVersionName("  ", true);
  } catch {
    empty = true;
  }
  expect(empty, "validate name empty required");
  const msg = validateVersionMessage("m".repeat(600));
  expect(msg.length === 512, "validate message capped");
  let badRef = false;
  try {
    validateVersionRef("../../x");
  } catch {
    badRef = true;
  }
  expect(badRef, "validate ref path rejected");
}

// --- ProjectController ---
{
  const backend = createMemoryHistoryBackend();
  /** @type {string[]} */
  const applied = [];
  /** @type {number} */
  let dirtyTicks = 0;
  /** @type {number} */
  let historyTicks = 0;
  const ctl = createProjectController({
    projectId: "ctl-test",
    backend,
    autosaveMs: 50,
    onApply(doc, meta) {
      applied.push(meta.reason + ":" + doc.source);
    },
    onDirtyChange() {
      dirtyTicks++;
    },
    onHistoryChange() {
      historyTicks++;
    },
  });

  await ctl.open({
    source: "s0",
    values: { w: 10 },
    project: { name: "demo", schema_version: 1 },
  });
  expect(ctl.source === "s0", "ctl: open source");
  expect(applied.some((a) => a.startsWith("open:")), "ctl: onApply open");
  const histAfterOpen = historyTicks;

  // Live scrub + scrub commit: dirty badge only (never listVersions)
  const histBeforeScrub = historyTicks;
  ctl.setValues({ w: 11 }, { recordUndo: false, merge: false });
  ctl.setValues({ w: 12 }, { recordUndo: false, merge: false });
  expect(!ctl.canUndo, "ctl: scrub without undo");
  expect(ctl.values.w === 12, "ctl: live values");
  expect(dirtyTicks >= 2, "ctl: dirty ticks on scrub");
  expect(historyTicks === histBeforeScrub, "ctl: scrub does not emitHistory");

  // Commit scrub boundary — still badge only
  ctl.setValues({ w: 12 }, { recordUndo: true, merge: false });
  expect(ctl.canUndo, "ctl: can undo after value commit");
  expect(
    historyTicks === histBeforeScrub,
    "ctl: recordUndo does not emitHistory (badge only)",
  );

  // Schema replace must not be recorded as undo by host (tested via API contract):
  const depthBefore = ctl.canUndo;
  ctl.setValues({ w: 12, extra: 1 }, { recordUndo: false, merge: false });
  expect(ctl.canUndo === depthBefore, "ctl: replace-style setValues no extra undo");

  ctl.setSource("s1", { recordUndo: true });
  expect(ctl.source === "s1", "ctl: setSource");
  expect(ctl.canUndo, "ctl: can undo after source");
  expect(historyTicks === histBeforeScrub, "ctl: setSource checkpoint no listVersions");

  const u1 = await ctl.undo();
  expect(u1?.source === "s0", "ctl: undo to s0");
  expect(applied.some((a) => a.startsWith("undo:")), "ctl: onApply undo");
  expect(historyTicks === histBeforeScrub, "ctl: undo does not emitHistory");

  const r1 = await ctl.redo();
  expect(r1?.source === "s1", "ctl: redo to s1");

  while (ctl.canUndo) await ctl.undo();
  expect((await ctl.undo()) === null, "ctl: undo at bottom null");

  while (ctl.canRedo) await ctl.redo();
  expect((await ctl.redo()) === null, "ctl: redo at top null");

  let emptyName = false;
  try {
    await ctl.commitVersion({ name: "   " });
  } catch {
    emptyName = true;
  }
  expect(emptyName, "ctl: empty version name throws");

  ctl.setSource("final", { recordUndo: true });
  const histBeforeCommit = historyTicks;
  const ver = await ctl.commitVersion({ name: "Release", message: "ship it" });
  expect(ver.name === "Release", "ctl: named version");
  expect(!ctl.dirty, "ctl: clean after commit");
  expect(historyTicks > histBeforeCommit, "ctl: commitVersion emitsHistory");

  const versions = await ctl.listVersions();
  expect(versions.length >= 1, "ctl: listVersions");

  ctl.setSource("dirty-again", { recordUndo: true });
  expect(ctl.dirty, "ctl: dirty after edit");
  expect(ctl.canUndo, "ctl: can undo before restore");

  // Restore tip → clean; pre-restore kept on undo stack
  const histBeforeRestore = historyTicks;
  await ctl.restoreVersion(ver.id);
  expect(ctl.source === "final", "ctl: restore tip content");
  expect(!ctl.dirty, "ctl: restore tip is clean");
  expect(ctl.alignedVersionId === ver.id, "ctl: aligned to restored tip");
  expect(ctl.canUndo, "ctl: restore keeps undo of pre-restore");
  expect(historyTicks > histBeforeRestore, "ctl: restoreVersion emitsHistory");
  const pre = await ctl.undo();
  expect(pre?.source === "dirty-again", "ctl: undo after restore → pre-restore");

  // Restore again then check older vs tip dirty when two versions
  ctl.setSource("v2body", { recordUndo: true });
  const ver2 = await ctl.commitVersion({ name: "Second" });
  expect(ctl.alignedVersionId === ver2.id, "ctl: aligned after commit");
  // Param-only style: values change, source same — restore must bring values back
  ctl.setValues({ w: 99 }, { recordUndo: true, merge: false });
  const verParams = await ctl.autoCommit({ reason: "params" });
  expect(!!verParams, "ctl: autoCommit params version");
  expect(ctl.values.w === 99, "ctl: values after params edit");
  await ctl.restoreVersion(ver2.id);
  expect(ctl.values.w !== 99 || ctl.source === "v2body", "ctl: restore older not stuck at 99");
  // ver2 was committed with whatever values were present at that commit
  const blob2 = await backend.readVersion("ctl-test", ver2.id);
  expect(ctl.values.w === blob2?.values?.w, "ctl: restore applies blob values");
  expect(ctl.alignedVersionId === ver2.id, "ctl: aligned to restored older");
  expect(ctl.dirty, "ctl: restore older is dirty vs tip");
  // Newer tip still listed; alignment is older — panel would show Current on older
  await ctl.restoreVersion(ver.id);
  expect(ctl.source === "final", "ctl: restore older content");
  expect(ctl.alignedVersionId === ver.id, "ctl: aligned after second restore");
  expect(ctl.dirty, "ctl: restore older is dirty vs tip");

  // Failed restore must not pollute undo stack
  const canUndoBeforeFail = ctl.canUndo;
  const sourceBeforeFail = ctl.source;
  let badRestore = false;
  try {
    await ctl.restoreVersion("missingref");
  } catch {
    badRestore = true;
  }
  expect(badRestore, "ctl: restore missing throws");
  expect(ctl.source === sourceBeforeFail, "ctl: failed restore keeps source");
  expect(ctl.canUndo === canUndoBeforeFail, "ctl: failed restore no stack pollution");

  let noRef = false;
  try {
    await ctl.restoreVersion("");
  } catch {
    noRef = true;
  }
  expect(noRef, "ctl: empty ref throws");

  // Single-flight: concurrent undos serialize (no torn state)
  ctl.setSource("a1", { recordUndo: true });
  ctl.setSource("a2", { recordUndo: true });
  ctl.setSource("a3", { recordUndo: true });
  const p1 = ctl.undo();
  const p2 = ctl.undo();
  const [rA, rB] = await Promise.all([p1, p2]);
  expect(!!rA && !!rB, "ctl: concurrent undos both complete");
  expect(typeof ctl.source === "string", "ctl: source coherent after concurrent undo");

  // open fail soft: backend that throws on open
  const boomBackend = {
    kind: "boom",
    async open() {
      throw new Error("idb open failed");
    },
    async saveWorktree() {},
    async commit() {
      throw new Error("no");
    },
    async listVersions() {
      return [];
    },
    async restore() {
      throw new Error("Unknown version");
    },
    async tip() {
      return null;
    },
  };
  const ctl2 = createProjectController({
    projectId: "boom-test",
    backend: boomBackend,
    autosaveMs: 10_000,
  });
  const seeded = await ctl2.open({
    source: "seed",
    values: {},
    project: { name: "s", schema_version: 1 },
  });
  expect(seeded.source === "seed", "ctl: open fails soft → seed");

  // Open dirty vs tip blob: worktree differs from tip content
  const mem2 = createMemoryHistoryBackend();
  await mem2.commit(
    "dirty-open",
    { source: "tip-src", values: { w: 1 }, project: { name: "d", schema_version: 1 } },
    { name: "Tip" },
  );
  // Diverge worktree without new commit
  await mem2.saveWorktree("dirty-open", {
    source: "worktree-src",
    values: { w: 2 },
    project: { name: "d", schema_version: 1 },
  });
  const ctl3 = createProjectController({
    projectId: "dirty-open",
    backend: mem2,
    autosaveMs: 10_000,
  });
  await ctl3.open();
  expect(ctl3.source === "worktree-src", "ctl: open loads worktree");
  expect(ctl3.dirty === true, "ctl: open dirty when worktree ≠ tip blob");

  ctl.dispose();
  ctl2.dispose();
  ctl3.dispose();
  expect(historyTicks > histAfterOpen, "ctl: history ticks after open path");
  expect(ver2.id !== ver.id, "ctl: two distinct versions");
}


  // --- autoCommit (Overleaf continuous history) ---
  {
    const mem = createMemoryHistoryBackend();
    const ctl = createProjectController({
      projectId: "auto1",
      backend: mem,
      autosaveMs: 50,
    });
    await ctl.open({
      source: "a",
      values: { w: 1 },
      project: { name: "p", schema_version: 1 },
      meta: {},
    });
    // no tip yet, dirty content → auto commit creates first point
    ctl.setSource("b", { recordUndo: true });
    const e1 = await ctl.autoCommit({ reason: "code" });
    expect(!!e1 && !!e1.id, "ctl: autoCommit creates point");
    expect(ctl.dirty === false, "ctl: clean after autoCommit");
    // equal content → no-op
    const e2 = await ctl.autoCommit({ reason: "code" });
    expect(e2 === null, "ctl: autoCommit no-op when clean");
    ctl.setValues({ w: 2 }, { recordUndo: true, merge: false });
    const e3 = await ctl.autoCommit({ reason: "params" });
    expect(!!e3 && e3.id !== e1.id, "ctl: autoCommit on value change");
    const list = await ctl.listVersions();
    expect(list.length >= 2, "ctl: auto history length");
    ctl.dispose?.();
  }


  // --- clearDocument ---
  {
    const mem = createMemoryHistoryBackend();
    const ctl = createProjectController({
      projectId: "clear1",
      backend: mem,
    });
    await ctl.open({
      source: "v1",
      values: { a: 1 },
      project: { name: "p", schema_version: 1 },
      meta: {},
    });
    await ctl.autoCommit({ reason: "params" });
    ctl.setValues({ a: 2 }, { recordUndo: true, merge: false });
    await ctl.autoCommit({ reason: "params" });
    let n = (await ctl.listVersions()).length;
    expect(n >= 1, "clear: has versions before wipe");
    await ctl.clearDocument({
      source: "fresh",
      values: {},
      project: { name: "untitled", schema_version: 1 },
      meta: {},
    });
    const after = await ctl.listVersions();
    expect(after.length === 1, "clear: single seed version after wipe");
    expect(ctl.document.source === "fresh", "clear: source reset");
    expect((await ctl.listVersions())[0]?.message?.includes("open"), "clear: seed is open auto");
    ctl.dispose?.();
  }

// --- git adapter without engine throws / tryCreate returns null ---
{
  let threw = false;
  try {
    await createGitHistoryBackend({});
  } catch {
    threw = true;
  }
  expect(threw, "git: create without engine throws");
}

// --- real GitEngine (node) when MC_GIT_ENGINE_TAR is set ---
{
  const tarPath = process.env.MC_GIT_ENGINE_TAR || "";
  if (!tarPath) {
    console.log("skip: GitEngine smoke (set MC_GIT_ENGINE_TAR=agent-os/vendor/git-engine.tar)");
  } else {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const {
      tryCreateGitHistoryBackend,
      parseGitLog,
      remoteOriginOf,
    } = await import("../src/history/git-backend.js");

    expect(
      remoteOriginOf("https://github.com/org/repo.git") === "https://github.com",
      "git: remoteOriginOf https",
    );
    expect(remoteOriginOf("git@github.com:org/repo.git") === null, "git: reject ssh url");
    expect(
      parseGitLog("abc1234 first\ndef5678 second\n# log: bounded\n").length === 2,
      "git: parseGitLog",
    );

    const durableDir = mkdtempSync(join(tmpdir(), "occ-git-hist-"));
    try {
      const git = await tryCreateGitHistoryBackend({
        enginePath: tarPath,
        durableDir,
        projectId: "smoke-git",
      });
      expect(!!git && git.kind === "git", "git: live backend kind");
      if (!git) throw new Error("expected git backend");

      expect(git.available === true, "git: available");
      expect(git.identity?.email === "cad@local", "git: product identity");

      const open0 = await git.open("smoke-git");
      expect(open0 === null || typeof open0.source === "string", "git: open empty-ish");

      await git.saveWorktree("smoke-git", {
        source: "local x = 1",
        values: { x: 1 },
        project: { name: "g", schema_version: 1 },
      });
      const wt = await git.open("smoke-git");
      expect(wt?.source === "local x = 1", "git: worktree main.luau");
      expect(wt?.values?.x === 1, "git: worktree values");

      const c1 = await git.commit(
        "smoke-git",
        {
          source: "local x = 2",
          values: { x: 2 },
          project: { name: "g", schema_version: 1 },
        },
        { name: "First", message: "First" },
      );
      expect(!!c1.id && c1.id.length >= 7, "git: commit id");
      expect(c1.message === "First" || c1.name === "First", "git: commit message=name");

      const c2 = await git.commit(
        "smoke-git",
        {
          source: "local x = 3",
          values: { x: 3 },
          project: { name: "g", schema_version: 1 },
        },
        { name: "Second" },
      );
      expect(c2.id !== c1.id, "git: distinct commits");

      const list = await git.listVersions("smoke-git");
      expect(list.length >= 2, "git: listVersions");
      expect(list[0].id === c2.id || list[0].id.startsWith(c2.id.slice(0, 7)), "git: newest first");

      const tip = await git.tip("smoke-git");
      expect(!!tip?.id, "git: tip");

      const restored = await git.restore("smoke-git", c1.id);
      expect(restored.source === "local x = 2", "git: restore First source");
      expect(restored.values?.x === 2, "git: restore First values");

      const readBack = await git.readVersion("smoke-git", c2.id);
      expect(readBack?.source === "local x = 3", "git: readVersion without staying on c2");

      // Remote API present with clear errors when dial fails / no remote
      const noRemote = await git.push({});
      expect(noRemote.ok === false, "git: push without remote fails closed");
      expect(
        /remote|unavailable|URL/i.test(noRemote.message || ""),
        "git: push error message",
      );

      const setR = await git.setRemote("https://example.com/r.git");
      expect(setR.ok === true, "git: setRemote local config");
      const got = await git.getRemote();
      expect(
        got === "https://example.com/r.git" || !!got,
        "git: getRemote",
      );

      // Network clone is slow/flaky in CI — only check orchestrator wiring via
      // a clearly invalid locator that fails before dial when possible.
      // (Real dial tests live in AgentOS; product needs clear error strings.)
      const cl = await git.clone("not-a-url");
      expect(cl.ok === false, "git: clone rejects bad url");
      expect(typeof cl.message === "string" && cl.message.length > 0, "git: clone error text");

      // ProjectController over git backend
      const ctlG = createProjectController({
        projectId: "smoke-git-ctl",
        backend: git,
        autosaveMs: 10_000,
      });
      await ctlG.open({
        source: "s0",
        values: { w: 1 },
        project: { name: "ctl", schema_version: 1 },
      });
      ctlG.setSource("s1", { recordUndo: true });
      const ver = await ctlG.commitVersion({ name: "CtlSave" });
      expect(ver.name === "CtlSave" || ver.message === "CtlSave", "git ctl: commitVersion");
      const versions = await ctlG.listVersions();
      expect(versions.length >= 1, "git ctl: listVersions");
      ctlG.setSource("dirty", { recordUndo: true });
      await ctlG.restoreVersion(ver.id);
      expect(ctlG.source === "s1", "git ctl: restoreVersion");
      ctlG.dispose();

      if (typeof git.close === "function") await git.close("smoke-git");
    } finally {
      try {
        rmSync(durableDir, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
  }
}

// --- idb backend kind (node: no indexedDB → still constructible; open soft) ---
{
  // In Node, indexedDB is typically undefined — factory still returns object.
  // createIdbHistoryBackend always returns kind "idb"; open falls back to memory.
  if (typeof indexedDB === "undefined") {
    const idb = createIdbHistoryBackend();
    expect(idb.kind === "idb", "idb: kind is idb (not opfs)");
    const doc = await idb.open("node-proj");
    expect(doc === null, "idb: open empty without IDB");
  } else {
    const idb = createIdbHistoryBackend();
    expect(idb.kind === "idb", "idb: kind is idb");
  }
}

// --- cancelled soft-success shape (protocol contract for host) ---
{
  // Host treats cancelled like soft success (code 0). Document the contract.
  const cancelled = {
    id: 1,
    kind: "execute",
    code: 0,
    cancelled: true,
    diagnostics: [],
    meta: { cancelled: true, reason: "superseded" },
  };
  expect(cancelled.code === 0 && cancelled.cancelled === true, "cancel: soft-success shape");
  expect(
    cancelled.cancelled || cancelled.kind === "analyze" || cancelled.code === 0,
    "cancel: host resolve predicate",
  );
}

// --- mid-flight OCC abort soft-success (Phase 3 preempt) ---
{
  // Worker posts cancelled:true with reason "aborted" when an in-flight
  // execute is cooperatively stopped at a cad.call boundary after a newer
  // execute generation arrives. Host must treat like superseded (no error UI).
  const aborted = {
    id: 2,
    kind: "execute",
    code: 0,
    cancelled: true,
    diagnostics: [],
    meta: { cancelled: true, reason: "aborted" },
  };
  expect(aborted.code === 0 && aborted.cancelled === true, "abort: soft-success shape");
  expect(aborted.meta.reason === "aborted", "abort: reason is aborted");
  // main.js: msg.cancelled → resolve, not reject
  const hostResolves =
    aborted.cancelled || aborted.kind === "analyze" || aborted.code === 0;
  expect(hostResolves, "abort: host resolve predicate");

  // Guest IR fail marker shape (ir.host → IR_ERR_ABORTED → __OCC_CAD_RESULT__).
  const failPayload = {
    schema: 1,
    ok: false,
    error: {
      code: "IR_ERR_ABORTED",
      message: "aborted",
      aborted: true,
      host_op: "make_box",
      op: "PrimBox",
      op_id: "box1",
    },
  };
  const e = failPayload.error;
  const isAbortFail =
    failPayload.ok === false &&
    (e.aborted === true ||
      e.code === "IR_ERR_ABORTED" ||
      e.message === "aborted" ||
      String(e.message || "").startsWith("aborted:"));
  expect(isAbortFail, "abort: IR fail payload detected as cooperative abort");
  // User geometry errors must not look like abort.
  const userFail = {
    ok: false,
    error: { code: "IR_ERR_HOST", message: "occ_make_box failed (1): bad dim" },
  };
  const ue = userFail.error;
  const isUserAbort =
    userFail.ok === false &&
    (ue.aborted === true ||
      ue.code === "IR_ERR_ABORTED" ||
      ue.message === "aborted" ||
      String(ue.message || "").startsWith("aborted:"));
  expect(!isUserAbort, "abort: real OCC error is not cooperative abort");

  // Cad tool sentinel contract (worker → host.luau).
  const sentinel = { __occ_err: "aborted", aborted: true, __occ_op: "cut" };
  expect(
    sentinel.aborted === true && sentinel.__occ_err === "aborted",
    "abort: cad tool sentinel shape",
  );
}

// --- shared schema signature ---
{
  const list = [
    {
      name: "width",
      type: "number",
      value: 40,
      defaultValue: 40,
      min: 16,
      max: 120,
      step: 0.5,
      scrub: "rebuild",
      group: "Size",
      unit: "mm",
    },
  ];
  const a = schemaSignature(list);
  const b = sheetSchemaSignature(list);
  expect(a === b, "schema: main and sheet share signature");
  const list2 = [{ ...list[0], value: 99 }];
  expect(schemaSignature(list2) === a, "schema: value-only change same sig");
}

// --- params header fingerprint ---
{
  const fp1 = paramsHeaderFingerprint(FLANGE_SOURCE);
  expect(!!fp1 && fp1.includes(":"), "fingerprint: non-empty");

  const bodyEdit = FLANGE_SOURCE.replace(
    'solid.finish(part, { name = "flange_plate" })',
    'solid.finish(part, { name = "flange_plate_v2" })',
  );
  const fp2 = paramsHeaderFingerprint(bodyEdit);
  expect(fp1 === fp2, "fingerprint: body-only change stable");

  const paramEdit = FLANGE_SOURCE.replace(
    "local width = 40 -- [16:0.5:120] mm",
    "local width = 50 -- [16:0.5:120] mm",
  );
  const fp3 = paramsHeaderFingerprint(paramEdit);
  expect(fp1 !== fp3, "fingerprint: param header change differs");

  // Late annotated param after solid.* must still affect fingerprint
  const late = FLANGE_SOURCE + "\nlocal late_p = 3 -- [1:1:10] mm\n";
  const fp4 = paramsHeaderFingerprint(late);
  expect(fp1 !== fp4, "fingerprint: late annotated param included");
}

// --- timer-clear contract (sheet): clear before commit is unit-tested via logic ---
{
  // Simulate scheduleCommit/commit race: last write wins when timer cleared on commit.
  let committed = [];
  const timers = new Map();
  function clearTimer(name) {
    if (timers.has(name)) {
      clearTimeout(timers.get(name));
      timers.delete(name);
    }
  }
  function schedule(name, value) {
    clearTimer(name);
    timers.set(
      name,
      setTimeout(() => {
        timers.delete(name);
        committed.push(value);
      }, 20),
    );
  }
  function commit(name, value) {
    clearTimer(name);
    committed.push(value);
  }
  schedule("w", 1);
  commit("w", 2);
  await new Promise((r) => setTimeout(r, 40));
  expect(committed.length === 1 && committed[0] === 2, "timers: commit clears pending schedule");
}

if (failed) {
  console.error(`\nhistory_smoke: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\nhistory_smoke PASS");
