# From browser kernel to agentic CAD — positioning for AI-BOOST Challenge 2

**Challenge:** *Agentic AI for Automated CAD Generation and Autonomous Simulation*  
(SIAD Group / AI-BOOST Challenge 2)  
**Project base:** `opencascade-bazel` — hermetic OCCT C ABI + browser Wasm + AgentOS Luau scripting  

This note is **not** a second README. It records *why* the stack looks the way it does, which bets we made under constraint, and how that maps to the challenge’s stated objectives (NL requirements → parametric CAD → mesh/simulation setup under human oversight). Use it when drafting the AI-BOOST application narrative.

---

## 1. What the challenge is really asking for

Reading the SIAD brief carefully, the hard problem is **not** “draw a box in a viewer.” It is an **agentic workflow**:

1. Interpret **natural-language** and **implicit** engineering constraints.  
2. Read **assemblies / 2D drawings / metadata** (piping-heavy in their data framework).  
3. **Generate** compatible, **parametric** 3D geometry that mates and fits.  
4. Support **simulation prep**: mesh seeds, convergence thinking, critical regions.  
5. Stay **reviewable**: experts approve; outputs must be traceable, not oracle blobs.  
6. Target **TRL 5–6** with effort and package-size KPIs against a manual baseline.

Industrial CAD agents fail for boring reasons: the model invents geometry the kernel cannot build; Python CAD stacks do not fit in a secure browser tab; the agent has ambient host access; there is no clean boundary between “script” and “BRep truth.” Our early work deliberately attacks those failure modes **before** full piping generation or FEA autonomy.

---

## 2. Design thesis (the bet we are making)

> **Separate the geometry kernel from the agent computer, keep both hermetic, and give the agent a language that cannot lie about ownership of shapes.**

Concretely:

| Layer | Role | Trust |
|-------|------|--------|
| **`occ_c` (Apache-2.0)** | Thin C ABI over a modeling subset of OCCT 7.9.3 | Trusted kernel |
| **`libocc_c` Wasm** | Same ABI in the browser (Emscripten + size pipeline) | Trusted kernel |
| **AgentOS `loom` (BSL)** | Sandboxed Unix + Luau + tools broker | Untrusted script runs *inside* |
| **Host CAD tools** | JS implements `cad.call` → `occ_*` | Trusted mediation |
| **UI** | Monaco Luau editor + mesh view | Human-in-the-loop surface |

The agent (human or LLM) authors **Luau**, not C++. Geometry is **never** freehand math in the LLM; it is **OCCT BRep** reached only through opaque handles and status codes. That is the precondition for trustworthy automation later (mating, STEP exchange, mesh for FEA).

```text
NL / agent plan
    → Luau program (intent, parameters, ops)
        → AgentOS guest (no ambient host)
            → host tool "cad.call"
                → occ_c / OCCT
                    → mesh / export
                        → expert review UI
```

---

## 3. Process: how we got to a working browser vertical slice

### 3.1 Refuse the wrong product shapes

We explicitly rejected several attractive dead ends:

1. **Expose OCCT C++ to the browser** — unmaintainable, unsafe, anti-FFI.  
2. **Run full OCCT as an AgentOS guest under wasmi** — wrong ABI (Emscripten vs `mc_sys`), wrong size (~28 MiB), catastrophic nested interpretation.  
3. **Freestanding Luau-only World first** — elegant sandbox, but rebuilds half of an agent computer we already have (filesystem, tools, analyze, fuel).  
4. **Python/OCP/build123d in-graph** — right inspiration for *API shape*, wrong runtime for browser-agent products.

The freestanding Luau design was written down and kept as an alternative; product velocity chose **AgentOS loom + host-bridged OCCT**.

### 3.2 License as architecture

The challenge wants European industrial sovereignty and clear IP. We split the tree on purpose:

- **Apache-2.0:** `api/`, `examples/c_api`, hermetic OCCT packaging, Wasm build.  
  Downstream tools and partners can consume a **clean C kernel** without AgentOS.  
- **BSL 1.1:** `agent-os/` only — AgentOS release artifacts, CadEngine, demo UI.  

That split is also an application story: open geometry kernel, productized agent runtime, no accidental license infection of the kernel.

### 3.3 Build discipline (and what we learned the hard way)

OCCT Wasm is large. The project host is not a compile farm. **RBE via BuildBuddy (`bb --config=buildbuddy`)** is the agent path for compiles; bare local `bazel` is for end users with better machines. That policy is written into `AGENTS.md` so the PoC stays reproducible under constraint — the same class of constraint industrial partners face (not every engineer has a 32-core CAD box).

AgentOS itself is **not** rebuilt from source in this repo. We pin **GitHub release v0.4.0** assets (`kernel.wasm`, `loom.tar`, `mc-core.mjs`, `catalog-compiler.wasm`) by sha256 via `http_file` and/or `scripts/fetch-release.sh`. That matches how industrial PoCs should treat platform dependencies: **versioned binaries**, not monorepo archaeology.

### 3.4 The first green bar (deliberately narrow)

Before piping, mating, or FEA, we required a **Rule-Zero-style** proof:

> Real Luau, in real AgentOS, calling real `occ_*`, producing a non-empty mesh, visible in a browser, with failures that do not kill the tab.

The demo that cleared that bar:

- Luau builds a **20×20×12 mm block** and **cuts a cylindrical hole**.  
- Host tools map `solid.box` / `solid.cylinder` / `solid.cut` → `occ_make_*` / `occ_cut`.  
- `solid.finish(root)` emits a structured result line; the host runs `occ_mesh_compute`.  
- UI shows Monaco-highlighted source, status (`130 verts, 120 tris`), and a WebGL solid.

That is intentionally a **unit of trust**, not the full SIAD workflow. Without it, “agent generates CAD” is slideware.

---

## 4. Evidence: browser PoC (current)

![Browser demo — Luau authoring (Monaco) and OCCT solid mesh](browser-demo.png)

**Figure.** Live demo surface: left — parametric Luau (Monaco + Luau Monarch highlighting); right — OCCT mesh of a solid with a cylindrical cutout, with protocol metadata (`occVersion`, root id, deflection). Footer makes the Apache/BSL boundary explicit.

What the figure is *evidence of* for evaluators:

- **Parametric intent in code**, not a one-shot image of a solid.  
- **Kernel identity** (`OCCT 7.9.3 / occ_c 0.1`) for traceability.  
- **Interactive loop** (edit → Run / Mod-Enter → remesh) suitable for human oversight.  
- **Browser delivery** — no desktop CAD install for the agent surface (infrastructure story for Azure/workstation deployment later).

What it is *not* yet evidence of (stated honestly in §6): assembly mating, 2D drawing intake, FEA convergence automation, or SIAD piping KPIs.

---

## 5. Mapping to challenge objectives

| Challenge objective | Our current footing | Path forward on this stack |
|---------------------|---------------------|----------------------------|
| **1. NL → engineering intent** | Agent writes Luau; LLM can be the author outside the sandbox | Keep NL→Luau outside the kernel; validate with `luau-analyze` + smoke cases |
| **2. Extract constraints from CAD/2D** | Topology/measure hooks in `occ_c` (counts, bbox, volume); STEP/BREP IO | Add constraint IR + drawing/assembly readers; never raw OCCT in the agent |
| **3. Generate parametric compatible CAD** | Primitives, booleans, fillets, transforms via C API; Luau `solid.*` | Grow `occ_c` toward build123d-like algebra; assemblies, holes, datums |
| **4. Mesh / simulation setup** | `occ_mesh_compute` + deflection; demo meshing for visualization | Seed strategies, quality metrics, export to FEA toolchain; convergence loops as agent tools |
| **5. Expert-validable outputs** | Opaque handles, status codes, `occ_last_error`, STEP/mesh artifacts, UI meta | Manifests (script hash, kernel hash, params), review checklist export |

**Responsible AI alignment:** the guest cannot touch the host filesystem or network by default; geometry tools are an allowlist; the expert retains Run/approve in the UI. That is the same *human oversight* posture the challenge requires for industrial review.

**KPI thinking (not yet measured on SIAD data):**

- **KPI1 (effort):** agent+script time vs manual CAD for a fixed component class — our browser loop is designed so timing instrumentation is straightforward.  
- **KPI2 (package size):** requires domain models (skids/piping); geometry kernel is ready for parametric variants once the agent optimizes dimensions under constraints.

---

## 6. Gaps we are not papering over

For a TRL 5–6 industrial PoC against SIAD data, the next technical gaps are larger than UI polish:

1. **2D piping / P&ID intake** — not in tree; will be a separate perception + IR pipeline feeding Luau/params.  
2. **Assembly constraints & mating** — need richer `occ_c` and a constraint language, not more demo solids.  
3. **FEA autonomy** — mesh for display ≠ mesh for structural solvers; coupling to an FEA backend is explicit future work.  
4. **Data governance** — SIAD assets stay under NDA; our open kernel can be developed without their data, then validated on restricted cases.  
5. **Agent quality** — LLM plan quality is orthogonal to kernel correctness; we will evaluate them separately so a bad prompt cannot be confused with a bad BRep.

The architecture is chosen so those gaps plug in **as new tools and IR stages**, not as rewrites of OCCT packaging.

---

## 7. Why this is a credible European manufacturing story

- **Open geometry kernel** (Apache) reduces lock-in for SMEs and partners.  
- **Browser + sandbox** supports secure, deployable agent surfaces (Azure/workstation-friendly).  
- **Parametric scripts** are inspectable artifacts for quality systems — unlike black-box mesh-from-pixels.  
- **AgentOS tooling** already models fuel, tools catalogs, and snapshots — ingredients for long-running agent jobs and reproducible replays.  
- Process is documented and reproducible: pinned OCCT 7.9.3, pinned AgentOS v0.4.0 digests, RBE builds, pure-C `//examples/c_api` as the non-browser oracle.

---

## 8. Suggested application narrative (short)

> We are building an **agentic CAD substrate**, not a single vertical pipeline. The substrate gives agents a **sandboxed Luau computer** and a **trusted OCCT geometry kernel** behind a stable C ABI, available natively and in the browser. A working end-to-end demo already shows parametric solid generation and meshing under human control. On that base we will add constraint extraction from SIAD assemblies and drawings, parametric component generation for piping/skid contexts, and simulation-prep tools — always with expert approval in the loop, matching Challenge 2’s Responsible AI and TRL 5–6 expectations.

---

## 9. Artifacts for reviewers

| Artifact | Location |
|----------|----------|
| Demo screenshot | [`docs/browser-demo.png`](browser-demo.png) |
| C API + Wasm product | repo root `README.md`, `api/include/occ_c.h` |
| Agent runtime (BSL) | `agent-os/` — see its README and `TASKS.md` |
| Kernel validation (pure C) | `//examples/c_api` |
| This process note | `docs/aiboost-agentic-cad.md` |

---

*Document purpose: AI-BOOST Challenge 2 application support. Technical run commands stay in product READMEs; this file records intent, trade-offs, and challenge alignment.*
