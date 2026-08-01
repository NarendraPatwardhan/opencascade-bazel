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
#include "occ_c_all.h"
#include "occ_c_frames.h"
#include "occ_c_route.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
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
         name, f->ox, f->oy, f->oz,
         f->zx, f->zy, f->zz);
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
    na->ox,           na->oy, na->oz,
    na->ox + 0.35,    na->oy, na->oz,
    na->ox + 0.35,    na->oy, 1.20,
    nb->ox - 0.45,    na->oy, 1.20,
    nb->ox - 0.45,    nb->oy, 1.20,
    nb->ox - 0.45,    nb->oy, nb->oz,
    nb->ox,           nb->oy, nb->oz
  };
  const int n_pts = (int)(sizeof(nodes) / sizeof(nodes[0]) / 3);

  int st = occ_make_route_with_bends(nodes, n_pts, kBendRadius, out_path);
  if (st != OCC_OK) { die("RoutePath", st); return SKID_FAIL; }

  *out_len = 0.0;
  st = occ_wire_length(*out_path, out_len);
  if (st != OCC_OK) { die("wire_length", st); return SKID_FAIL; }

  double o0[3], t0[3], o1[3], t1[3];
  if (occ_wire_end_point_tangent(*out_path, 1, o0, t0) == OCC_OK)
    printf("  start o=(%.3f,%.3f,%.3f) t=(%.3f,%.3f,%.3f)\n",
           o0[0], o0[1], o0[2], t0[0], t0[1], t0[2]);
  if (occ_wire_end_point_tangent(*out_path, 0, o1, t1) == OCC_OK)
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
                          kClampCount, out_clamps);
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

  /* API: 0=separated 1=within clearance 2=interfering */
  printf("[6] QueryClash clearance=%.3f m eqA=%d eqB=%d\n",
         kClearance, st_a, st_b);
  *out_any_hit =
      (st_a == OCC_CLASH_CLEARANCE || st_a == OCC_CLASH_INTERFERE ||
       st_b == OCC_CLASH_CLEARANCE || st_b == OCC_CLASH_INTERFERE)
          ? 1
          : 0;
  /* Expect contact/interference at nozzles (pipe meets equipment faces). */
  if (st_a != OCC_CLASH_INTERFERE && st_a != OCC_CLASH_CLEARANCE &&
      st_b != OCC_CLASH_INTERFERE && st_b != OCC_CLASH_CLEARANCE) {
    fprintf(stderr, "[smoke_pipe_skid] expected nozzle clash/clearance, got %d/%d\n",
            st_a, st_b);
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
  fflush(stdout);
  _Exit(rc);
}