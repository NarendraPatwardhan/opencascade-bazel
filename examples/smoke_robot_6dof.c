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
#include "occ_c_all.h"
#include "occ_c_frames.h"
#include "occ_c_route.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
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
    int st = occ_frame_from_z(o[0], o[1], o[2], a[0], a[1], a[2],
                              0.0, 0.0, 0.0, &joints[i]);
    if (st != OCC_OK) { die("AttachFrame joint", st); return ROBOT_FAIL; }
  }
  printf("[2] AttachFrame: %d joint frames\n", DOF);
  for (int i = 0; i < DOF; ++i)
    printf("  J%d o=(%.3f,%.3f,%.3f) z=(%.2f,%.2f,%.2f)\n", i,
           joints[i].ox, joints[i].oy, joints[i].oz,
           joints[i].zx, joints[i].zy, joints[i].zz);
  return ROBOT_OK;
}

/* ---- Step 3: ComposeChain → TCP + prefixes ---- */
static int compose_all(const double angles[DOF],
                       double T_prefix[DOF][16], double T_tcp[16]) {
  for (int k = 0; k < DOF; ++k)
    occ_compose_chain(k + 1, kOrigins, kAxes, angles, NULL, T_prefix[k]);
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
  fflush(stdout);
  _Exit(rc);
}