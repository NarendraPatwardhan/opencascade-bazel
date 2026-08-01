# Sketch & Solve Constitution

**Document type:** Binding process law (not a feature wishlist)  
**Audience:** Every human and **every AI agent** (including MAS subagents) working on parametric sketch or geometric constraint solving  
**Status:** Normative — if a plan or PR conflicts with this file, **this file wins**  
**Date:** 2026-08-01  
**Design authority (what to build):** [`cleanroom-solvespace-sketch-solve-report.md`](cleanroom-solvespace-sketch-solve-report.md)  
**How to code Apache C:** [`../AGENTS.md`](../AGENTS.md)  
**Product north star:** [`../SYSTEM.md`](../SYSTEM.md)

---

## 0. One sentence

> Build the sketch and constraint solver **one sealed capability at a time**, to an **exceptional algorithmic bar**, and **do not start the next capability** until the current one is proven perfect under automated gates — even if MAS can do many things in parallel.

---

## 1. Why this constitution exists

### 1.1 Two modes of work in this repo

| Mode | Applies to | Style | Law |
|------|------------|-------|-----|
| **Wide kernel façade** | Most of `occ_c` over OCCT (prims, booleans, pipe, patterns, …) | Ship thin wrappers; iterate; grow surface | Expand C surface, keep thin, smoke demos |
| **Deep solver** | Sketch graph, residuals, Newton/DOF, SolveSketch | **Depth-first perfection** | **This constitution** |

OCCT already supplies solid algorithms. Wrapping them is mostly API design.  
A geometric constraint solver is **our** mathematics. Shallow or buggy solve is worse than no solve: agents will trust DOF and dimensions that are wrong.

Therefore: **do not treat sketch/solve like another `occ_*` module to “cover the matrix.”**

### 1.2 Explicit rejection of wide-first sketch work

**Forbidden for sketch/solve:**

- Implementing many constraint types “stubbed” or “mostly works”
- Landing a fat API surface without golden residual/DOF tests
- Parallel MAS agents each implementing a different constraint family in the same wave
- “We’ll tighten numerics later”
- Expanding Phase 1 catalog while MVP-A1 has open quality debts
- Copying SolveSpace / `libslvs` structure, constants, or status ordinals (GPLv3+)

**Required instead:** one **Active Slice**, full depth, gate green, then advance.

---

## 2. Hierarchy of authority

When documents conflict, higher wins:

1. **This constitution** (process + quality gates for sketch/solve)  
2. **License / Apache boundary** ([`AGENTS.md`](../AGENTS.md) · [`SYSTEM.md`](../SYSTEM.md) §10)  
3. **Clean-room sketch report** (capability design, residual *geometry*, MVP vs P0)  
4. **FS clean-room report** (solids only; A1 is a gap id)  
5. Local agent plans, TODOs, “user said go faster”

Capability *names* and residual *meaning* come from the clean-room report.  
*When* and *how thoroughly* to implement them come from **this constitution**.

---

## 3. Active Slice law (the core rule)

### 3.1 Definition

An **Active Slice** is exactly one named unit of solver work, recorded in §11 of this file (update when the slice advances).

Examples of valid slices (ordered; do not skip ahead):

| Order | Slice id | Intent |
|------:|----------|--------|
| 0 | `S0-scaffold` | Build graph + params + solve entry; no product constraints yet |
| 1 | `S1-pin` | Hard pin / freeze UV of points (kill rigid motion with anchors) |
| 2 | `S2-distance` | Point–point distance (and dimension seeding) |
| 3 | `S3-hv` | Horizontal / vertical (workplane) |
| 4 | `S4-coincident` | Point coincident (with substitution or equivalent) |
| 5 | `S5-rect-mvp` | Closed rectangle recipe fully constrained + DOF=0 proof |
| 6 | `S6-circle-diameter` | Circle + diameter/radius |
| … | … | Only as listed when previous slice is **Sealed** |

Slices after `S5` must be added to §11 by an explicit human or constitution update — agents must not invent a free-for-all backlog mid-flight.

### 3.2 Only one Active Slice

- Exactly **one** Active Slice at a time.  
- Status is one of: `planned` → `in_progress` → `sealed` (or `abandoned` with written reason).  
- **Sealed** means §5 quality bar is met and recorded.  
- Starting slice \(N+1\) while slice \(N\) is not sealed is a **constitution violation**.

### 3.3 What “done” means

A slice is not done when “the happy path runs.”  
A slice is done when it is **Sealed** under §5.

---

## 4. Depth over width (implementation rules)

1. **No forward APIs.** Do not add public symbols for constraints or entities outside the Active Slice (except temporary `internal` test hooks, never Wasm-exported).  
2. **No partial catalogs.** Prefer one residual family correct in all edge cases over five families that pass one demo.  
3. **Tests before breadth.** Golden and property tests for the Active Slice land in the same change set as the code (or immediately before), never “tests in a follow-up.”  
4. **Numerics are product.** Residual scaling, convergence, rank/DOF, and failure modes are first-class — not polish.  
5. **Clean-room.** Implement from the clean-room report + this constitution + OCCT for profile harvest only. **No** SolveSpace sources open while coding.  
6. **License.** No `libslvs` link, embed, Wasm import, or co-ship with Apache artifacts.  
7. **Demo independence.** Dual-goal smokes (`smoke_pipe_skid`, `smoke_robot_6dof`, flange, session) must remain green on **ExplicitCoords** paths. Sketch work must not regress them.  
8. **Thin C boundary.** Public C stays boring: opaque sketch handle, status, out-params. Solver guts stay C++ behind the boundary (or a dedicated lib), with teaching comments — not a second public C++ API.

---

## 5. Exceptional quality bar (Seal criteria)

A slice may be marked **Sealed** only when **all** of the following hold.

### 5.1 Correctness

| Gate | Requirement |
|------|-------------|
| **Residual geometry** | Matches the clean-room Appendix residual *meaning* for types in this slice (our algebra, our constants). |
| **DOF** | Reported \(\mathrm{dof} = n_{\mathrm{free}} - \mathrm{rank}(J)\) is correct on under-, well-, and over-constrained fixtures for this slice. |
| **Convergence** | Well-posed fixtures converge reliably from documented seeds (including dimension-from-geometry seeding where applicable). |
| **Failure modes** | Conflict / no-converge / size limit produce stable statuses and non-empty `occ_last_error()` (or sketch-local error string) — no silent wrong geometry. |
| **Idempotence** | Re-solve of an already solved well-constrained system does not drift beyond tolerance. |
| **Units** | Meters (model SI) for lengths; angles policy documented (prefer radians internal). |

### 5.2 Evidence (automated)

| Gate | Requirement |
|------|-------------|
| **Golden fixtures** | Checked-in cases with expected DOF, key coordinates, and status (table or JSON). |
| **Property / random** | At least one randomized or perturbed-seed test family for this slice (basin of attraction, not only one start point). |
| **Regression** | `bb` / BuildBuddy tests for the sketch target(s) pass; full dual-goal smoke still pass. |
| **No known P0 bugs** | No open “we know DOF is wrong when…” for this slice. |

### 5.3 Engineering quality

| Gate | Requirement |
|------|-------------|
| **Complexity** | Implementation is reviewable; no copy-paste of GPL; no mysterious magic numbers without comments. |
| **API honesty** | Public symbols introduced for this slice are documented in the header with teaching comments. |
| **Exports** | If `OCC_API` is added, exports script/BUILD stay in sync. |
| **Benchmark (soft)** | Optional: microbench for solve time on the golden set — track regressions once S5 is sealed. |

### 5.4 Seal record

When sealing, update §11:

- Slice id → `sealed`  
- Date  
- Test target names  
- One-paragraph “what is now trusted”

Agents must not claim Seal without that record.

---

## 6. Multi-agent system (MAS) under this constitution

MAS is for **throughput inside the Active Slice**, not for **width across slices**.

### 6.1 Allowed parallel work (same Active Slice)

| Role | Example |
|------|---------|
| Implementer | Residual + solve path for the slice |
| Test author | Golden + property fixtures |
| Numerics reviewer | Conditioning, rank, tolerances (read or patch same slice) |
| Doc/header teacher | In-code comments for symbols introduced this slice |
| Adversary | Try to break the slice; file failing cases as tests |

Up to **four** agents may run in parallel **only** if every agent’s scope is the **same Active Slice id**.

### 6.2 Forbidden parallel work

- Agent A implements distance while Agent B implements tangent  
- “Implement all MVP constraints this sprint” fan-out  
- Parallel PRs that each touch different constraint enums without a single sealed predecessor  
- One agent opens SolveSpace sources while another implements (clean-room split broken)

### 6.3 MAS orchestration rules

1. **Prompt every subagent** with: Active Slice id, this constitution path, clean-room report path, and “do not implement other slices.”  
2. **Merge order:** tests and core math before cosmetic API sugar.  
3. **Critique pass required** before Seal: at least one agent (or human) acts as adversary on the slice.  
4. **Conflict:** if two agents disagree on residual meaning, stop and align to clean-room Appendix B — do not “both land.”  
5. **Stop condition:** when Seal criteria are met, end the wave; do not “use remaining budget” to start the next slice.

### 6.4 What agents say when asked to go faster

If asked to add more constraints or “finish sketch”:

> Per `docs/sketch-solve-constitution.md`, only Active Slice **\<id\>** may advance; width is forbidden until it is Sealed.

---

## 7. Relationship to ExplicitCoords and product demos

| Track | Owner | Blocked on solver? |
|-------|--------|---------------------|
| Pipe skid / robot / flange smokes | ExplicitCoords + existing `occ_c` | **No** |
| Parametric re-dimension of profiles | SolveSketch slices | Yes, slice-by-slice |
| Agent authoring | Prefer ExplicitCoords until S5+ sealed | Prefer not |

Solver work **must not** hold dual-goal demos hostage.  
Product may keep shipping recipes that never call SolveSketch until Sealed slices justify it.

---

## 8. Placement of code (when implementation starts)

Binding defaults (adjust only by constitution amendment):

| Piece | Location |
|-------|----------|
| Public C (when a slice needs it) | `api/include/occ_c_sketch.h` (or staged name) + `api/src/` — Apache |
| Solver core | Implementation detail behind C; no public C++ CAD API |
| Tests | Pure C or `cc_test` using only public C headers |
| GPL oracle | **Forbidden** in Apache graph; optional out-of-process research only, never CI gate for Seal |

Do not create a second solid kernel. Profile harvest after solve uses existing construct / face / extrude APIs.

---

## 9. Amendment process

1. Human owner (or explicit user instruction) updates this file.  
2. Active Slice table (§11) changes only when sealing or selecting the next slice.  
3. Agents may **propose** amendments in chat; they may **not** silently weaken the quality bar or mark Seal without evidence.  
4. Weakening §5 requires an explicit rationale in the change log (§12).

---

## 10. Anti-patterns (instant reject)

1. “Add all P0 constraints, tests later.”  
2. “Stub `occ_sketch_solve` returning OK without residuals.”  
3. “DOF is approximate.”  
4. “Matches SolveSpace bit-for-bit” as a goal.  
5. Linking or vendoring SolveSpace into `api/`.  
6. Expanding Wasm exports for unfinished sketch surface.  
7. MAS fan-out across constraint families.  
8. Marking Sealed because a single demo rectangle looked right.  
9. Mixing assembly mate solver work into sketch slices.  
10. Using sketch work as an excuse to skip dual-goal smoke green.

---

## 11. Active Slice board (living)

Update this section in the same commit that starts or seals a slice.

| Field | Value |
|-------|--------|
| **Active Slice** | `S0-scaffold` |
| **Status** | `planned` |
| **Goal** | Project layout + param vector + empty solve entry + test harness; **no** user constraints yet |
| **In scope** | Build system, sketch handle lifecycle, error channel, fixture runner |
| **Out of scope** | Any geometric constraint, any DOF claim beyond “empty system” |
| **Seal evidence** | *(none yet)* |
| **Next (only after Seal)** | `S1-pin` |

**History**

| Slice | Sealed | Evidence |
|-------|--------|----------|
| — | — | — |

---

## 12. Change log

| Date | Change |
|------|--------|
| 2026-08-01 | Initial constitution: depth-first Active Slice law, exceptional Seal bar, MAS parallel rules, S0 planned |

---

## 13. Ultra-short card (pin this)

```text
SKETCH/SOLVE CONSTITUTION
• One Active Slice only — depth, not width
• Exceptional algorithmic bar before Seal
• MAS parallels work inside the slice, never across slices
• No SolveSpace code; no libslvs
• Dual-goal demos stay on ExplicitCoords
• Authority: docs/sketch-solve-constitution.md
```
