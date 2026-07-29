# opencascade-bazel

Hermetic [Bazel](https://bazel.build/) packaging of [OpenCASCADE Technology](https://github.com/Open-Cascade-SAS/OCCT) (OCCT) **7.9.3**, with a **clean C API** as the primary product.

The goal is not a C++ CAD app. OCCT is C++ under the hood; this repository exists so callers never have to write C++. The public surface is **`occ_c`** — a stable C ABI for polyglot FFI (Rust, Zig, Go, Python, WASM, etc.), shaped after [build123d](https://github.com/gumyr/build123d)'s modeling surface.

## Product: the C API

| Path | Role |
|------|------|
| [`api/include/occ_c.h`](api/include/occ_c.h) | Public C header — **this is the API** |
| [`api/src/occ_c.cc`](api/src/occ_c.cc) | Thin C++ implementation (implementation detail only) |
| [`//api:libocc_c`](api/BUILD.bazel) | Native shared library (`libocc_c.so`) for FFI |
| [`//api:libocc_c_wasm`](api/BUILD.bazel) | Browser / Wasm module (`libocc_c.js` + `.wasm`) via Emscripten |
| [`//examples/c_smoke`](examples/c_smoke/) | Canonical smoke test — **pure C** |

Design notes:

- Opaque handles (`occ_shape_t`, `occ_mesh_t`); caller owns and frees them
- Integer status codes + `occ_last_error()` (thread-local)
- No C++ types, exceptions, or STL in the public header
- Topology indices are **1-based** (OCCT / build123d convention)

## Build

Native (default — fully local, no account). C/C++ is compiled with a **hermetic zig cc** toolchain (`hermetic_cc_toolchain`); no system gcc is required:

```bash
bazel build //...
bazel run //examples/c_smoke
bazel build //api:libocc_c
```

### BuildBuddy remote cache + RBE (opt-in)

Remote builds use the same targets; only the execution venue changes. Config is
`--config=buildbuddy` in [`.bazelrc`](.bazelrc). **No secrets are committed.**

**One-time machine setup** (not automatic — you need a free BuildBuddy account):

1. Create an account at [app.buildbuddy.io](https://app.buildbuddy.io/) (GitHub login is fine; free for individuals / open source).
2. Install the [BuildBuddy CLI](https://www.buildbuddy.io/docs/cli) (`bb`) if needed.
3. From this repo: `bb login` (stores your personal API key in **local** `.git/config`, not in the tree).

Then prefer `bb` over bare `bazel` when you want remote. With `--config=buildbuddy`,
**all compile/link/test actions run on RBE only** (no local spawn fallback); the
laptop only runs Bazel analysis and downloads minimal outputs:

```bash
bb build --config=buildbuddy //api:libocc_c //examples/c_smoke
bb run  --config=buildbuddy //examples/c_smoke
bb build --config=buildbuddy //api:libocc_c_wasm   # heavy; good RBE fit
```

Invocations appear at the `https://app.buildbuddy.io/invocation/...` URL Bazel prints.

**Dashboard extras (only if you want them):**

| Feature | Automatic? | What to do |
|---------|------------|------------|
| BES UI + remote cache + RBE for `bb ... --config=buildbuddy` | After account + `bb login` | No per-repo dashboard wiring |
| CI workflows ([`buildbuddy.yaml`](buildbuddy.yaml)) | **No** | Install BuildBuddy GitHub app on this public repo in the dashboard |
| Org shared cache / multiple users | **No** | Create/join an org and use an org API key if desired |

Public repo does **not** by itself enable RBE. Unauthenticated BES-only uploads are possible without a key, but cache + remote execution require the API key from `bb login`.

### Browser / Wasm

```bash
# Local (slow for full OCCT):
bazel build //api:libocc_c_wasm

# Remote (preferred for the heavy compile):
bb build --config=buildbuddy //api:libocc_c_wasm
```

`//api:libocc_c_wasm` uses `wasm_cc_binary` so the Emscripten toolchain is applied via a configuration transition. Outputs: `libocc_c.js` (MODULARIZE export name `createOccModule`) and `libocc_c.wasm`, with `occ_*` symbols exported for `ccall` / `cwrap`. Tagged `manual` so it is not part of `//...`.

## Layout

```text
api/                  # C API (primary product) + Wasm packaging
examples/c_smoke/     # Pure C end-to-end smoke test
third_party/occt/     # Bazel packaging for a modeling-focused OCCT subset
MODULE.bazel          # Bzlmod; OCCT 7.9.3 + emsdk
buildbuddy.yaml       # Optional BuildBuddy Workflows CI
AGENTS.md             # Conventions for AI agents working in this repo
```

OCCT is fetched at build time (`@occt`); it is not committed. Local clones of upstream trees (`OCCT/`, `OCP/`, `build123d/`) may exist for reference and are gitignored.

## What this is not

- Not a C++ sample project or OCCT tutorial
- Not a full OCCT wrap (no Draw, no OpenGL viewer stack, no full DE formats)
- Not Python/OCP/build123d itself — those may sit as local references only

## License

Apache 2.0 — see [LICENSE](LICENSE).

Linked OCCT remains under its own LGPL-2.1 + exception terms.

Copyright © 2025 opyt.cloud
