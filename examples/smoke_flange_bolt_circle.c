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
#include "occ_c_all.h"
#include "occ_c_frames.h"
#include "occ_c_route.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
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
  st = occ_pattern_polar(seed_at, 0, 0, 0, 0, 0, 1, step, kBoltCount, out_heads);
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
  st = occ_pattern_polar(one, 0, 0, 0, 0, 0, 1, step, kBoltCount, &pat);
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
  fflush(stdout);
  _Exit(rc);
}