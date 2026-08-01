# Portable CAD IR (`cad.ir/v0`)

Apache-friendly schema home for the portable CAD Intermediate Representation.

| Artifact | Path | Role |
|----------|------|------|
| **Design authority** | [`../cad-ir-v0-design.md`](../cad-ir-v0-design.md) | Full system design (envelope, catalog, eval, security, PR plan) |
| **Allowlist / document shape** | [`schema/`](schema/) | Machine-readable Tier A/B op list + envelope notes |
| **Examples** | [`examples/`](examples/) | Dual-goal + box-cut JSON (`*.cad.json`) |
| **Goldens** | [`goldens/`](goldens/) | Measure/frame-only expected fixtures (never absolute shape ids) |
| **Luau runtime** | [`../../agent-os/src/batteries/ir/`](../../agent-os/src/batteries/ir/) | BSL evaluator (`cad.ir.*`) — not required by Apache consumers |

## Schema id

```text
ir_schema: "cad.ir/v0"
```

Breaking envelope / op meaning changes → `cad.ir/v1`. Additive ops keep `cad.ir/v0` and bump `meta.lib_versions.cad_ir`.

## Document envelope (summary)

```text
ModelDocument {
  ir_schema: "cad.ir/v0"     // required
  id?: string
  version: string            // document content semver
  units: { length: "meter", angle: "radian", store: "SI" }
  params: map                // may be {}
  frames?: map               // optional named FramePod seeds
  assembly?: object          // reserved; ignored by v0 eval
  ops: Op[]                  // ordered evaluation list
  results?: object           // eval outputs / golden expects
  meta: object               // pins, hashes, strict, goals
}
```

Full field rules: design §1. Op nodes: design §2. Freestanding selectors only: design §3.

## Tier A ops (v0 demos)

| Op | Host lower | Demo |
|----|------------|------|
| `PrimBox`, `PrimCylinder` | `make_box`, `make_cylinder` | all |
| `BoolCombine` | `fuse` / `cut` / `intersect` | box-cut |
| `Translate`, `Rotate` | `translate`, `rotate` | pipe |
| `RigidXform` | `trsf_apply` | robot |
| `RoutePath` | `make_route` / `make_route_bends` | pipe |
| `SweepAlong` (annulus) | `pipe_annulus` | pipe |
| `AttachFrame` | pure POD (no host) | pipe, robot |
| `ComposeChain` | `compose_chain` | robot |
| `QueryClash`, `QueryGeom` | `clash`/`distance`, `volume`/`bbox` | pipe |
| `ExportMesh` | `mesh` | demos |

Tier B/C and deferred sketch ops: design §4.2–§4.3, §14. **Do not** implement `Sketch2D` / `SolveSketch` here — see [`../sketch-solve-constitution.md`](../sketch-solve-constitution.md).

## Security (design §11)

- IR is **data only** — no executable code, expressions, or embedded Luau.
- Only **allowlisted** IR ops and host lowers run.
- Untrusted IR → `cad.ir.validate` before `eval`.
- Limits: ops count, route nodes, params, ref depth (Appendix B of design).

## Goldens

Assert **measures / frames / TCP**, never absolute guest shape ids (K16). Tolerances: design §9.3.

## Runtime (AgentOS, BSL)

```luau
local ir = require("ir")
local doc = ir.load(json_string)
local res = ir.eval(doc)  -- auto expand → bind → validate
if res.ok then
  ir.run_demo(doc)  -- prints __OCC_CAD_RESULT__ like solid.finish
end
```

See `agent-os/src/batteries/ir/` and `agent-os/smoke/ir_smoke.mjs`.
