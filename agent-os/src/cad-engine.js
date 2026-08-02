/**
 * Shared CadEngine: AgentOS loom + host tools + OccBridge.
 * Used by the browser runtime worker and Node smoke.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OccBridge } from "./occ-bridge.js";
import { PROTOCOL } from "./protocol.js";

/**
 * @typedef {object} EnginePaths
 * @property {string} kernel
 * @property {string} loom
 * @property {string} mcCore
 * @property {string} catalogCompiler
 * @property {string} occBase  directory with libocc_c.js + .wasm (file URL or path)
 * @property {string} solidLuau path to solid.luau
 * @property {string} [batteriesDir] directory containing solid.luau + ir/ (defaults to solid parent)
 * @property {"browser"|"local"} [runtime]
 */

export class CadEngine {
  /**
   * @param {EnginePaths} paths
   * @param {{ fetchBytes?: Function, fetchText?: Function }} [io]
   */
  constructor(paths, io = {}) {
    this.paths = paths;
    this.io = io;
    this.occ = null;
    this.vm = null;
    this.mcApi = null;
    /** @type {boolean} */
    this._paramsResolveStaged = false;
  }

  async #bytes(pathOrUrl) {
    if (this.io.fetchBytes) return this.io.fetchBytes(pathOrUrl);
    return new Uint8Array(readFileSync(pathOrUrl));
  }

  async #text(pathOrUrl) {
    if (this.io.fetchText) return this.io.fetchText(pathOrUrl);
    return readFileSync(pathOrUrl, "utf8");
  }

  async warm() {
    if (this.vm && this.occ) return this;

    const mcUrl = this.paths.mcCore.startsWith("file:") || this.paths.mcCore.includes("://")
      ? this.paths.mcCore
      : pathToFileURL(this.paths.mcCore).href;

    const occBase = this.paths.occBase.endsWith("/")
      ? this.paths.occBase
      : this.paths.occBase + "/";
    const occImport = occBase.startsWith("file:") || occBase.includes("://")
      ? new URL("libocc_c.js", occBase).href
      : pathToFileURL(occBase.replace(/\/?$/, "/") + "libocc_c.js").href;

    const [{ mc, tool, z }, kernel, image, catalogCompiler] = await Promise.all([
      import(mcUrl),
      this.#bytes(this.paths.kernel),
      this.#bytes(this.paths.loom),
      this.#bytes(this.paths.catalogCompiler),
    ]);
    this.mcApi = { mc, tool, z };

    // OccBridge.create expects a base URL with trailing slash for locateFile.
    const occBaseUrl = occImport.replace(/libocc_c\.js$/, "");
    // Reuse OccBridge loader (handles non-ES6 glue + wasm filename).
    const occBridge = await OccBridge.create(
      occBaseUrl.startsWith("file:") || /^(https?|file):/i.test(occBaseUrl)
        ? occBaseUrl
        : pathToFileURL(occBase.replace(/\/?$/, "/") ).href,
    );
    this.occ = occBridge;

    const occ = this.occ;
    const cadTool = tool({
      name: "cad call",
      description: "OpenCASCADE host geometry op.",
      input: z
        .object({
          op: z.string(),
        })
        .passthrough(),
      async run(input) {
        const { op, ...rest } = input;
        return occ.call(op, rest);
      },
    });

    const runtime = this.paths.runtime ?? (typeof window === "undefined" ? "local" : "browser");
    this.vm = await mc.create({
      runtime,
      kernel,
      image,
      catalogCompiler,
      tools: [cadTool],
    });
    return this;
  }

  /**
   * @param {string} path
   */
  async #mkdirp(path) {
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (const p of parts) {
      cur += "/" + p;
      try {
        await this.vm.fs.mkdir(cur);
      } catch {
        /* exists or race */
      }
    }
  }

  /**
   * Stage batteries + cad.ir under /opt/cad for package.path.
   * Top-level *.luau (solid, route, frames, query, cad, …) + ir/ tree.
   * solid.* always lowers to IR; route/frames remain host-backed tools.
   */
  async stageBatteries() {
    await this.#mkdirp("/opt/cad/ir/ops");

    const batteriesDir = this.paths.batteriesDir
      || dirname(this.paths.solidLuau);

    // Top-level batteries: solid + route + frames + query + cad aggregator
    try {
      const entries = readdirSync(batteriesDir);
      for (const name of entries) {
        if (!name.endsWith(".luau") && !name.endsWith(".lua")) continue;
        const hostPath = join(batteriesDir, name);
        try {
          if (!statSync(hostPath).isFile()) continue;
        } catch {
          continue;
        }
        const text = await this.#text(hostPath);
        await this.vm.fs.write(`/opt/cad/${name}`, text);
      }
    } catch {
      // Fallback: at least stage solid.luau from configured path
      const solid = await this.#text(this.paths.solidLuau);
      await this.vm.fs.write("/opt/cad/solid.luau", solid);
    }

    const irDir = join(batteriesDir, "ir");
    try {
      if (statSync(irDir).isDirectory()) {
        await this.#stageLuauTree(irDir, "/opt/cad/ir");
      }
    } catch {
      /* ir package optional for pure solid smokes */
    }
  }

  /**
   * @param {string} hostDir
   * @param {string} guestDir
   */
  async #stageLuauTree(hostDir, guestDir) {
    await this.#mkdirp(guestDir);
    const entries = readdirSync(hostDir);
    for (const name of entries) {
      const hostPath = join(hostDir, name);
      const st = statSync(hostPath);
      if (st.isDirectory()) {
        await this.#stageLuauTree(hostPath, `${guestDir}/${name}`);
      } else if (name.endsWith(".luau") || name.endsWith(".lua")) {
        const text = await this.#text(hostPath);
        await this.vm.fs.write(`${guestDir}/${name}`, text);
      }
    }
  }

  parseResult(stdout) {
    const marker = "__OCC_CAD_RESULT__";
    for (const line of String(stdout || "").split(/\r?\n/).reverse()) {
      const idx = line.indexOf(marker);
      if (idx >= 0) return JSON.parse(line.slice(idx + marker.length));
    }
    return null;
  }

  /**
   * Parse __OCC_PARAMS_RESULT__ + JSON POD array from guest stdout.
   * @param {string} stdout
   * @returns {any[] | null}
   */
  parseParamsResult(stdout) {
    const marker = "__OCC_PARAMS_RESULT__";
    for (const line of String(stdout || "").split(/\r?\n/).reverse()) {
      const idx = line.indexOf(marker);
      if (idx >= 0) {
        const parsed = JSON.parse(line.slice(idx + marker.length));
        return Array.isArray(parsed) ? parsed : null;
      }
    }
    return null;
  }

  /**
   * Stage only params_resolve.luau (schema harvest needs syntax/json builtins only).
   */
  async stageParamsResolveBattery() {
    if (this._paramsResolveStaged) return;
    await this.#mkdirp("/opt/cad");
    const batteriesDir =
      this.paths.batteriesDir || dirname(this.paths.solidLuau);
    const hostPath = join(batteriesDir, "params_resolve.luau");
    const text = await this.#text(hostPath);
    await this.vm.fs.write("/opt/cad/params_resolve.luau", text);
    this._paramsResolveStaged = true;
  }

  /**
   * Product params harvest: guest require("syntax") → pure POD list.
   * Stages params_resolve.luau only (not full solid/ir); starts syntax lazily.
   * Hard-fails if marker/JSON missing or luau exits nonzero.
   *
   * @param {string} source
   * @returns {Promise<{ params: any[], meta: object, stdout: string, stderr: string }>}
   */
  async resolveParams(source) {
    await this.warm();
    await this.stageParamsResolveBattery();
    const src = source ?? "";
    await this.#mkdirp("/tmp");
    const srcPath = `/tmp/params_resolve_src_${Date.now()}.luau`;
    await this.vm.fs.write(srcPath, src);
    const harness =
      `package.path = "/opt/cad/?.luau;/opt/cad/?/init.luau;" .. package.path\n` +
      `local pr = require("params_resolve")\n` +
      `pr.run_file(${JSON.stringify(srcPath)})\n`;
    const result = await this.vm.luau(harness);
    if (result.exitCode !== 0) {
      const err = new Error(
        (result.stderr || result.stdout || "params_resolve failed").trim(),
      );
      err.stdout = result.stdout;
      err.stderr = result.stderr;
      err.exitCode = result.exitCode;
      throw err;
    }
    let params;
    try {
      params = this.parseParamsResult(result.stdout);
    } catch (e) {
      const err = new Error(
        `params_resolve: invalid POD JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
      err.stdout = result.stdout;
      throw err;
    }
    if (!params) {
      const err = new Error(
        "missing __OCC_PARAMS_RESULT__ — params_resolve battery / syntax failed",
      );
      err.stdout = result.stdout;
      throw err;
    }
    return {
      params,
      meta: {
        protocol: PROTOCOL,
        path: "syntax",
        syntax: true,
        count: params.length,
      },
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  /**
   * @param {string} source
   * @param {{ deflection?: number }} [opts]
   */
  async execute(source, opts = {}) {
    await this.warm();
    this.occ.freeAll();
    await this.stageBatteries();
    if (!source?.trim()) throw new Error("empty Luau source");

    // ?.luau → solid.luau, ir/load.luau; ?/init.luau → ir/init.luau
    const wrapped =
      `package.path = "/opt/cad/?.luau;/opt/cad/?/init.luau;" .. package.path\n` + source;
    const result = await this.vm.luau(wrapped);
    if (result.exitCode !== 0) {
      const err = new Error((result.stderr || result.stdout || "luau failed").trim());
      err.stdout = result.stdout;
      err.stderr = result.stderr;
      err.exitCode = result.exitCode;
      throw err;
    }

    const payload = this.parseResult(result.stdout);
    if (!payload || typeof payload.root !== "number") {
      const err = new Error("missing __OCC_CAD_RESULT__ — call solid.finish(root)");
      err.stdout = result.stdout;
      throw err;
    }

    const deflection = opts.deflection ?? 0.15;
    const mesh = this.occ.mesh(payload.root, deflection);
    return {
      code: 0,
      mesh,
      meta: {
        protocol: PROTOCOL,
        root: payload.root,
        name: payload.name,
        occVersion: this.occ.version(),
        deflection,
      },
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async close() {
    if (this.occ) this.occ.freeAll();
    if (this.vm) await this.vm.close();
    this.vm = null;
    this.occ = null;
  }
}
