# Process decisions log (agentic CAD stack)

Short, dated-style decisions for proposal writing and onboarding. Prefer this over archaeology in chat logs.

## D1 — C ABI is the public product

**Decision:** Ship `occ_c` (opaque handles, status codes, no C++ in the header).  
**Why:** Polyglot FFI, browser Wasm, and agent tools all need a stable boundary. OCP-style class dumps do not.  
**Consequence:** New capability → extend `occ_c` + pure-C exercise first; languages consume the C surface only.

## D2 — AgentOS for scripting, not freestanding Luau (product path)

**Decision:** Use AgentOS **loom** release artifacts + host tools for Luau CAD scripting.  
**Why:** Filesystem, tools broker, analyze, fuel, and browser host already exist; freestanding World rebuilds that for free.  
**Kept:** Freestanding design notes may exist locally for comparison; they are not the product path.

## D3 — OCCT stays Emscripten on the host

**Decision:** Never freestanding-port or wasmi-guest full OCCT.  
**Why:** Exceptions, MEMFS, ~28 MiB optimized Wasm; nested interpretation is a non-starter.  
**Consequence:** Dual Wasm worlds (AgentOS kernel + `libocc_c`) mediated by host tools and shape IDs.

## D4 — License split

**Decision:** Apache-2.0 for kernel/examples; BSL only under `agent-os/`.  
**Why:** Partners can take the kernel without AgentOS; product scripting can still use BSL AgentOS under opyt.cloud terms.

## D5 — RBE-only for agents on the project host

**Decision:** AI agents use `bb --config=buildbuddy` for Bazel compiles; no local `bazel build` as the agent path.  
**Why:** OCCT builds dominate local machines; industrial PoCs similarly need remote or dedicated build infra.

## D6 — Pin AgentOS releases, do not rebuild the monorepo

**Decision:** Consume GitHub release **v0.4.0** digests (`http_file` / fetch script).  
**Why:** Hermetic, reviewable platform version; same posture as SIAD-style controlled environments.

## D7 — Monaco + Luau Monarch (not CM legacy modes)

**Decision:** Editor is Monaco; language is a **Monarch** Luau definition adapted from icebearc/monaco-luau (MIT).  
**Why:** No official Monaco Luau package; built-in Monaco language is Lua-only; CodeMirror “legacy-modes” rejected as product direction.  
**Note:** Monarch is Monaco’s supported tokenizer API — distinct from CodeMirror 5 legacy modes.

## D8 — First green bar before domain depth

**Decision:** Prove Luau → boolean solid → mesh → browser UI before piping/FEA.  
**Why:** Challenge KPIs need a trustworthy generator; untrusted LLM + non-kernel geometry would invalidate later SIAD validation.

## D9 — Human oversight is structural

**Decision:** Guest has no ambient host; UI Run/approve; errors surface without killing the session.  
**Why:** Matches AI-BOOST Responsible AI (expert remains accountable).
