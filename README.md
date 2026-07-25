# opencascade-bazel

Bazel build system for [OpenCASCADE Technology](https://github.com/Open-Cascade-SAS/OCCT) (OCCT) 7.9.3 with a multilingual C API wrapper, designed for polyglot usage and WASM compilation targets.

## Overview

This repository provides a Bazel-based build infrastructure for OCCT, enabling reproducible builds and easy integration into larger monorepos. It includes:

- **OCCT 7.9.3** — fetched via `http_archive`, built with a vendored `BUILD` file (`third_party/occt/`)
- **C API** (`api/`) — a C linkage wrapper over OCCT's C++ API, modeled after [build123d](https://github.com/gumyr/build123d)'s public surface, making the library callable from any language with C FFI (Rust, Python, Zig, Go, etc.)
- **C++ examples** — smoke test demonstrating box/cylinder creation, boolean ops, and STEP/STL export
- **WASM-ready** — build configuration is compatible with Emscripten/wasm cross-compilation

## Usage

```bash
bazel build //...
bazel test //...
bazel run //examples/smoke
```

## License

Apache 2.0 — see [LICENSE](LICENSE).

Copyright © 2025 opyt.cloud
