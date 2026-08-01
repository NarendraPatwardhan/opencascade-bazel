# Document shape notes (`cad.ir/v0`)

Authoritative detail: [`../../cad-ir-v0-design.md`](../../cad-ir-v0-design.md) §1–§5.
Machine-readable allowlist: [`allowlist.json`](allowlist.json).

## Op node

```json
{
  "id": "housing",
  "op": "PrimBox",
  "params": { "dx": 0.1, "dy": 0.1, "dz": 0.1 },
  "refs": {},
  "deps": [],
  "meta": {}
}
```

| Field | Required | Rules |
|-------|----------|-------|
| `id` | yes | Unique; `[A-Za-z_][A-Za-z0-9_./-]*` |
| `op` | yes | Allowlisted string (Tier A/B registered) |
| `params` | yes | May be `{}`; literals or `{ "param": "name" }` only |
| `refs` | no | Freestanding selectors only (see design §3) |
| `deps` | no | Must appear **earlier** in `ops` (no reorder) |
| `meta` | no | Free tags |

## Param refs (no expressions)

```json
{ "param": "pipe_od" }
```

Forbidden: `{ "expr": "…" }`, Luau snippets, free code.

## Units

Always SI store: lengths in **meters**, angles in **radians**. Reject `length: "mm"` as store.

## Versioning

| Identifier | When it changes |
|------------|-----------------|
| `ir_schema` | Breaking envelope / op meaning → `cad.ir/v1` |
| `meta.lib_versions.cad_ir` | Additive ops, optional fields, handler fixes |

## Hash form (K18)

`cad.ir.canonical_json` uses **strict lexicographic** key sort at every object level, compact JSON. Pretty on-disk examples may use human key order — hash goldens always use canonical form.
