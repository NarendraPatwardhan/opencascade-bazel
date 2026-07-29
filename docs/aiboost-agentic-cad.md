# Architecture notes: agentic CAD on `occ_c`

How this repository approaches **scripted, reviewable CAD** in the browser: a trusted geometry kernel, a sandboxed language runtime, and a thin host bridge. Run commands live in the root and `agent-os/` READMEs; this file records structure and trade-offs.

---

## Problem

CAD automation usually fails in one of three ways:

1. The model invents geometry the kernel cannot represent or verify.  
2. The stack is a desktop Python/C++ environment that does not fit secure or browser deployment.  
3. Untrusted code shares ambient authority with the host (filesystem, network, credentials).

We want the opposite: **parametric intent in a real language**, **BRep truth in OCCT**, and a **clear trust boundary** between the two.

---

## Design thesis

**Separate the geometry kernel from the agent computer.** Keep both hermetic. The script never holds raw OCCT pointers; the kernel never executes untrusted language runtimes inside its process.

| Layer | Role | Trust |
|-------|------|--------|
| **`occ_c` (Apache-2.0)** | C ABI over a modeling subset of OCCT 7.9.3 | Trusted kernel |
| **`libocc_c` Wasm** | Same ABI in the browser | Trusted kernel |
| **AgentOS `loom` (BSL)** | Sandboxed Unix + Luau + tools broker | Untrusted guest |
| **Host CAD tools** | `cad.call` → `occ_*` | Trusted mediation |
| **UI** | Monaco editor + mesh view | Human-in-the-loop |

Authors write **Luau**, not C++. Geometry is **OCCT BRep** reached only through opaque handles and integer status codes.

```text
plan / parameters
    → Luau program
        → AgentOS guest (no ambient host)
            → host tool "cad.call"
                → occ_c / OCCT
                    → mesh / export
                        → review UI
```

---

## Rejected alternatives

1. **Expose OCCT C++ to the browser** — unsafe and unmaintainable for FFI.  
2. **Run full OCCT as an AgentOS wasmi guest** — ABI mismatch (Emscripten vs `mc_sys`), size (~28 MiB), nested interpretation cost.  
3. **Freestanding Luau World as the product path** — good sandbox shape, but rebuilds filesystem, tools, analyze, and fuel already provided by AgentOS.  
4. **Python / OCP / build123d in the Bazel graph** — useful as API *inspiration*, wrong runtime for this delivery model.

---

## License split

| Tree | License | Contents |
|------|---------|----------|
| `api/`, `examples/`, OCCT packaging | Apache-2.0 | Geometry kernel consumers can depend on this alone |
| `agent-os/` | BSL 1.1 | AgentOS release consumption, CadEngine, browser demo |

The kernel stays reusable without pulling in the scripting product.

---

## Build and dependencies

- **OCCT** is pinned (7.9.3) and built hermetically; optional **BuildBuddy RBE** for heavy Wasm links.  
- **AgentOS** is not rebuilt here. Release **v0.4.0** assets (`kernel.wasm`, `loom.tar`, `mc-core.mjs`, `catalog-compiler.wasm`) are pinned by sha256.  
- Browser `mc-core` needs a small **browserify** step: the upstream single-file release still carries Node builtins at the top level.

---

## Vertical slice that is implemented

Proof requirement we actually cleared:

> Real Luau, in real AgentOS, calling real `occ_*`, producing a non-empty mesh, visible in a browser; failures leave the page usable.

Current demo path:

- Luau builds a rectangular solid and cuts a cylinder.  
- Host tools implement `solid.box` / `solid.cylinder` / `solid.cut` via `occ_make_*` / `occ_cut`.  
- `solid.finish(root)` emits a structured result; the host runs `occ_mesh_compute`.  
- UI: Monaco (Luau Monarch), status line, mesh panel.

![Browser demo — Monaco Luau and OCCT mesh](browser-demo.png)

**Figure.** Left: parametric Luau. Right: OCCT mesh with cutout; metadata includes `occVersion`, root id, and meshing deflection.

That is a **unit of trust** for later work (assemblies, constraints, simulation prep). It is not those features yet.

---

## Capability map (present → next)

| Capability | Present | Next on this stack |
|------------|---------|---------------------|
| Parametric solid ops | Primitives, booleans, fillets, transforms in `occ_c` + Luau `solid.*` | Broader algebra (sketches, datums, assemblies) |
| Measure / topology | Volume, bbox, counts | Richer selectors; constraint IR |
| Mesh | `occ_mesh_compute` for viz | Quality metrics, FEA export, seed strategies |
| Exchange | STEP/BREP/STL paths | Memory exporters; assembly STEP |
| Script sandbox | AgentOS loom, host tool allowlist | Stronger budgets, analyze gate, manifests |
| NL / agent planning | Outside the kernel (author produces Luau) | Keep planning out of `occ_c`; validate scripts before execute |

**Oversight:** the guest has no ambient host FS/network by default; geometry is an allowlisted tool surface; a person still hits Run.

---

## Open work

1. Drawing / assembly intake (2D, metadata) feeding parameters or IR.  
2. Mating and assembly constraints in the C API and script layer.  
3. Simulation backends (display mesh ≠ structural mesh).  
4. Reproducibility manifests (script hash, kernel hash, params).  
5. Separating **planner quality** from **kernel correctness** in evaluation.

Gaps should plug in as **new tools and IR stages**, not as rewrites of OCCT packaging.

---

## Related files

| Artifact | Location |
|----------|----------|
| Demo screenshot | [`browser-demo.png`](browser-demo.png) |
| Decision log | [`process-decisions.md`](process-decisions.md) |
| C API | `api/include/occ_c.h` |
| Pure-C check | `//examples/c_api` |
| Browser scripting product | `agent-os/` |
