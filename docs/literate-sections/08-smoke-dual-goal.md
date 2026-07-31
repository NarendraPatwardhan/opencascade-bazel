# Section 08 — Dual-Goal Smoke Programs (pure C)

**Document type:** Literate extractable sources for `occ_c` dual-goal validation  
**OCCT pin:** 7.9.3 · **API:** expanded P0 (`occ_c.h`, `occ_c_frames.h`, `occ_c_route.h`)  
**Goals:** AI-BOOST piping skids · 6-DOF robot arm · flange bolt-circle recipe  
**Units:** meters, radians  
**Marker:** first line of a fence is `// === file: PATH` (C) or `# === file: PATH` (Python/Starlark)

| Program | Goal | IR ops |
|---------|------|--------|
| `smoke_pipe_skid.c` | pipe skid | `PrimBox`, `AttachFrame`, `RoutePath`, `SweepAlong`, `PatternLinear`, `QueryClash` |
| `smoke_robot_6dof.c` | 6-DOF arm | `PrimCylinder`/`PrimBox`, `AttachFrame`, `ComposeChain`, `RigidXform`, `QueryClash` |
| `smoke_flange_bolt_circle.c` | hole+pattern | `PrimCylinder`, `DrillHole`, `PatternPolar` |

Also: `scripts/extract_literate.py`, Bazel fragment for the three smokes.

```bash
python3 scripts/extract_literate.py docs/literate-sections/08-smoke-dual-goal.md --root .
bazel test //examples:smoke_pipe_skid_test //examples:smoke_robot_6dof_test //examples:smoke_flange_bolt_circle_test
```

---

## 1. Pipe skid — `examples/smoke_pipe_skid.c`

Skid ~3 m × 1.5 m base, two equipment proxies, 4″ NPS annulus (`OD=0.1143`, `ID=0.1023`),
150 mm bends, linear clamp pattern, clash + mass.

```c
// === file: examples/smoke_pipe_skid.c
/*
 * smoke_pipe_skid.c — AI-BOOST piping skid dual-goal smoke (pure C / occ_c)
 *
 * Call sequence (IR → C):
 *   PrimBox        → occ_make_box / occ_translate
 *   AttachFrame    → occ_frame_from_axes
 *   RoutePath      → occ_make_route_with_bends
 *   SweepAlong     → occ_pipe_annulus
 *   PatternLinear  → occ_pattern_linear
 *   QueryClash     → occ_clash / occ_distance
 *   mass           → occ_mass_properties
 *
 * Exit 0 on success; non-zero + stderr on failure. Units: m, rad. OCCT 7.9.3.
 */
#include "occ_c.h"
#include "occ_c_frames.h"
#include "occ_c_route.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { SKID_OK = 0, SKID_FAIL = 1 };

static const double kSteelDensity = 7850.0;
static const double kPipeOD       = 0.1143;  /* 4" NPS OD */
static const double kPipeID       = 0.1023;
static const double kBendRadius   = 0.150;
static const double kClearance    = 0.025;   /* 25 mm */
static const int    kClampCount   = 5;
static const double kClampPitch   = 0.60;

static void die(const char* step, int st) {
  fprintf(stderr, "[smoke_pipe_skid] FAIL %s: status=%d err=%s\n",
          step, st, occ_last_error() ? occ_last_error() : "(null)");
}

static void free_shape(occ_shape_t* s) {
  if (s && *s) { occ_shape_free(*s); *s = 0; }
}

static void print_frame(const char* name, const occ_frame_t* f) {
  printf("  frame %-10s o=(%.4f,%.4f,%.4f) z=(%.3f,%.3f,%.3f)\n",
         name, f->origin[0], f->origin[1], f->origin[2],
         f->z_axis[0], f->z_axis[1], f->z_axis[2]);
}

/* ---- Step 1: PrimBox skid base 3.0 x 1.5 x 0.10 m, centered on XY ---- */
static int build_base(occ_shape_t* out_base) {
  occ_shape_t raw = 0, centered = 0;
  int st = occ_make_box(3.0, 1.5, 0.10, &raw);
  if (st != OCC_OK) { die("PrimBox base", st); return SKID_FAIL; }
  st = occ_translate(raw, -1.5, -0.75, 0.0, &centered);
  free_shape(&raw);
  if (st != OCC_OK) { die("translate base", st); return SKID_FAIL; }
  *out_base = centered;
  printf("[1] PrimBox skid base 3.0 x 1.5 x 0.10 m\n");
  return SKID_OK;
}

/* ---- Step 2: PrimBox equipment + AttachFrame nozzle frames ---- */
static int build_equipment(occ_shape_t* out_a, occ_shape_t* out_b,
                           occ_frame_t* na, occ_frame_t* nb) {
  int st;
  {
    occ_shape_t box = 0, placed = 0;
    st = occ_make_box(0.80, 0.60, 0.90, &box);
    if (st != OCC_OK) { die("PrimBox eqA", st); return SKID_FAIL; }
    st = occ_translate(box, -1.30, -0.30, 0.10, &placed);
    free_shape(&box);
    if (st != OCC_OK) { die("translate eqA", st); return SKID_FAIL; }
    *out_a = placed;
  }
  /* Nozzle A: east face, pipe departs +X. local X = up, Z = pipe dir. */
  st = occ_frame_from_axes(-0.50, 0.0, 0.55,
                           0.0, 0.0, 1.0,
                           1.0, 0.0, 0.0, na);
  if (st != OCC_OK) { die("AttachFrame nozzleA", st); return SKID_FAIL; }

  {
    occ_shape_t box = 0, placed = 0;
    st = occ_make_box(1.00, 0.70, 1.10, &box);
    if (st != OCC_OK) { die("PrimBox eqB", st); return SKID_FAIL; }
    st = occ_translate(box, 0.80, 0.10, 0.10, &placed);
    free_shape(&box);
    if (st != OCC_OK) { die("translate eqB", st); return SKID_FAIL; }
    *out_b = placed;
  }
  /* Nozzle B: west face, pipe arrives -X into equipment. */
  st = occ_frame_from_axes(0.80, 0.40, 0.70,
                           0.0, 0.0, 1.0,
                          -1.0, 0.0, 0.0, nb);
  if (st != OCC_OK) { die("AttachFrame nozzleB", st); return SKID_FAIL; }

  printf("[2] PrimBox equipment A/B + AttachFrame nozzles\n");
  print_frame("nozzleA", na);
  print_frame("nozzleB", nb);
  return SKID_OK;
}

/* ---- Step 3: RoutePath with bends between nozzles ---- */
static int build_route(const occ_frame_t* na, const occ_frame_t* nb,
                       occ_shape_t* out_path, double* out_len) {
  double nodes[] = {
    na->origin[0],           na->origin[1], na->origin[2],
    na->origin[0] + 0.35,    na->origin[1], na->origin[2],
    na->origin[0] + 0.35,    na->origin[1], 1.20,
    nb->origin[0] - 0.45,    na->origin[1], 1.20,
    nb->origin[0] - 0.45,    nb->origin[1], 1.20,
    nb->origin[0] - 0.45,    nb->origin[1], nb->origin[2],
    nb->origin[0],           nb->origin[1], nb->origin[2]
  };
  const int n_pts = (int)(sizeof(nodes) / sizeof(nodes[0]) / 3);

  int st = occ_make_route_with_bends(nodes, n_pts, kBendRadius, out_path);
  if (st != OCC_OK) { die("RoutePath", st); return SKID_FAIL; }

  *out_len = 0.0;
  st = occ_wire_length(*out_path, out_len);
  if (st != OCC_OK) { die("wire_length", st); return SKID_FAIL; }

  double o0[3], t0[3], o1[3], t1[3];
  if (occ_frame_at_wire_end(*out_path, 1, o0, t0) == OCC_OK)
    printf("  start o=(%.3f,%.3f,%.3f) t=(%.3f,%.3f,%.3f)\n",
           o0[0], o0[1], o0[2], t0[0], t0[1], t0[2]);
  if (occ_frame_at_wire_end(*out_path, 0, o1, t1) == OCC_OK)
    printf("  end   o=(%.3f,%.3f,%.3f) t=(%.3f,%.3f,%.3f)\n",
           o1[0], o1[1], o1[2], t1[0], t1[1], t1[2]);

  printf("[3] RoutePath n=%d bendR=%.3f m length=%.4f m\n",
         n_pts, kBendRadius, *out_len);
  return SKID_OK;
}

/* ---- Step 4: SweepAlong annulus pipe ---- */
static int build_pipe(occ_shape_t path, occ_shape_t* out_pipe) {
  int st = occ_pipe_annulus(kPipeOD, kPipeID, path, out_pipe);
  if (st != OCC_OK) { die("SweepAlong pipe_annulus", st); return SKID_FAIL; }
  printf("[4] SweepAlong annulus OD=%.4f ID=%.4f m\n", kPipeOD, kPipeID);
  return SKID_OK;
}

/* ---- Step 5: PatternLinear support clamps (boxes under header) ---- */
static int build_clamps(occ_shape_t* out_clamps) {
  occ_shape_t seed = 0, seed_at = 0;
  int st = occ_make_box(0.12, 0.18, 0.06, &seed);
  if (st != OCC_OK) { die("PrimBox clamp seed", st); return SKID_FAIL; }
  st = occ_translate(seed, -0.20, -0.09, 1.20 - 0.06 - kPipeOD * 0.5, &seed_at);
  free_shape(&seed);
  if (st != OCC_OK) { die("translate clamp", st); return SKID_FAIL; }

  st = occ_pattern_linear(seed_at, kClampPitch, 0.0, 0.0,
                          kClampCount, /*fuse=*/0, out_clamps);
  free_shape(&seed_at);
  if (st != OCC_OK) { die("PatternLinear clamps", st); return SKID_FAIL; }
  printf("[5] PatternLinear clamps count=%d pitch=%.2f m\n",
         kClampCount, kClampPitch);
  return SKID_OK;
}

/* ---- Step 6: QueryClash pipe vs equipment ---- */
static int check_clashes(occ_shape_t pipe, occ_shape_t eq_a, occ_shape_t eq_b,
                         int* out_any_hit) {
  int st_a = 2, st_b = 2;
  int rc = occ_clash(pipe, eq_a, kClearance, &st_a);
  if (rc != OCC_OK) { die("QueryClash eqA", rc); return SKID_FAIL; }
  rc = occ_clash(pipe, eq_b, kClearance, &st_b);
  if (rc != OCC_OK) { die("QueryClash eqB", rc); return SKID_FAIL; }

  double d = -1.0, p1[3] = {0}, p2[3] = {0};
  if (occ_distance(pipe, eq_a, &d, p1, p2) == OCC_OK)
    printf("  dist(pipe,eqA)=%.4f m\n", d);
  if (occ_distance(pipe, eq_b, &d, p1, p2) == OCC_OK)
    printf("  dist(pipe,eqB)=%.4f m\n", d);

  /* status: 0=clear 1=hit/within-clearance 2=unknown */
  printf("[6] QueryClash clearance=%.3f m eqA=%d eqB=%d\n",
         kClearance, st_a, st_b);
  *out_any_hit = (st_a == 1 || st_b == 1) ? 1 : 0;
  if (st_a == 2 && st_b == 2) {
    fprintf(stderr, "[smoke_pipe_skid] both clash results unknown\n");
    return SKID_FAIL;
  }
  return SKID_OK;
}

/* ---- Step 7: mass properties ---- */
static int report_mass(occ_shape_t pipe) {
  double mass = 0.0, com[3] = {0}, I[6] = {0};
  int st = occ_mass_properties(pipe, kSteelDensity, &mass, com, I);
  if (st != OCC_OK) { die("mass_properties", st); return SKID_FAIL; }
  printf("[7] mass=%.3f kg COM=(%.4f,%.4f,%.4f)\n",
         mass, com[0], com[1], com[2]);
  printf("  Ixx=%.4g Iyy=%.4g Izz=%.4g Ixy=%.4g Ixz=%.4g Iyz=%.4g\n",
         I[0], I[1], I[2], I[3], I[4], I[5]);
  if (!(mass > 0.0) || !isfinite(mass)) {
    fprintf(stderr, "[smoke_pipe_skid] bad mass\n");
    return SKID_FAIL;
  }
  return SKID_OK;
}

static int export_skid(occ_shape_t base, occ_shape_t a, occ_shape_t b,
                       occ_shape_t pipe, occ_shape_t clamps) {
  occ_shape_t parts[5];
  int n = 0;
  if (base) parts[n++] = base;
  if (a) parts[n++] = a;
  if (b) parts[n++] = b;
  if (pipe) parts[n++] = pipe;
  if (clamps) parts[n++] = clamps;
  occ_shape_t assy = 0;
  if (occ_make_compound(parts, n, &assy) != OCC_OK) {
    die("make_compound", OCC_ERR_GEOM);
    return SKID_FAIL;
  }
  const char* path = "/tmp/smoke_pipe_skid.step";
  if (occ_step_write(assy, path) == OCC_OK)
    printf("[+] wrote %s (%d bodies)\n", path, n);
  else
    printf("  (STEP write skipped: %s)\n",
           occ_last_error() ? occ_last_error() : "?");
  free_shape(&assy);
  return SKID_OK;
}

int main(void) {
  printf("=== smoke_pipe_skid: AI-BOOST dual-goal pipe skid ===\n");
  printf("API: occ_c + frames + route | OCCT 7.9.3 | units: m, rad\n\n");

  occ_shape_t base = 0, eq_a = 0, eq_b = 0, path = 0, pipe = 0, clamps = 0;
  occ_frame_t na, nb;
  memset(&na, 0, sizeof(na));
  memset(&nb, 0, sizeof(nb));
  double route_len = 0.0;
  int any_hit = 0;
  int rc = SKID_OK;

  if (build_base(&base) != SKID_OK) { rc = SKID_FAIL; goto done; }
  if (build_equipment(&eq_a, &eq_b, &na, &nb) != SKID_OK) { rc = SKID_FAIL; goto done; }
  if (build_route(&na, &nb, &path, &route_len) != SKID_OK) { rc = SKID_FAIL; goto done; }
  if (build_pipe(path, &pipe) != SKID_OK) { rc = SKID_FAIL; goto done; }
  if (build_clamps(&clamps) != SKID_OK) { rc = SKID_FAIL; goto done; }
  if (check_clashes(pipe, eq_a, eq_b, &any_hit) != SKID_OK) { rc = SKID_FAIL; goto done; }
  if (report_mass(pipe) != SKID_OK) { rc = SKID_FAIL; goto done; }

  {
    double vol = 0.0;
    if (occ_volume(pipe, &vol) == OCC_OK) {
      printf("  pipe volume=%.6f m^3\n", vol);
      double outer = M_PI * (kPipeOD * 0.5) * (kPipeOD * 0.5) * route_len;
      if (vol > outer * 1.25) {
        fprintf(stderr, "[smoke_pipe_skid] volume too large\n");
        rc = SKID_FAIL;
        goto done;
      }
    }
  }
  export_skid(base, eq_a, eq_b, pipe, clamps);
  printf("\n=== RESULT: %s (clash_hit=%d route_len=%.3f m) ===\n",
         rc == SKID_OK ? "PASS" : "FAIL", any_hit, route_len);

done:
  free_shape(&base); free_shape(&eq_a); free_shape(&eq_b);
  free_shape(&path); free_shape(&pipe); free_shape(&clamps);
  return rc;
}
```

---

## 2. Six-DOF robot — `examples/smoke_robot_6dof.c`

Six links (box base + cylinders), joint frames, `ComposeChain` at example angles,
`RigidXform` place, non-adjacent clash, print TCP 4×4.

```c
// === file: examples/smoke_robot_6dof.c
/*
 * smoke_robot_6dof.c — 6-DOF robot arm dual-goal smoke (pure C / occ_c)
 *
 * IR → C:
 *   PrimCylinder / PrimBox → occ_make_cylinder / occ_make_box
 *   AttachFrame            → occ_frame_from_z (joint PODs)
 *   ComposeChain           → occ_compose_chain
 *   RigidXform             → occ_trsf_apply_shape
 *   QueryClash             → occ_clash (skip adjacent |i-j|==1)
 *
 * Prints TCP 4x4 row-major. Exit non-zero on failure. Units: m, rad.
 */
#include "occ_c.h"
#include "occ_c_frames.h"
#include "occ_c_route.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { DOF = 6, ROBOT_OK = 0, ROBOT_FAIL = 1 };

static const double kLinkLen[DOF] = { 0.15, 0.45, 0.40, 0.12, 0.10, 0.08 };
static const double kLinkRad[DOF] = { 0.080, 0.055, 0.045, 0.035, 0.030, 0.028 };

/* Joint origins (m) and axes for occ_compose_chain. */
static const double kOrigins[DOF * 3] = {
  0.0, 0.0, 0.0,
  0.0, 0.0, 0.15,
  0.0, 0.0, 0.45,
  0.0, 0.0, 0.40,
  0.0, 0.0, 0.12,
  0.0, 0.0, 0.10
};
static const double kAxes[DOF * 3] = {
  0.0, 0.0, 1.0,   /* base yaw */
  0.0, 1.0, 0.0,   /* shoulder */
  0.0, 1.0, 0.0,   /* elbow */
  0.0, 0.0, 1.0,   /* wrist roll */
  0.0, 1.0, 0.0,   /* wrist pitch */
  0.0, 0.0, 1.0    /* tool roll */
};
static const double kAngles[DOF] = { 0.35, -0.60, 1.10, 0.20, -0.40, 0.80 };
static const double kLinkClearance = 0.005;

static void die(const char* step, int st) {
  fprintf(stderr, "[smoke_robot_6dof] FAIL %s: status=%d err=%s\n",
          step, st, occ_last_error() ? occ_last_error() : "(null)");
}

static void free_shape(occ_shape_t* s) {
  if (s && *s) { occ_shape_free(*s); *s = 0; }
}

static void print_mat4(const char* title, const double m[16]) {
  printf("%s (row-major SE3, p'=M p):\n", title);
  for (int r = 0; r < 4; ++r)
    printf("  | %11.6f %11.6f %11.6f %11.6f |\n",
           m[4*r+0], m[4*r+1], m[4*r+2], m[4*r+3]);
}

static void mat_origin(const double m[16], double o[3]) {
  o[0] = m[3]; o[1] = m[7]; o[2] = m[11];
}

/* ---- Step 1: PrimBox / PrimCylinder link solids (local +Z) ---- */
static int build_link_solids(occ_shape_t links[DOF]) {
  for (int i = 0; i < DOF; ++i) {
    links[i] = 0;
    int st;
    if (i == 0) {
      occ_shape_t box = 0, centered = 0;
      st = occ_make_box(0.20, 0.20, kLinkLen[0], &box);
      if (st != OCC_OK) { die("PrimBox base", st); return ROBOT_FAIL; }
      st = occ_translate(box, -0.10, -0.10, 0.0, &centered);
      free_shape(&box);
      if (st != OCC_OK) { die("translate base", st); return ROBOT_FAIL; }
      links[i] = centered;
    } else {
      st = occ_make_cylinder(0, 0, 0, 0, 0, 1, kLinkRad[i], kLinkLen[i], &links[i]);
      if (st != OCC_OK) { die("PrimCylinder link", st); return ROBOT_FAIL; }
    }
  }
  printf("[1] PrimBox/PrimCylinder: %d link solids\n", DOF);
  for (int i = 0; i < DOF; ++i)
    printf("  L%d len=%.3f rad=%.3f\n", i, kLinkLen[i], i == 0 ? 0.10 : kLinkRad[i]);
  return ROBOT_OK;
}

/* ---- Step 2: AttachFrame joint PODs at zero config ---- */
static int attach_joint_frames(occ_frame_t joints[DOF]) {
  for (int i = 0; i < DOF; ++i) {
    const double* o = &kOrigins[i * 3];
    const double* a = &kAxes[i * 3];
    int st = occ_frame_from_z(o[0], o[1], o[2], a[0], a[1], a[2], &joints[i]);
    if (st != OCC_OK) { die("AttachFrame joint", st); return ROBOT_FAIL; }
  }
  printf("[2] AttachFrame: %d joint frames\n", DOF);
  for (int i = 0; i < DOF; ++i)
    printf("  J%d o=(%.3f,%.3f,%.3f) z=(%.2f,%.2f,%.2f)\n", i,
           joints[i].origin[0], joints[i].origin[1], joints[i].origin[2],
           joints[i].z_axis[0], joints[i].z_axis[1], joints[i].z_axis[2]);
  return ROBOT_OK;
}

/* ---- Step 3: ComposeChain → TCP + prefixes ---- */
static int compose_all(const double angles[DOF],
                       double T_prefix[DOF][16], double T_tcp[16]) {
  for (int k = 0; k < DOF; ++k)
    occ_compose_chain(kOrigins, kAxes, angles, k + 1, T_prefix[k]);
  memcpy(T_tcp, T_prefix[DOF - 1], 16 * sizeof(double));

  printf("[3] ComposeChain n=%d angles (rad):\n", DOF);
  for (int i = 0; i < DOF; ++i)
    printf("  q[%d]=%+.4f (%.1f deg)\n", i, angles[i], angles[i] * 180.0 / M_PI);
  print_mat4("TCP", T_tcp);

  double tcp_o[3];
  mat_origin(T_tcp, tcp_o);
  printf("  TCP origin=(%.4f, %.4f, %.4f) m\n", tcp_o[0], tcp_o[1], tcp_o[2]);

  double r = sqrt(tcp_o[0]*tcp_o[0] + tcp_o[1]*tcp_o[1] + tcp_o[2]*tcp_o[2]);
  double reach = 0.0;
  for (int i = 0; i < DOF; ++i) reach += kLinkLen[i];
  if (r > reach + 0.05) {
    fprintf(stderr, "[smoke_robot_6dof] TCP %.3f exceeds reach %.3f\n", r, reach);
    return ROBOT_FAIL;
  }
  return ROBOT_OK;
}

/* ---- Step 4: RigidXform place each link ---- */
static int place_links(occ_shape_t local[DOF], const double T_prefix[DOF][16],
                       occ_shape_t world[DOF]) {
  for (int i = 0; i < DOF; ++i) {
    world[i] = 0;
    int st = occ_trsf_apply_shape(local[i], T_prefix[i], &world[i]);
    if (st != OCC_OK) { die("RigidXform", st); return ROBOT_FAIL; }
  }
  printf("[4] RigidXform: placed %d links\n", DOF);
  return ROBOT_OK;
}

/* ---- Step 5: QueryClash non-adjacent (skip |i-j|<=1) ---- */
static int clash_nonadjacent(occ_shape_t world[DOF], int* out_hits) {
  int hits = 0, checks = 0;
  printf("[5] QueryClash non-adjacent, clearance=%.3f m\n", kLinkClearance);
  for (int i = 0; i < DOF; ++i) {
    for (int j = i + 2; j < DOF; ++j) {
      int status = 2;
      int rc = occ_clash(world[i], world[j], kLinkClearance, &status);
      if (rc != OCC_OK) { die("QueryClash", rc); return ROBOT_FAIL; }
      ++checks;
      printf("  L%d vs L%d status=%d\n", i, j, status);
      if (status == 1) ++hits;
    }
  }
  printf("  pairs=%d hits=%d\n", checks, hits);
  *out_hits = hits;
  return ROBOT_OK;
}

/* ---- Step 6: frame POD helpers ---- */
static int demo_frame_math(const occ_frame_t joints[DOF]) {
  occ_frame_t world, inv, prod;
  double m12[12];
  if (occ_frame_world(&world) != OCC_OK) { die("frame_world", -1); return ROBOT_FAIL; }
  if (occ_frame_inverted(&joints[0], &inv) != OCC_OK) { die("invert", -1); return ROBOT_FAIL; }
  if (occ_frame_multiplied(&joints[1], &joints[0], &prod) != OCC_OK) {
    die("multiplied", -1); return ROBOT_FAIL;
  }
  if (occ_frame_to_trsf_4x3(&prod, m12) != OCC_OK) { die("to_trsf", -1); return ROBOT_FAIL; }
  printf("[6] frame math OK (world, invert, multiply, 4x3)\n");
  (void)world; (void)inv;
  return ROBOT_OK;
}

static int report_arm_mass(occ_shape_t world[DOF]) {
  occ_shape_t assy = 0;
  if (occ_make_compound(world, DOF, &assy) != OCC_OK) {
    die("compound arm", -1); return ROBOT_FAIL;
  }
  double mass = 0.0, com[3] = {0}, I[6] = {0};
  int st = occ_mass_properties(assy, 2700.0, &mass, com, I);
  free_shape(&assy);
  if (st != OCC_OK) { die("mass arm", st); return ROBOT_FAIL; }
  printf("[7] arm mass (Al)=%.2f kg COM=(%.3f,%.3f,%.3f)\n",
         mass, com[0], com[1], com[2]);
  if (!(mass > 0.0)) { fprintf(stderr, "bad arm mass\n"); return ROBOT_FAIL; }
  return ROBOT_OK;
}

int main(void) {
  printf("=== smoke_robot_6dof: 6-DOF arm dual-goal smoke ===\n\n");

  occ_shape_t local[DOF], world[DOF];
  occ_frame_t joints[DOF];
  double T_prefix[DOF][16], T_tcp[16], angles[DOF];
  memset(local, 0, sizeof(local));
  memset(world, 0, sizeof(world));
  memset(joints, 0, sizeof(joints));
  memcpy(angles, kAngles, sizeof(angles));

  int hits = 0, rc = ROBOT_OK;

  if (build_link_solids(local) != ROBOT_OK) { rc = ROBOT_FAIL; goto done; }
  if (attach_joint_frames(joints) != ROBOT_OK) { rc = ROBOT_FAIL; goto done; }
  if (compose_all(angles, T_prefix, T_tcp) != ROBOT_OK) { rc = ROBOT_FAIL; goto done; }
  if (place_links(local, T_prefix, world) != ROBOT_OK) { rc = ROBOT_FAIL; goto done; }
  if (clash_nonadjacent(world, &hits) != ROBOT_OK) { rc = ROBOT_FAIL; goto done; }
  if (demo_frame_math(joints) != ROBOT_OK) { rc = ROBOT_FAIL; goto done; }
  if (report_arm_mass(world) != ROBOT_OK) { rc = ROBOT_FAIL; goto done; }

  printf("\n--- TCP 4x4 (canonical) ---\n");
  for (int r = 0; r < 4; ++r)
    printf("%.8f %.8f %.8f %.8f\n",
           T_tcp[4*r+0], T_tcp[4*r+1], T_tcp[4*r+2], T_tcp[4*r+3]);

  printf("\nJoint origins after FK:\n");
  for (int i = 0; i < DOF; ++i) {
    double o[3];
    mat_origin(T_prefix[i], o);
    printf("  J%d world=(%.4f, %.4f, %.4f)\n", i, o[0], o[1], o[2]);
  }
  printf("\n=== RESULT: %s (non-adj hits=%d) ===\n",
         rc == ROBOT_OK ? "PASS" : "FAIL", hits);

done:
  for (int i = 0; i < DOF; ++i) { free_shape(&local[i]); free_shape(&world[i]); }
  return rc;
}
```

---

## 3. Flange bolt circle — `examples/smoke_flange_bolt_circle.c`

Short cylinder flange + center bore + N bolt holes + polar bolt-head pattern.

```c
// === file: examples/smoke_flange_bolt_circle.c
/*
 * smoke_flange_bolt_circle.c — hole + PatternPolar recipe (pure C / occ_c)
 *
 * IR → C:
 *   PrimCylinder → occ_make_cylinder
 *   DrillHole    → occ_drill_hole_through
 *   PatternPolar → occ_pattern_polar
 *   mass         → occ_mass_properties
 *
 * Also demos PatternPolar of a single-hole solid (compound copies).
 */
#include "occ_c.h"
#include "occ_c_frames.h"
#include "occ_c_route.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { FLANGE_OK = 0, FLANGE_FAIL = 1 };

static const double kFlangeOD    = 0.230;
static const double kFlangeThk   = 0.024;
static const double kBoreRadius  = 0.051;
static const double kBoltCircleR = 0.095;
static const double kBoltHoleR   = 0.0095;
static const int    kBoltCount   = 8;
static const double kSteelDensity = 7850.0;

static void die(const char* step, int st) {
  fprintf(stderr, "[smoke_flange_bolt_circle] FAIL %s: status=%d err=%s\n",
          step, st, occ_last_error() ? occ_last_error() : "(null)");
}

static void free_shape(occ_shape_t* s) {
  if (s && *s) { occ_shape_free(*s); *s = 0; }
}

static int make_flange_disk(occ_shape_t* out) {
  int st = occ_make_cylinder(0, 0, 0, 0, 0, 1, kFlangeOD * 0.5, kFlangeThk, out);
  if (st != OCC_OK) { die("PrimCylinder flange", st); return FLANGE_FAIL; }
  printf("[1] PrimCylinder flange OD=%.3f thk=%.3f m\n", kFlangeOD, kFlangeThk);
  return FLANGE_OK;
}

static int drill_center_bore(occ_shape_t solid, occ_shape_t* out) {
  int st = occ_drill_hole_through(solid, 0, 0, kFlangeThk * 0.5,
                                  0, 0, 1, kBoreRadius, out);
  if (st != OCC_OK) { die("DrillHole bore", st); return FLANGE_FAIL; }
  printf("[2] DrillHole center bore R=%.4f m\n", kBoreRadius);
  return FLANGE_OK;
}

/* Preferred: successive through-holes on bolt circle → one solid. */
static int drill_bolt_circle(occ_shape_t solid, occ_shape_t* out) {
  occ_shape_t cur = solid, next = 0;
  int owns = 0;
  for (int i = 0; i < kBoltCount; ++i) {
    double ang = (2.0 * M_PI * (double)i) / (double)kBoltCount;
    double cx = kBoltCircleR * cos(ang);
    double cy = kBoltCircleR * sin(ang);
    int st = occ_drill_hole_through(cur, cx, cy, kFlangeThk * 0.5,
                                    0, 0, 1, kBoltHoleR, &next);
    if (st != OCC_OK) {
      die("DrillHole bolt", st);
      if (owns) free_shape(&cur);
      return FLANGE_FAIL;
    }
    if (owns) free_shape(&cur);
    cur = next; next = 0; owns = 1;
    printf("  bolt %d at (%.4f, %.4f)\n", i, cx, cy);
  }
  *out = cur;
  printf("[3] DrillHole bolt circle N=%d PCD=%.3f m\n",
         kBoltCount, 2.0 * kBoltCircleR);
  return FLANGE_OK;
}

/* PatternPolar of hex-head proxy boxes for BOM viz. */
static int pattern_bolt_heads(occ_shape_t* out_heads) {
  occ_shape_t seed = 0, seed_at = 0;
  int st = occ_make_box(0.024, 0.024, 0.016, &seed);
  if (st != OCC_OK) { die("PrimBox bolt head", st); return FLANGE_FAIL; }
  st = occ_translate(seed, kBoltCircleR - 0.012, -0.012, kFlangeThk, &seed_at);
  free_shape(&seed);
  if (st != OCC_OK) { die("translate head", st); return FLANGE_FAIL; }

  double step = (2.0 * M_PI) / (double)kBoltCount;
  st = occ_pattern_polar(seed_at, 0, 0, 0, 0, 0, 1, step, kBoltCount, 0, out_heads);
  free_shape(&seed_at);
  if (st != OCC_OK) { die("PatternPolar heads", st); return FLANGE_FAIL; }
  printf("[4] PatternPolar bolt heads N=%d step=%.4f rad\n", kBoltCount, step);
  return FLANGE_OK;
}

static int report(occ_shape_t flange) {
  double mass = 0.0, com[3] = {0}, I[6] = {0};
  int st = occ_mass_properties(flange, kSteelDensity, &mass, com, I);
  if (st != OCC_OK) { die("mass", st); return FLANGE_FAIL; }
  printf("[5] mass=%.3f kg COM=(%.4f,%.4f,%.4f)\n",
         mass, com[0], com[1], com[2]);
  double radial = sqrt(com[0]*com[0] + com[1]*com[1]);
  if (radial > 0.005) {
    fprintf(stderr, "[smoke_flange_bolt_circle] COM radial %.4f too large\n", radial);
    return FLANGE_FAIL;
  }
  if (!(mass > 0.0) || !isfinite(mass)) {
    fprintf(stderr, "[smoke_flange_bolt_circle] bad mass\n");
    return FLANGE_FAIL;
  }
  double vol = 0.0;
  if (occ_volume(flange, &vol) == OCC_OK) {
    printf("  volume=%.6f m^3\n", vol);
    double solid = M_PI * (kFlangeOD * 0.5) * (kFlangeOD * 0.5) * kFlangeThk;
    if (vol >= solid) {
      fprintf(stderr, "[smoke_flange_bolt_circle] holes did not reduce volume\n");
      return FLANGE_FAIL;
    }
  }
  return FLANGE_OK;
}

/* Alt: one hole then PatternPolar of the drilled solid (compound demo). */
static int demo_pattern_drilled_copy(occ_shape_t plain) {
  occ_shape_t one = 0, pat = 0;
  int st = occ_drill_hole_through(plain, kBoltCircleR, 0, kFlangeThk * 0.5,
                                  0, 0, 1, kBoltHoleR, &one);
  if (st != OCC_OK) { die("alt drill", st); return FLANGE_FAIL; }
  double step = (2.0 * M_PI) / (double)kBoltCount;
  st = occ_pattern_polar(one, 0, 0, 0, 0, 0, 1, step, kBoltCount, 0, &pat);
  free_shape(&one);
  if (st != OCC_OK) { die("alt polar", st); return FLANGE_FAIL; }
  printf("[alt] PatternPolar of single-hole flange → %d copies\n", kBoltCount);
  free_shape(&pat);
  return FLANGE_OK;
}

int main(void) {
  printf("=== smoke_flange_bolt_circle: hole+pattern recipe ===\n\n");
  occ_shape_t disk = 0, bored = 0, flange = 0, heads = 0;
  int rc = FLANGE_OK;

  if (make_flange_disk(&disk) != FLANGE_OK) { rc = FLANGE_FAIL; goto done; }
  if (demo_pattern_drilled_copy(disk) != FLANGE_OK) { rc = FLANGE_FAIL; goto done; }
  if (drill_center_bore(disk, &bored) != FLANGE_OK) { rc = FLANGE_FAIL; goto done; }
  if (drill_bolt_circle(bored, &flange) != FLANGE_OK) { rc = FLANGE_FAIL; goto done; }
  if (pattern_bolt_heads(&heads) != FLANGE_OK) { rc = FLANGE_FAIL; goto done; }
  if (report(flange) != FLANGE_OK) { rc = FLANGE_FAIL; goto done; }

  {
    occ_shape_t parts[2] = { flange, heads }, grp = 0;
    if (occ_make_compound(parts, 2, &grp) == OCC_OK) {
      if (occ_step_write(grp, "/tmp/smoke_flange_bolt_circle.step") == OCC_OK)
        printf("[+] wrote /tmp/smoke_flange_bolt_circle.step\n");
      free_shape(&grp);
    }
  }
  printf("\n=== RESULT: %s ===\n", rc == FLANGE_OK ? "PASS" : "FAIL");

done:
  free_shape(&disk); free_shape(&bored); free_shape(&flange); free_shape(&heads);
  return rc;
}
```

---

## 4. Extractor — `scripts/extract_literate.py`

```python
# === file: scripts/extract_literate.py
#!/usr/bin/env python3
"""extract_literate.py — write literate code fences to real files.

Usage:
  python3 scripts/extract_literate.py docs/literate-sections/08-smoke-dual-goal.md
  python3 scripts/extract_literate.py docs/occ-c-literate-api.md --root . --force
  python3 scripts/extract_literate.py section.md --dry-run --list

A fenced block is extractable iff its first non-empty line matches:
  // === file: RELPATH   (C/C++/headers)
  # === file: RELPATH    (Python/Starlark)
The mark line is kept in the output. Paths must be relative (no parent hops).
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

FILE_MARK = re.compile(
    r"^[ \t]*(?://|#) === file:[ \t]*(?P<path>\S+)\s*$"
)
FENCE_OPEN = re.compile(r"^```([a-zA-Z0-9_+-]*)\s*$")
FENCE_CLOSE = re.compile(r"^```\s*$")


def iter_fences(lines: List[str]) -> Iterable[Tuple[str, List[str]]]:
    i, n = 0, len(lines)
    while i < n:
        m = FENCE_OPEN.match(lines[i])
        if not m:
            i += 1
            continue
        lang = m.group(1) or ""
        i += 1
        body: List[str] = []
        while i < n and not FENCE_CLOSE.match(lines[i]):
            body.append(lines[i].rstrip("\n"))
            i += 1
        if i < n:
            i += 1
        yield lang, body


def first_file_mark(body: List[str]) -> Optional[str]:
    for line in body:
        if line.strip() == "":
            continue
        m = FILE_MARK.match(line)
        return m.group("path") if m else None
    return None


def safe_join(root: Path, rel: str) -> Path:
    if os.path.isabs(rel) or any(p == ".." for p in Path(rel).parts):
        raise ValueError(f"unsafe path: {rel}")
    out = (root / rel).resolve()
    out.relative_to(root.resolve())
    return out


def extract_from_text(
    text: str, root: Path, force: bool, dry_run: bool, source: str
) -> List[Tuple[str, Path, int]]:
    written: List[Tuple[str, Path, int]] = []
    for lang, body in iter_fences(text.splitlines()):
        rel = first_file_mark(body)
        if not rel:
            continue
        content = "\n".join(body)
        if content and not content.endswith("\n"):
            content += "\n"
        try:
            dest = safe_join(root, rel)
        except ValueError as ex:
            print(f"error: {source}: {ex}", file=sys.stderr)
            continue
        nbytes = len(content.encode("utf-8"))
        if dry_run:
            print(f"DRY  {rel}  ({nbytes} B, lang={lang or '-'})")
            written.append((rel, dest, nbytes))
            continue
        if dest.exists() and not force:
            print(f"skip {rel}  (exists; use --force)")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content, encoding="utf-8")
        if rel.startswith("scripts/") and rel.endswith(".py"):
            dest.chmod(dest.stat().st_mode | 0o111)
        print(f"write {rel}  ({nbytes} B)")
        written.append((rel, dest, nbytes))
    return written


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("markdown", nargs="+", help="Markdown sources")
    ap.add_argument("--root", default=".", help="Output root (default cwd)")
    ap.add_argument("--force", action="store_true", help="Overwrite existing")
    ap.add_argument("--dry-run", action="store_true", help="Plan only")
    ap.add_argument("--list", action="store_true", help="List paths and sizes")
    ap.add_argument("--require", action="store_true", help="Fail if zero files")
    args = ap.parse_args(argv)

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"error: root not a directory: {root}", file=sys.stderr)
        return 1

    total: List[Tuple[str, Path, int]] = []
    for md in args.markdown:
        p = Path(md)
        if not p.is_file():
            print(f"error: not a file: {md}", file=sys.stderr)
            return 1
        dry = args.dry_run or args.list
        total.extend(
            extract_from_text(
                p.read_text(encoding="utf-8"), root, args.force, dry, str(p)
            )
        )

    if args.list:
        for rel, _d, n in total:
            print(f"{rel}\t{n}")
        return 0 if total or not args.require else 2

    print(f"-- {len(total)} file(s) from {len(args.markdown)} source(s)")
    return 2 if (args.require and not total) else 0


if __name__ == "__main__":
    sys.exit(main())
```

---

## 5. BUILD.bazel fragment

```python
# === file: examples/BUILD.bazel
# Dual-goal pure-C smoke binaries for occ_c P0. Merge with existing package.

load("@rules_cc//cc:defs.bzl", "cc_binary", "cc_test")

package(default_visibility = ["//visibility:public"])

SMOKE_COPTS = ["-std=c11", "-Wall", "-Wextra", "-Wno-unused-parameter"]
OCC_C_DEP = "//api:occ_c"  # or //api:occ_c_lib

cc_binary(
    name = "smoke_pipe_skid",
    srcs = ["smoke_pipe_skid.c"],
    copts = SMOKE_COPTS,
    deps = [OCC_C_DEP],
)

cc_test(
    name = "smoke_pipe_skid_test",
    srcs = ["smoke_pipe_skid.c"],
    copts = SMOKE_COPTS,
    deps = [OCC_C_DEP],
    size = "small",
)

cc_binary(
    name = "smoke_robot_6dof",
    srcs = ["smoke_robot_6dof.c"],
    copts = SMOKE_COPTS,
    deps = [OCC_C_DEP],
)

cc_test(
    name = "smoke_robot_6dof_test",
    srcs = ["smoke_robot_6dof.c"],
    copts = SMOKE_COPTS,
    deps = [OCC_C_DEP],
    size = "small",
)

cc_binary(
    name = "smoke_flange_bolt_circle",
    srcs = ["smoke_flange_bolt_circle.c"],
    copts = SMOKE_COPTS,
    deps = [OCC_C_DEP],
)

cc_test(
    name = "smoke_flange_bolt_circle_test",
    srcs = ["smoke_flange_bolt_circle.c"],
    copts = SMOKE_COPTS,
    deps = [OCC_C_DEP],
    size = "small",
)

filegroup(
    name = "dual_goal_smokes",
    srcs = [
        "smoke_pipe_skid.c",
        "smoke_robot_6dof.c",
        "smoke_flange_bolt_circle.c",
    ],
)

# Reference: api/BUILD.bazel expanded library srcs
# cc_library(
#     name = "occ_c",
#     srcs = [
#         "src/occ_c.cc",
#         "src/occ_c_frames.cc",
#         "src/occ_c_route.cc",
#         "src/occ_c_query.cc",
#         "src/occ_c_trsf.cc",
#     ],
#     hdrs = [
#         "include/occ_c.h",
#         "include/occ_c_frames.h",
#         "include/occ_c_route.h",
#     ],
#     includes = ["include"],
#     deps = ["@occt//:occt"],
#     copts = ["-std=c++17"],
# )
```

---

## 6. IR → C map (this section)

| IR op | C symbol | Smoke |
|-------|----------|-------|
| `PrimBox` | `occ_make_box` | skid base/eq/clamps, base link |
| `PrimCylinder` | `occ_make_cylinder` | robot links, flange |
| `AttachFrame` | `occ_frame_from_axes` / `occ_frame_from_z` | nozzles, joints |
| `RoutePath` | `occ_make_route_with_bends` | skid centerline |
| `SweepAlong` | `occ_pipe_annulus` | pipe run |
| `PatternLinear` | `occ_pattern_linear` | clamps |
| `PatternPolar` | `occ_pattern_polar` | bolt heads |
| `DrillHole` | `occ_drill_hole_through` | bore + bolts |
| `ComposeChain` | `occ_compose_chain` | FK |
| `RigidXform` | `occ_trsf_apply_shape` | place links |
| `QueryClash` | `occ_clash` | pipe/eq, non-adj links |
| mass | `occ_mass_properties` | all three |
| `GroupBodies` | `occ_make_compound` | STEP export |

---

## 7. Extract & build checklist

```bash
python3 scripts/extract_literate.py \
  docs/occ-c-literate-api.md \
  docs/literate-sections/08-smoke-dual-goal.md \
  --root . --force

bazel build //examples:smoke_pipe_skid //examples:smoke_robot_6dof //examples:smoke_flange_bolt_circle
bazel test  //examples:smoke_pipe_skid_test //examples:smoke_robot_6dof_test //examples:smoke_flange_bolt_circle_test
```

**Golden checks:** pipe mass > 0; robot TCP within reach; flange COM radial < 5 mm; all exit 0.

---

*End of section 08 — dual-goal smoke programs.*
