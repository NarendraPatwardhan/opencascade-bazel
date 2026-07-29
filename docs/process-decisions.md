# Design decisions

Short record of structural choices. Prefer this over digging through chat history.

## D1 — C ABI is the public product

**Decision:** Ship `occ_c` (opaque handles, status codes, no C++ in the header).  
**Why:** Polyglot FFI, browser Wasm, and host tools need a stable boundary. Full OCCT class graphs do not.  
**Consequence:** New capability → extend `occ_c` and exercise it in pure C first.

## D2 — AgentOS for scripting

**Decision:** Use AgentOS **loom** release artifacts and host tools for Luau CAD scripting.  
**Why:** Filesystem, tools broker, analyze, and fuel already exist; a freestanding Luau World would rebuild them.  
**Note:** Freestanding designs may exist as notes; they are not the product path.

## D3 — OCCT stays on the Emscripten host

**Decision:** Do not freestanding-port or run full OCCT under wasmi as an AgentOS guest.  
**Why:** Exceptions, MEMFS, large binary; nested interpretation is not viable.  
**Consequence:** Two Wasm modules (AgentOS kernel + `libocc_c`) joined by host tools and shape IDs.

## D4 — License split

**Decision:** Apache-2.0 for kernel and examples; BSL only under `agent-os/`.  
**Why:** Kernel consumers need not take AgentOS; scripting product can still use it.

## D5 — Remote builds for heavy work on constrained hosts

**Decision:** Prefer BuildBuddy RBE (`bb --config=buildbuddy`) for OCCT/Wasm compiles when the machine is not a build rig.  
**Why:** Full toolkit links dominate small laptops; end users with stronger machines can still use bare `bazel`.

## D6 — Pin AgentOS releases

**Decision:** Consume GitHub release **v0.4.0** by digest (`http_file` / fetch script); do not rebuild AgentOS in this repo.  
**Why:** Hermetic, reviewable platform version.

## D7 — Monaco + Luau Monarch

**Decision:** Editor is Monaco; language is a Monarch Luau definition adapted from icebearc/monaco-luau (MIT).  
**Why:** No first-party Monaco Luau package; built-in language is Lua-only. Monarch is Monaco’s supported tokenizer API (not CodeMirror legacy modes).

## D8 — Prove the bridge before domain depth

**Decision:** Ship Luau → boolean solid → mesh → browser UI before assemblies, drawings, or FEA.  
**Why:** Later automation is worthless if the geometry path is not real BRep under a sandbox.

## D9 — Oversight is structural

**Decision:** Guest has no ambient host access; UI owns Run; errors do not take down the page.  
**Why:** Untrusted scripts and planners must not share the host’s authority.
