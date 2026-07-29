# Agent guide — opencascade-bazel

Instructions for AI coding agents working in this repository. Prefer this file over assumptions from the directory name or from OCCT/OCP/build123d trees on disk.

## Mission

**Ship a clean, stable C API over a hermetic Bazel build of OCCT.**

- The product is **`occ_c`**: [`api/include/occ_c.h`](api/include/occ_c.h) and [`//api:libocc_c`](api/BUILD.bazel).
- Callers should use **C only** (or language FFI to that C ABI). They should not need C++.
- C++ exists only as an implementation detail of the wrapper and of OCCT itself.

### Explicit non-goals

- Do **not** expand the project into a C++ application or sample suite.
- Do **not** treat raw OCCT C++ as a public API of this repo.
- Do **not** add new C++ examples for end users.
- Do **not** depend on Python, OCP, or build123d in the Bazel graph.

## Priority of artifacts

| Priority | Path | Notes |
|----------|------|--------|
| P0 | `api/include/occ_c.h` | Contract. Design for long-lived FFI. |
| P0 | `api/src/occ_c.cc` | Implementation of that contract. Keep thin. |
| P0 | `examples/c_smoke/` | Canonical validation path — **pure C**. |
| P0 | `//api:libocc_c_wasm` | Browser product: Emscripten JS+Wasm over `occ_c`. |
| P1 | `third_party/occt/gen_bazel.py` | Source of truth for the OCCT toolkit subset. |
| P1 | `third_party/occt/occt.BUILD` | Generated; regenerate via the script, do not hand-edit. |
| Ref only | `OCCT/`, `OCP/`, `build123d/` | Gitignored local clones. Reference/research only. Not build inputs. |

## C API conventions

When adding or changing API:

1. **Header is pure C.** No C++ keywords, classes, templates, or STL in `occ_c.h`. Guard with `extern "C"` only for C++ inclusion of the header.
2. **Opaque handles** for all OCCT objects (`typedef struct occ_*_s* occ_*_t`). No `TopoDS_*` or `Handle(...)` in the public surface.
3. **Return `int` status** (`occ_status_t` / `OCC_OK` / `OCC_ERR_*`). Put outputs in out-parameters (`occ_shape_t* out`, `double* out`, buffers).
4. **Ownership:** functions that return a new shape/mesh transfer ownership to the caller. Document and free with `occ_shape_free` / `occ_mesh_free`. Prefer copy-on-output; do not alias caller handles.
5. **Errors:** catch OCCT/`std` exceptions at the boundary; set the thread-local string via the existing pattern; expose with `occ_last_error()`.
6. **Symbols:** export with `OCC_API`; project-wide `-fvisibility=hidden` means unmarked symbols stay private.
7. **Indices:** topology indices are **1-based** (match OCCT / build123d).
8. **Surface inspiration:** build123d’s public modeling ops (primitives, booleans, fillet/chamfer, sweeps, transforms, measure, STEP/BREP/STL, mesh) — not a 1:1 dump of OCCT classes.
9. **Implementation stays thin:** `occ_c.cc` should map C args → one or a few OCCT calls → C results. No policy engines, UI, or Python-style DSLs in C++.

### Prefer growing the C surface, not bypassing it

- New capability for consumers → add to `occ_c.h` + `occ_c.cc` + exercise in **C** (`c_smoke` or a new pure-C example/test).
- Do not solve user problems by documenting “call `BRepPrimAPI_MakeBox` from C++”.
- When adding `OCC_API` symbols, also update `_OCC_C_EXPORTS` in [`api/BUILD.bazel`](api/BUILD.bazel) so Wasm exports stay in sync.

## OCCT packaging

- OCCT version is pinned in [`MODULE.bazel`](MODULE.bazel) (currently **7.9.3** via `http_archive`).
- Toolkit subset lives in `SUBSET` inside [`third_party/occt/gen_bazel.py`](third_party/occt/gen_bazel.py).
- Regenerate after changing the subset or upgrading OCCT sources:

  ```bash
  python3 third_party/occt/gen_bazel.py /path/to/OCCT-src > third_party/occt/occt.BUILD
  ```

- Keep the subset **modeling + needed data exchange** (BRep, booleans, fillet, STEP/STL/mesh, minimal XCAF). Avoid reintroducing Draw, OpenGL viewers, fonts, TBB, etc. unless the C API truly needs them.
- Optional third parties are off by omitting `HAVE_*` defines. Do not casually enable RapidJSON/FreeType/GL without wiring Bazel deps and documenting the impact.
- Vendored CMake-generated headers live under `third_party/occt/generated/` (e.g. `Standard_Version.hxx`). Do not require a CMake configure step for the normal build.
- Host system libs (`-lpthread`, `-lrt`, `-ldl`) in toolkit `linkopts` must stay gated with `select` on `@platforms//os:emscripten` (see `gen_bazel.py`). Unconditional host libs break Wasm links.

## Examples and tests

- **Canonical:** `bazel run //examples/c_smoke` — pure C against `//api:occ_c_lib`.
- Prefer new validation as pure C (or later `cc_test` that still only includes `occ_c.h`).
- There is **no** C++ example target; do not reintroduce one.

## Build commands

Local (default):

```bash
bazel build //...
bazel build //api:libocc_c
bazel run //examples/c_smoke
```

Remote (BuildBuddy RBE + cache + BES) — opt-in, any target:

```bash
# One-time per machine/repo if not already authenticated:
bb login

bb build --config=buildbuddy //api:libocc_c //examples/c_smoke
bb run  --config=buildbuddy //examples/c_smoke
bb build --config=buildbuddy //api:libocc_c_wasm
```

- Prefer **`bb`** (not bare `bazel`) whenever `--config=buildbuddy` is set so the API key is attached.
- Never commit API keys or put them in `.bazelrc`.
- `buildbuddy.yaml` is optional CI; it only runs after the BuildBuddy GitHub app is connected to the repo in the dashboard. Local remote builds do not need that.
- `--config=buildbuddy` is **remote-only** for spawns (`spawn_strategy=remote`, `local_cpu_resources=0`, no local fallback). The Bazel process still analyzes on the coordinator; compiles/links/tests must execute on RBE.
- RBE throughput knobs: `--jobs`, `EstimatedCPU`/`EstimatedMemory`/`EstimatedFreeDiskBytes`. If many actions sit queued with few **running**, raise the org’s concurrent RBE allocation in the BuildBuddy dashboard.

Bazel version: see `.bazelversion`. C++17, `-fPIC`, hidden visibility, BuildBuddy flags — see `.bazelrc`.

## C/C++ and Wasm toolchains

| Path | Toolchain | Module |
|------|-----------|--------|
| Native `//api`, `@occt`, `//examples/c_smoke` | **zig cc** via `hermetic_cc_toolchain` | `hermetic_cc_toolchain` in `MODULE.bazel` |
| Browser `//api:libocc_c_wasm` | **emcc** via `wasm_cc_binary` | `emsdk` in `MODULE.bazel` |

- Host gcc/clang auto-detect is **disabled** (`BAZEL_DO_NOT_DETECT_CPP_TOOLCHAIN=1`).
- Do **not** use `rules_zig` for the C toolchain — that is for Zig language code. Hermetic C++ is `hermetic_cc_toolchain` only.
- Do **not** hand-roll an emscripten `cc_toolchain`; keep `@emsdk`.

## Language bindings / WASM

- Bindings (Rust, Zig, Go, Python, browser) must consume **`occ_c`**, not OCCT headers.
  - Native: `//api:libocc_c` (`libocc_c.so`)
  - Browser: `//api:libocc_c_wasm` (`libocc_c.js` + `libocc_c.wasm`)
- Use `wasm_cc_binary` from `@emsdk//emscripten_toolchain:wasm_rules.bzl` so deps transition to the Wasm platform.
- Keep the ABI C-friendly: POD args, opaque pointers, no exceptions across the FFI boundary (already translated inside `occ_c.cc`).
- Wasm link policy lives on `//api:libocc_c_wasm_bin` (`MODULARIZE`, `EXPORT_NAME`, `EXPORTED_FUNCTIONS`, exception catching, FS). Adjust there, not in OCCT sources.

## Documentation hygiene

- [`README.md`](README.md) is user-facing and C-API-first.
- This file is agent-facing: architecture, constraints, and anti-patterns.
- Do not re-document full OCCT here. Link upstream when needed.
- Ignore gitignored trees (`OCCT/`, `OCP/`, `build123d/`) when describing “the repo” unless the task is explicitly about regenerating packaging or studying reference APIs.

## Anti-patterns (do not do)

1. Adding public C++ headers or “dual” C++ APIs for consumers.
2. Reintroducing C++ example binaries as product surface.
3. Hand-editing large sections of `occt.BUILD` instead of regenerating.
4. Pulling OCP/build123d into Bazel “to get more API.”
5. Exposing OCCT types through the C header “just this once.”
6. Expanding the OCCT toolkit subset for curiosity rather than a concrete `occ_*` feature.
7. Replacing `@emsdk` with a home-grown Emscripten toolchain without a hard requirement.
8. Committing BuildBuddy API keys or hard-coding auth into `.bazelrc`.

## When unsure

Default to: **extend `occ_c.h`, implement in `occ_c.cc`, prove with pure C.**  
If something cannot be expressed cleanly in C, redesign the API shape — do not push callers into C++.
