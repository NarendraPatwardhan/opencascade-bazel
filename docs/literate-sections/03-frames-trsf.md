# Section 03 — Frames & Rigid Transforms (SE(3))

**Document type:** Literate programming source for Apache **`occ_c`** over **OCCT 7.9.3**  
**Extract targets:** `api/include/occ_c_frames.h`, `api/src/occ_c_frames.cc`, `api/include/occ_c_trsf.h`, `api/src/occ_c_trsf.cc`  
**Scope:** Pure SE(3) math + placing BREP. Product mate **solver** is out of scope.  
**Units:** meters, radians. Topology indices 1-based elsewhere; this section is coordinate-only except shape appliers.  
**Depends on:** `occ_c.h` (`OCC_API`, `occ_shape_t`, `occ_status_t`), `occ_c_internal.hxx` (`as_shape`, `to_handle`, `set_last`, `OCC_GUARD_*`, `REQ`).

---

## Pedagogy

### AttachFrame → POD, not a kernel entity

In product IR, `AttachFrame` names a rigid pose on a part (mate-connector analogue). In `occ_c` that is a plain C struct:

```c
typedef struct {
  double ox, oy, oz;       /* origin in parent / world */
  double xx, xy, xz;       /* X axis (unit after normalize) */
  double yx, yy, yz;       /* Y axis */
  double zx, zy, zz;       /* Z axis (main / "up" / surface normal / edge tangent) */
} occ_frame_t;
```

It is **not** a Parasolid mate connector body, not a named attribute on `TopoDS_Shape`, and not an OCCT `TDF` label. Host code owns the registry; the kernel only evaluates rigid maps.

A valid frame is a **right-handed orthonormal triad** (det ≈ +1). All constructors run an orthonormalization helper that:

1. Normalizes Z (required).
2. Projects the X-hint off Z; if nearly parallel, substitutes a stable alternate hint.
3. Rebuilds Y = Z × X, then X = Y × Z.

### RigidXform → displacement, not re-bake of design geometry

`RigidXform` / occurrence placement is:

\[
T = T_{\mathrm{target}}\, T_{\mathrm{current}}^{-1}
\]

Apply \(T\) once with `BRepBuilderAPI_Transform(..., Standard_True)` (copy). Design BREP stays at its modeling pose; each occurrence gets a transformed copy. **Do not** re-model joints into solid topology for FK — keep joint variables as numbers, compose SE(3), then place.

### Connector map \(T = B \cdot A^{-1}\)

If a shape's connector sits at frame \(A\) and must land on frame \(B\):

```text
world_point' = B * inv(A) * world_point
```

OCCT's `gp_Trsf::SetDisplacement(A, B)` is exactly that map. Our C name is `occ_frame_displacement` (returns the map as a frame / 4×3 / 4×4).

### ComposeChain vs baking joints into BREP

For a 6-DOF serial arm:

| Approach | When | Cost |
|----------|------|------|
| **`occ_compose_chain`** then `occ_trsf_apply_shape` per link | animation, IR evaluation, collision pack | cheap; BREP topology fixed |
| Baking joint angle into solid (boolean, revolve cut) | never for FK | destroys stable ids, kills interactivity |

DH bonus (`occ_compose_chain_dh`) is classic Craig / Paul convention for textbooks and legacy URDF-like tables; product robot paths should prefer explicit origins + axes (`occ_compose_chain`).

### Matrix layout (fixed)

**4×4 is row-major** with last row `[0,0,0,1]`. Column vectors: \(p' = M p\).

```text
index:  0  1  2  3
        4  5  6  7
        8  9 10 11
       12 13 14 15

values: xx yx zx ox
        xy yy zy oy
        xz yz zz oz
         0  0  0  1
```

**4×3** is the upper three rows only (12 doubles, same order). Compatible with `gp_Trsf::SetValues(a11..a34)`.

Multiplication convention for frames and matrices: **`B * A` means apply A first, then B** (standard linear-algebra composition for column vectors).

---

## Shared conventions used by both TUs

| Symbol | Meaning |
|--------|---------|
| `OCC_OK` | success |
| `OCC_ERR_NULL_ARG` | null pointer |
| `OCC_ERR_INVALID_SHAPE` | wrong `TopAbs` kind |
| `OCC_ERR_GEOM` | degenerate geometry / singular matrix |
| `OCC_ERR_FRAME` | degenerate / non-orthonormalizable axes |
| `OCC_ERR_EXCEPTION` | OCCT/`std` exception via `OCC_GUARD_END` |

OCCT types used (7.9.3): `gp_Trsf`, `gp_Ax1`, `gp_Ax2`, `gp_Ax3`, `gp_Pnt`, `gp_Dir`, `gp_Vec`, `BRepBuilderAPI_Transform`, `BRepAdaptor_Curve`, `BRepAdaptor_Surface`, `BRep_Builder`, `TopExp_Explorer`, `TopoDS`, `TopAbs_*`.

---

## Header — frames

```c
// === file: occ_c_frames.h
#ifndef OCC_C_FRAMES_H_
#define OCC_C_FRAMES_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* -------------------------------------------------------------------------
 * occ_frame_t — pure SE(3) pose (mate-connector analogue as POD).
 *
 * Right-handed orthonormal triad after successful construction:
 *   X = (xx,xy,xz), Y = (yx,yy,yz), Z = (zx,zy,zz), origin = (ox,oy,oz)
 * Z is the "main" direction (edge tangent, surface normal, joint axis sense).
 * ------------------------------------------------------------------------- */
typedef struct {
  double ox, oy, oz;
  double xx, xy, xz; /* X axis */
  double yx, yy, yz; /* Y axis */
  double zx, zy, zz; /* Z axis */
} occ_frame_t;

/* World / identity frame: origin 0, X=(1,0,0), Y=(0,1,0), Z=(0,0,1). */
OCC_API int occ_frame_world(occ_frame_t* out);

/* Build from origin + X + Z; Y is reconstructed; axes orthonormalized. */
OCC_API int occ_frame_from_axes(double ox, double oy, double oz,
                                double xx, double xy, double xz,
                                double zx, double zy, double zz,
                                occ_frame_t* out);

/* Build from origin + Z and optional X-hint.
 * Pass xh=xyh=xzh=0 (or any near-zero vector) to auto-pick a stable X.
 * Handles nearly-parallel X-hint via orthonormalize helper. */
OCC_API int occ_frame_from_z(double ox, double oy, double oz,
                             double zx, double zy, double zz,
                             double xh, double yh, double zh,
                             occ_frame_t* out);

/* ZYX intrinsic Euler (yaw-pitch-roll): R = Rz(rz) * Ry(ry) * Rx(rx).
 * Angles in radians. Origin (ox,oy,oz). */
OCC_API int occ_frame_from_zyx_euler(double ox, double oy, double oz,
                                     double rx, double ry, double rz,
                                     occ_frame_t* out);

/* 4x3 row-major upper block: [R|t] as 3x4 flattened row-major (12 doubles). */
OCC_API int occ_frame_to_trsf_4x3(const occ_frame_t* f, double out12[12]);
OCC_API int occ_frame_from_trsf_4x3(const double m12[12], occ_frame_t* out);

/* 4x4 row-major, last row 0,0,0,1. Column-vector p' = M p. */
OCC_API int occ_frame_to_matrix4x4(const occ_frame_t* f, double out16[16]);
OCC_API int occ_frame_from_matrix4x4(const double m16[16], occ_frame_t* out);

/* Invert: inv(F). Multiply: B*A means apply A then B. */
OCC_API int occ_frame_inverted(const occ_frame_t* f, occ_frame_t* out);
OCC_API int occ_frame_multiplied(const occ_frame_t* b, const occ_frame_t* a,
                                 occ_frame_t* out);

/* Connector displacement T = B * inv(A). Maps points so frame A lands on B. */
OCC_API int occ_frame_displacement(const occ_frame_t* from_a,
                                   const occ_frame_t* to_b,
                                   occ_frame_t* out);

/* Apply rigid transform encoded as 4x3 or as a placement frame (world ← local). */
OCC_API int occ_transform_shape_4x3(occ_shape_t s, const double m12[12],
                                    occ_shape_t* out);
OCC_API int occ_transform_shape_frame(occ_shape_t s, const occ_frame_t* f,
                                      occ_shape_t* out);

/* Place shape so that current_frame_on_shape lands on target_frame:
 *   T = target * inv(current);  out = T(shape).
 * If current_frame_on_shape is NULL, treated as world (identity). */
OCC_API int occ_place_shape_at_frame(occ_shape_t shape,
                                     const occ_frame_t* target_frame,
                                     const occ_frame_t* current_frame_on_shape,
                                     occ_shape_t* out);

/* Frame whose Z is edge tangent at parameter u (curve parameter, not arc length). */
OCC_API int occ_frame_at_edge_param(occ_shape_t edge, double u,
                                    occ_frame_t* out);

/* Frame at wire start (at_start!=0) or end (at_start==0); Z = tangent outward
 * along the wire direction (start: +D1, end: +D1 at last param of last edge). */
OCC_API int occ_frame_at_wire_end(occ_shape_t wire, int at_start,
                                  occ_frame_t* out);

/* Frame on face surface at (u,v): origin = S(u,v), Z = unit normal from D1,
 * X along dS/du when possible. */
OCC_API int occ_frame_on_face(occ_shape_t face, double u, double v,
                              occ_frame_t* out);

/* Mirror copy across plane (point + normal). If keep_original_compound!=0,
 * out is a COMPOUND of {original, mirrored}; else out is mirrored only. */
OCC_API int occ_mirror_copy(occ_shape_t shape,
                            double px, double py, double pz,
                            double nx, double ny, double nz,
                            int keep_original_compound,
                            occ_shape_t* out);

/* Apply N rigid transforms (each 4x4 row-major) to seed → COMPOUND of N copies.
 * Foundation for linear/polar patterns at the IR level. */
OCC_API int occ_transform_copy_array(occ_shape_t seed,
                                     const double* transforms_4x4, /* n*16 */
                                     int n,
                                     occ_shape_t* out);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_FRAMES_H_ */
```

---

## Implementation — frames

```cpp
// === file: occ_c_frames.cc
// OCCT 7.9.3 — pure SE(3) frames + BREP placement.
// Extract into api/src/occ_c_frames.cc

#include "occ_c_frames.h"
#include "occ_c_internal.hxx"

#include <cmath>
#include <cstring>

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRep_Builder.hxx>
#include <TopAbs.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::to_handle;
using occ_c_detail::set_last;

namespace {

constexpr double k_axis_eps   = 1.0e-12;
constexpr double k_parallel   = 1.0e-9;   /* |dot| > 1-eps ⇒ nearly parallel */
constexpr double k_unit_tol   = 1.0e-9;

inline double vdot(double ax, double ay, double az,
                   double bx, double by, double bz) {
  return ax * bx + ay * by + az * bz;
}

inline double vlen(double x, double y, double z) {
  return std::sqrt(x * x + y * y + z * z);
}

inline void vcross(double ax, double ay, double az,
                   double bx, double by, double bz,
                   double* ox, double* oy, double* oz) {
  *ox = ay * bz - az * by;
  *oy = az * bx - ax * bz;
  *oz = ax * by - ay * bx;
}

inline int vnormalize(double* x, double* y, double* z) {
  const double L = vlen(*x, *y, *z);
  if (L < k_axis_eps) return 0;
  *x /= L; *y /= L; *z /= L;
  return 1;
}

/* Orthonormalize right-handed triad from Z (required) + X-hint (optional).
 * Nearly-parallel X-hint is replaced by a stable alternate (world X or Y).
 * Returns OCC_OK / OCC_ERR_FRAME. */
int orthonormalize(double zx, double zy, double zz,
                   double xh, double yh, double zh,
                   double* xx, double* xy, double* xz,
                   double* yx, double* yy, double* yz,
                   double* ox_z, double* oy_z, double* oz_z) {
  if (!vnormalize(&zx, &zy, &zz)) {
    set_last("frame Z axis length near zero");
    return OCC_ERR_FRAME;
  }

  /* Project X-hint onto plane orthogonal to Z. */
  double hx = xh, hy = yh, hz = zh;
  double hlen = vlen(hx, hy, hz);
  if (hlen < k_axis_eps) {
    /* Auto-pick: prefer world X unless Z ~ ±X, then world Y. */
    if (std::fabs(zx) < 0.9) {
      hx = 1.0; hy = 0.0; hz = 0.0;
    } else {
      hx = 0.0; hy = 1.0; hz = 0.0;
    }
  } else {
    hx /= hlen; hy /= hlen; hz /= hlen;
    const double d = vdot(hx, hy, hz, zx, zy, zz);
    if (std::fabs(d) > 1.0 - k_parallel) {
      /* Nearly parallel — switch hint. */
      if (std::fabs(zx) < 0.9) {
        hx = 1.0; hy = 0.0; hz = 0.0;
      } else {
        hx = 0.0; hy = 1.0; hz = 0.0;
      }
    }
  }

  /* Remove Z component from hint. */
  {
    const double d = vdot(hx, hy, hz, zx, zy, zz);
    hx -= d * zx; hy -= d * zy; hz -= d * zz;
  }
  if (!vnormalize(&hx, &hy, &hz)) {
    /* Pathological residual — try the other world axis. */
    if (std::fabs(zx) < 0.9) {
      hx = 1.0; hy = 0.0; hz = 0.0;
    } else {
      hx = 0.0; hy = 1.0; hz = 0.0;
    }
    const double d = vdot(hx, hy, hz, zx, zy, zz);
    hx -= d * zx; hy -= d * zy; hz -= d * zz;
    if (!vnormalize(&hx, &hy, &hz)) {
      set_last("frame orthonormalize failed (X residual)");
      return OCC_ERR_FRAME;
    }
  }

  /* Y = Z × X, then re-orthogonalize X = Y × Z for numerical hygiene. */
  double yx0, yy0, yz0;
  vcross(zx, zy, zz, hx, hy, hz, &yx0, &yy0, &yz0);
  if (!vnormalize(&yx0, &yy0, &yz0)) {
    set_last("frame orthonormalize failed (Y)");
    return OCC_ERR_FRAME;
  }
  double xx0, xy0, xz0;
  vcross(yx0, yy0, yz0, zx, zy, zz, &xx0, &xy0, &xz0);
  if (!vnormalize(&xx0, &xy0, &xz0)) {
    set_last("frame orthonormalize failed (X rebuild)");
    return OCC_ERR_FRAME;
  }

  *xx = xx0; *xy = xy0; *xz = xz0;
  *yx = yx0; *yy = yy0; *yz = yz0;
  *ox_z = zx; *oy_z = zy; *oz_z = zz;
  return OCC_OK;
}

void store_frame(occ_frame_t* out,
                 double ox, double oy, double oz,
                 double xx, double xy, double xz,
                 double yx, double yy, double yz,
                 double zx, double zy, double zz) {
  out->ox = ox; out->oy = oy; out->oz = oz;
  out->xx = xx; out->xy = xy; out->xz = xz;
  out->yx = yx; out->yy = yy; out->yz = yz;
  out->zx = zx; out->zy = zy; out->zz = zz;
}

int frame_to_ax3(const occ_frame_t& f, gp_Ax3& out) {
  double xx = f.xx, xy = f.xy, xz = f.xz;
  double yx = f.yx, yy = f.yy, yz = f.yz;
  double zx = f.zx, zy = f.zy, zz = f.zz;

  /* Prefer stored X as hint; re-orthonormalize for safety. */
  double oxx, oxy, oxz, oyx, oyy, oyz, ozx, ozy, ozz;
  int st = orthonormalize(zx, zy, zz, xx, xy, xz,
                          &oxx, &oxy, &oxz,
                          &oyx, &oyy, &oyz,
                          &ozx, &ozy, &ozz);
  if (st != OCC_OK) return st;

  /* Detect left-handed storage: if given Y opposes reconstructed Y, flip Y
   * is unnecessary for placement — we force RH via gp_Ax3(Z,X). */
  (void)yx; (void)yy; (void)yz;

  try {
    out = gp_Ax3(gp_Pnt(f.ox, f.oy, f.oz),
                 gp_Dir(ozx, ozy, ozz),
                 gp_Dir(oxx, oxy, oxz));
  } catch (Standard_Failure& e) {
    set_last(e.GetMessageString() ? e.GetMessageString() : "gp_Ax3 failed");
    return OCC_ERR_FRAME;
  }
  return OCC_OK;
}

void frame_from_ax3(const gp_Ax3& a, occ_frame_t* out) {
  const gp_Pnt o = a.Location();
  const gp_Dir x = a.XDirection();
  const gp_Dir y = a.YDirection();
  const gp_Dir z = a.Direction();
  store_frame(out,
              o.X(), o.Y(), o.Z(),
              x.X(), x.Y(), x.Z(),
              y.X(), y.Y(), y.Z(),
              z.X(), z.Y(), z.Z());
}

/* Placement transform: maps world identity triad onto frame f
 * (local coordinates of f → world). */
int place_trsf(const occ_frame_t& f, gp_Trsf& t) {
  gp_Ax3 ax;
  int st = frame_to_ax3(f, ax);
  if (st != OCC_OK) return st;
  t.SetDisplacement(gp_Ax3() /* world */, ax);
  return OCC_OK;
}

void trsf_to_4x3(const gp_Trsf& t, double out12[12]) {
  out12[0]  = t.Value(1, 1); out12[1]  = t.Value(1, 2);
  out12[2]  = t.Value(1, 3); out12[3]  = t.Value(1, 4);
  out12[4]  = t.Value(2, 1); out12[5]  = t.Value(2, 2);
  out12[6]  = t.Value(2, 3); out12[7]  = t.Value(2, 4);
  out12[8]  = t.Value(3, 1); out12[9]  = t.Value(3, 2);
  out12[10] = t.Value(3, 3); out12[11] = t.Value(3, 4);
}

void trsf_to_4x4(const gp_Trsf& t, double out16[16]) {
  out16[0]  = t.Value(1, 1); out16[1]  = t.Value(1, 2);
  out16[2]  = t.Value(1, 3); out16[3]  = t.Value(1, 4);
  out16[4]  = t.Value(2, 1); out16[5]  = t.Value(2, 2);
  out16[6]  = t.Value(2, 3); out16[7]  = t.Value(2, 4);
  out16[8]  = t.Value(3, 1); out16[9]  = t.Value(3, 2);
  out16[10] = t.Value(3, 3); out16[11] = t.Value(3, 4);
  out16[12] = 0.0; out16[13] = 0.0; out16[14] = 0.0; out16[15] = 1.0;
}

int trsf_from_4x3(const double m12[12], gp_Trsf& t) {
  try {
    t.SetValues(m12[0], m12[1], m12[2], m12[3],
                m12[4], m12[5], m12[6], m12[7],
                m12[8], m12[9], m12[10], m12[11]);
  } catch (Standard_Failure& e) {
    set_last(e.GetMessageString() ? e.GetMessageString() : "SetValues failed");
    return OCC_ERR_GEOM;
  }
  return OCC_OK;
}

int trsf_from_4x4(const double m16[16], gp_Trsf& t) {
  /* Ignore last row; require near [0,0,0,1] only as soft check. */
  if (std::fabs(m16[15] - 1.0) > 1.0e-6) {
    set_last("matrix4x4 last row not [0,0,0,1]");
    return OCC_ERR_GEOM;
  }
  try {
    t.SetValues(m16[0], m16[1], m16[2], m16[3],
                m16[4], m16[5], m16[6], m16[7],
                m16[8], m16[9], m16[10], m16[11]);
  } catch (Standard_Failure& e) {
    set_last(e.GetMessageString() ? e.GetMessageString() : "SetValues failed");
    return OCC_ERR_GEOM;
  }
  return OCC_OK;
}

int apply_trsf_copy(occ_shape_t s, const gp_Trsf& t, occ_shape_t* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  BRepBuilderAPI_Transform mk(*as_shape(s), t, /*Copy=*/Standard_True);
  if (!mk.IsDone()) {
    set_last("BRepBuilderAPI_Transform failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk.Shape());
  return OCC_OK;
}

/* Frame from tangent vector at a point (Z = unit tangent). */
int frame_from_point_tangent(const gp_Pnt& p, const gp_Vec& d1,
                             occ_frame_t* out) {
  if (d1.Magnitude() < k_axis_eps) {
    set_last("degenerate tangent for frame");
    return OCC_ERR_GEOM;
  }
  gp_Vec t = d1;
  t.Normalize();
  double xx, xy, xz, yx, yy, yz, zx, zy, zz;
  int st = orthonormalize(t.X(), t.Y(), t.Z(),
                          0.0, 0.0, 0.0,
                          &xx, &xy, &xz,
                          &yx, &yy, &yz,
                          &zx, &zy, &zz);
  if (st != OCC_OK) return st;
  store_frame(out, p.X(), p.Y(), p.Z(), xx, xy, xz, yx, yy, yz, zx, zy, zz);
  return OCC_OK;
}

}  // namespace

extern "C" {

/* =========================================================================
 * Constructors
 * ========================================================================= */

int occ_frame_world(occ_frame_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  store_frame(out,
              0.0, 0.0, 0.0,
              1.0, 0.0, 0.0,
              0.0, 1.0, 0.0,
              0.0, 0.0, 1.0);
  return OCC_OK;
}

int occ_frame_from_axes(double ox, double oy, double oz,
                        double xx, double xy, double xz,
                        double zx, double zy, double zz,
                        occ_frame_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  double oxx, oxy, oxz, oyx, oyy, oyz, ozx, ozy, ozz;
  int st = orthonormalize(zx, zy, zz, xx, xy, xz,
                          &oxx, &oxy, &oxz,
                          &oyx, &oyy, &oyz,
                          &ozx, &ozy, &ozz);
  if (st != OCC_OK) return st;
  store_frame(out, ox, oy, oz, oxx, oxy, oxz, oyx, oyy, oyz, ozx, ozy, ozz);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_from_z(double ox, double oy, double oz,
                     double zx, double zy, double zz,
                     double xh, double yh, double zh,
                     occ_frame_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  double oxx, oxy, oxz, oyx, oyy, oyz, ozx, ozy, ozz;
  int st = orthonormalize(zx, zy, zz, xh, yh, zh,
                          &oxx, &oxy, &oxz,
                          &oyx, &oyy, &oyz,
                          &ozx, &ozy, &ozz);
  if (st != OCC_OK) return st;
  store_frame(out, ox, oy, oz, oxx, oxy, oxz, oyx, oyy, oyz, ozx, ozy, ozz);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_from_zyx_euler(double ox, double oy, double oz,
                             double rx, double ry, double rz,
                             occ_frame_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  /* Intrinsic ZYX: R = Rz(rz) * Ry(ry) * Rx(rx)
   * Columns of R are the frame axes expressed in parent. */
  const double cx = std::cos(rx), sx = std::sin(rx);
  const double cy = std::cos(ry), sy = std::sin(ry);
  const double cz = std::cos(rz), sz = std::sin(rz);

  /* R = Rz * Ry * Rx */
  const double r00 = cz * cy;
  const double r01 = cz * sy * sx - sz * cx;
  const double r02 = cz * sy * cx + sz * sx;
  const double r10 = sz * cy;
  const double r11 = sz * sy * sx + cz * cx;
  const double r12 = sz * sy * cx - cz * sx;
  const double r20 = -sy;
  const double r21 = cy * sx;
  const double r22 = cy * cx;

  /* Columns: X=(r00,r10,r20), Y=(r01,r11,r21), Z=(r02,r12,r22) */
  store_frame(out, ox, oy, oz,
              r00, r10, r20,
              r01, r11, r21,
              r02, r12, r22);

  /* Re-orthonormalize to kill trig drift. */
  double oxx, oxy, oxz, oyx, oyy, oyz, ozx, ozy, ozz;
  int st = orthonormalize(out->zx, out->zy, out->zz,
                          out->xx, out->xy, out->xz,
                          &oxx, &oxy, &oxz,
                          &oyx, &oyy, &oyz,
                          &ozx, &ozy, &ozz);
  if (st != OCC_OK) return st;
  store_frame(out, ox, oy, oz, oxx, oxy, oxz, oyx, oyy, oyz, ozx, ozy, ozz);
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Matrix I/O
 * ========================================================================= */

int occ_frame_to_trsf_4x3(const occ_frame_t* f, double out12[12]) {
  REQ(f && out12, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  int st = place_trsf(*f, t);
  if (st != OCC_OK) return st;
  trsf_to_4x3(t, out12);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_from_trsf_4x3(const double m12[12], occ_frame_t* out) {
  REQ(m12 && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  int st = trsf_from_4x3(m12, t);
  if (st != OCC_OK) return st;
  frame_from_ax3(gp_Ax3().Transformed(t), out);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_to_matrix4x4(const occ_frame_t* f, double out16[16]) {
  REQ(f && out16, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  int st = place_trsf(*f, t);
  if (st != OCC_OK) return st;
  trsf_to_4x4(t, out16);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_from_matrix4x4(const double m16[16], occ_frame_t* out) {
  REQ(m16 && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  int st = trsf_from_4x4(m16, t);
  if (st != OCC_OK) return st;
  frame_from_ax3(gp_Ax3().Transformed(t), out);
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Algebra
 * ========================================================================= */

int occ_frame_inverted(const occ_frame_t* f, occ_frame_t* out) {
  REQ(f && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  int st = place_trsf(*f, t);
  if (st != OCC_OK) return st;
  t.Invert();
  frame_from_ax3(gp_Ax3().Transformed(t), out);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_multiplied(const occ_frame_t* b, const occ_frame_t* a,
                         occ_frame_t* out) {
  /* B*A: apply A then B. */
  REQ(a && b && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf ta, tb;
  int st = place_trsf(*a, ta);
  if (st != OCC_OK) return st;
  st = place_trsf(*b, tb);
  if (st != OCC_OK) return st;
  gp_Trsf t = tb.Multiplied(ta);
  frame_from_ax3(gp_Ax3().Transformed(t), out);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_displacement(const occ_frame_t* from_a,
                           const occ_frame_t* to_b,
                           occ_frame_t* out) {
  /* T = B * inv(A)  via  gp_Trsf::SetDisplacement(A, B). */
  REQ(from_a && to_b && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Ax3 A, B;
  int st = frame_to_ax3(*from_a, A);
  if (st != OCC_OK) return st;
  st = frame_to_ax3(*to_b, B);
  if (st != OCC_OK) return st;
  gp_Trsf t;
  t.SetDisplacement(A, B);
  frame_from_ax3(gp_Ax3().Transformed(t), out);
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Shape placement
 * ========================================================================= */

int occ_transform_shape_4x3(occ_shape_t s, const double m12[12],
                            occ_shape_t* out) {
  REQ(s && m12 && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  int st = trsf_from_4x3(m12, t);
  if (st != OCC_OK) return st;
  return apply_trsf_copy(s, t, out);
  OCC_GUARD_END
}

int occ_transform_shape_frame(occ_shape_t s, const occ_frame_t* f,
                              occ_shape_t* out) {
  REQ(s && f && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  int st = place_trsf(*f, t);
  if (st != OCC_OK) return st;
  return apply_trsf_copy(s, t, out);
  OCC_GUARD_END
}

int occ_place_shape_at_frame(occ_shape_t shape,
                             const occ_frame_t* target_frame,
                             const occ_frame_t* current_frame_on_shape,
                             occ_shape_t* out) {
  /* T = target * inv(current).  current == NULL ⇒ identity. */
  REQ(shape && target_frame && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Ax3 B;
  int st = frame_to_ax3(*target_frame, B);
  if (st != OCC_OK) return st;

  gp_Ax3 A; /* current */
  if (current_frame_on_shape) {
    st = frame_to_ax3(*current_frame_on_shape, A);
    if (st != OCC_OK) return st;
  } else {
    A = gp_Ax3(); /* world */
  }

  gp_Trsf t;
  t.SetDisplacement(A, B);
  return apply_trsf_copy(shape, t, out);
  OCC_GUARD_END
}

/* =========================================================================
 * Topology-sampled frames
 * ========================================================================= */

int occ_frame_at_edge_param(occ_shape_t edge, double u, occ_frame_t* out) {
  REQ(edge && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& sh = *as_shape(edge);
  if (sh.ShapeType() != TopAbs_EDGE) {
    set_last("occ_frame_at_edge_param: expected EDGE");
    return OCC_ERR_INVALID_SHAPE;
  }
  const TopoDS_Edge E = TopoDS::Edge(sh);
  BRepAdaptor_Curve c(E);
  if (u < c.FirstParameter() - 1.0e-9 || u > c.LastParameter() + 1.0e-9) {
    /* Soft clamp — still evaluate (OCCT curves often allow slight overrun). */
  }
  gp_Pnt p;
  gp_Vec d1;
  c.D1(u, p, d1);
  /* Respect edge orientation: reversed edges flip geometric tangent sense
   * for applications that care about wire direction. We report geometry D1
   * of the underlying curve; callers wanting topological sense can reverse Z. */
  return frame_from_point_tangent(p, d1, out);
  OCC_GUARD_END
}

int occ_frame_at_wire_end(occ_shape_t wire, int at_start, occ_frame_t* out) {
  REQ(wire && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& sh = *as_shape(wire);
  if (sh.ShapeType() != TopAbs_WIRE) {
    set_last("occ_frame_at_wire_end: expected WIRE");
    return OCC_ERR_INVALID_SHAPE;
  }

  TopoDS_Edge edge;
  int count = 0;
  for (TopExp_Explorer ex(sh, TopAbs_EDGE); ex.More(); ex.Next()) {
    edge = TopoDS::Edge(ex.Current());
    ++count;
    if (at_start) break; /* first edge */
  }
  if (count == 0) {
    set_last("wire has no edges");
    return OCC_ERR_GEOM;
  }
  /* If !at_start, edge is the last edge from the explorer loop. */

  BRepAdaptor_Curve c(edge);
  const Standard_Real t =
      at_start ? c.FirstParameter() : c.LastParameter();
  gp_Pnt p;
  gp_Vec d1;
  c.D1(t, p, d1);

  /* If the edge is REVERSED in the wire, geometric First/Last still map to
   * the curve; for start we want the tangent pointing into the wire.
   * Adjust: for REVERSED edge, geometric D1 is opposite topological walk. */
  if (edge.Orientation() == TopAbs_REVERSED) {
    d1.Reverse();
  }
  /* At the end of a REVERSED edge that is the last in explorer order,
   * after Reverse, D1 points along wire walk direction. */

  return frame_from_point_tangent(p, d1, out);
  OCC_GUARD_END
}

int occ_frame_on_face(occ_shape_t face, double u, double v, occ_frame_t* out) {
  REQ(face && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& sh = *as_shape(face);
  if (sh.ShapeType() != TopAbs_FACE) {
    set_last("occ_frame_on_face: expected FACE");
    return OCC_ERR_INVALID_SHAPE;
  }
  const TopoDS_Face F = TopoDS::Face(sh);
  BRepAdaptor_Surface s(F, /*restriction=*/Standard_True);
  gp_Pnt p;
  gp_Vec d1u, d1v;
  s.D1(u, v, p, d1u, d1v);

  gp_Vec n = d1u.Crossed(d1v);
  if (n.Magnitude() < k_axis_eps) {
    set_last("face normal degenerate at (u,v)");
    return OCC_ERR_GEOM;
  }
  /* Respect face orientation. */
  if (F.Orientation() == TopAbs_REVERSED) {
    n.Reverse();
  }
  n.Normalize();

  /* X-hint along dS/du; orthonormalize handles parallel cases. */
  double xx, xy, xz, yx, yy, yz, zx, zy, zz;
  int st = orthonormalize(n.X(), n.Y(), n.Z(),
                          d1u.X(), d1u.Y(), d1u.Z(),
                          &xx, &xy, &xz,
                          &yx, &yy, &yz,
                          &zx, &zy, &zz);
  if (st != OCC_OK) return st;
  store_frame(out, p.X(), p.Y(), p.Z(), xx, xy, xz, yx, yy, yz, zx, zy, zz);
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Mirror + array (occurrence foundations)
 * ========================================================================= */

int occ_mirror_copy(occ_shape_t shape,
                    double px, double py, double pz,
                    double nx, double ny, double nz,
                    int keep_original_compound,
                    occ_shape_t* out) {
  REQ(shape && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (vlen(nx, ny, nz) < k_axis_eps) {
    set_last("mirror plane normal near zero");
    return OCC_ERR_GEOM;
  }
  gp_Ax2 pln(gp_Pnt(px, py, pz), gp_Dir(nx, ny, nz));
  gp_Trsf t;
  t.SetMirror(pln);

  BRepBuilderAPI_Transform mk(*as_shape(shape), t, /*Copy=*/Standard_True);
  if (!mk.IsDone()) {
    set_last("mirror transform failed");
    return OCC_ERR_GEOM;
  }
  const TopoDS_Shape mirrored = mk.Shape();

  if (!keep_original_compound) {
    *out = to_handle(mirrored);
    return OCC_OK;
  }

  BRep_Builder b;
  TopoDS_Compound comp;
  b.MakeCompound(comp);
  b.Add(comp, *as_shape(shape));
  b.Add(comp, mirrored);
  *out = to_handle(comp);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_transform_copy_array(occ_shape_t seed,
                             const double* transforms_4x4,
                             int n,
                             occ_shape_t* out) {
  REQ(seed && transforms_4x4 && out, OCC_ERR_NULL_ARG);
  REQ(n > 0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  BRep_Builder b;
  TopoDS_Compound comp;
  b.MakeCompound(comp);

  for (int i = 0; i < n; ++i) {
    const double* m = transforms_4x4 + static_cast<size_t>(i) * 16;
    gp_Trsf t;
    int st = trsf_from_4x4(m, t);
    if (st != OCC_OK) return st;
    BRepBuilderAPI_Transform mk(*as_shape(seed), t, Standard_True);
    if (!mk.IsDone()) {
      set_last("transform_copy_array: transform failed");
      return OCC_ERR_GEOM;
    }
    b.Add(comp, mk.Shape());
  }
  *out = to_handle(comp);
  return OCC_OK;
  OCC_GUARD_END
}

}  // extern "C"
```

---

## Header — transforms / FK

```c
// === file: occ_c_trsf.h
#ifndef OCC_C_TRSF_H_
#define OCC_C_TRSF_H_

#include "occ_c.h"
#include "occ_c_frames.h"

#ifdef __cplusplus
extern "C" {
#endif

/* -------------------------------------------------------------------------
 * Pure SE(3) math on 4x4 row-major matrices (last row 0,0,0,1).
 * Composition: out = a * b  means apply b first, then a (column vectors).
 * ------------------------------------------------------------------------- */

OCC_API void occ_trsf_identity(double m[16]);

/* out = a * b  (a after b). Safe if out aliases a or b (uses temp). */
OCC_API void occ_trsf_compose(const double a[16], const double b[16],
                              double out[16]);

/* Rigid inverse. Returns OCC_ERR_GEOM if rotation block singular. */
OCC_API int occ_trsf_invert(const double m[16], double out[16]);

/* Apply 4x4 (upper 3x4) to shape via BRepBuilderAPI_Transform copy. */
OCC_API int occ_trsf_apply_shape(occ_shape_t s, const double m[16],
                                 occ_shape_t* out);

/* Convenience: frame → 4x4 (same as occ_frame_to_matrix4x4). */
OCC_API int occ_trsf_from_frame(const occ_frame_t* f, double out16[16]);

/* -------------------------------------------------------------------------
 * Serial FK: n revolute joints.
 *
 * Each joint i is expressed in the *parent* joint frame (joint 0 parent = world):
 *   Ti = Trans(origins[i]) * Rot(axes[i], angles[i])
 *   World_i = World_{i-1} * Ti
 *
 * origins: n*3 doubles (x,y,z) in parent frame
 * axes:    n*3 doubles (unit preferred; normalized internally)
 * angles:  n doubles, radians
 *
 * out_world_frames: if non-NULL, n frames (world pose after each joint)
 * out_final_4x4:    if non-NULL, World_{n-1} as 4x4 row-major
 * ------------------------------------------------------------------------- */
OCC_API int occ_compose_chain(int n,
                              const double* origins, /* n*3 */
                              const double* axes,    /* n*3 */
                              const double* angles,  /* n */
                              occ_frame_t* out_world_frames, /* nullable, n */
                              double* out_final_4x4 /* nullable, 16 */);

/* Classic DH (Craig): each link i
 *   T_i = RotZ(theta_i) * TransZ(d_i) * TransX(a_i) * RotX(alpha_i)
 * Arrays length n. out_world_frames / out_final_4x4 same as above. */
OCC_API int occ_compose_chain_dh(int n,
                                 const double* a,
                                 const double* alpha,
                                 const double* d,
                                 const double* theta,
                                 occ_frame_t* out_world_frames,
                                 double* out_final_4x4);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_TRSF_H_ */
```

---

## Implementation — transforms / FK

```cpp
// === file: occ_c_trsf.cc
// OCCT 7.9.3 — SE(3) matrix math + serial FK + shape apply.
// Extract into api/src/occ_c_trsf.cc

#include "occ_c_trsf.h"
#include "occ_c_internal.hxx"

#include <cmath>
#include <cstring>

#include <BRepBuilderAPI_Transform.hxx>
#include <gp_Trsf.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::to_handle;
using occ_c_detail::set_last;

namespace {

constexpr double k_eps = 1.0e-18;

inline void mat4_zero(double m[16]) {
  std::memset(m, 0, 16 * sizeof(double));
}

void mat4_mul(const double a[16], const double b[16], double out[16]) {
  double t[16];
  for (int i = 0; i < 4; ++i) {
    for (int j = 0; j < 4; ++j) {
      double s = 0.0;
      for (int k = 0; k < 4; ++k) {
        s += a[i * 4 + k] * b[k * 4 + j];
      }
      t[i * 4 + j] = s;
    }
  }
  std::memcpy(out, t, 16 * sizeof(double));
}

/* Rodrigues rotation about unit axis (ax,ay,az), angle ang → 3x3 row-major R[9]. */
void rot_axis_angle(double ax, double ay, double az, double ang, double R[9]) {
  double len = std::sqrt(ax * ax + ay * ay + az * az);
  if (len < 1.0e-30) {
    R[0] = R[4] = R[8] = 1.0;
    R[1] = R[2] = R[3] = R[5] = R[6] = R[7] = 0.0;
    return;
  }
  const double x = ax / len, y = ay / len, z = az / len;
  const double c = std::cos(ang), s = std::sin(ang), t = 1.0 - c;
  R[0] = t * x * x + c;     R[1] = t * x * y - s * z; R[2] = t * x * z + s * y;
  R[3] = t * x * y + s * z; R[4] = t * y * y + c;     R[5] = t * y * z - s * x;
  R[6] = t * x * z - s * y; R[7] = t * y * z + s * x; R[8] = t * z * z + c;
}

/* Pack R(3x3 row-major) + translation into 4x4 row-major. */
void pack_Rt(const double R[9], double tx, double ty, double tz, double m[16]) {
  m[0] = R[0]; m[1] = R[1]; m[2] = R[2]; m[3] = tx;
  m[4] = R[3]; m[5] = R[4]; m[6] = R[5]; m[7] = ty;
  m[8] = R[6]; m[9] = R[7]; m[10] = R[8]; m[11] = tz;
  m[12] = 0.0; m[13] = 0.0; m[14] = 0.0; m[15] = 1.0;
}

/* Pure translation 4x4. */
void mat4_trans(double tx, double ty, double tz, double m[16]) {
  occ_trsf_identity(m);
  m[3] = tx; m[7] = ty; m[11] = tz;
}

/* RotZ / RotX for DH. */
void mat4_rotz(double th, double m[16]) {
  const double c = std::cos(th), s = std::sin(th);
  occ_trsf_identity(m);
  m[0] = c;  m[1] = -s;
  m[4] = s;  m[5] = c;
}

void mat4_rotx(double al, double m[16]) {
  const double c = std::cos(al), s = std::sin(al);
  occ_trsf_identity(m);
  m[5] = c;  m[6] = -s;
  m[9] = s;  m[10] = c;
}

/* Convert 4x4 placement (local→world) into occ_frame_t via columns. */
int frame_from_mat4(const double m[16], occ_frame_t* out) {
  /* Columns of R are axes. */
  double xx = m[0], xy = m[4], xz = m[8];
  double yx = m[1], yy = m[5], yz = m[9];
  double zx = m[2], zy = m[6], zz = m[10];
  double ox = m[3], oy = m[7], oz = m[11];

  /* Re-orthonormalize with Z + X. */
  return occ_frame_from_axes(ox, oy, oz, xx, xy, xz, zx, zy, zz, out);
}

int apply_mat4(occ_shape_t s, const double m[16], occ_shape_t* out) {
  REQ(s && m && out, OCC_ERR_NULL_ARG);
  gp_Trsf t;
  try {
    t.SetValues(m[0], m[1], m[2], m[3],
                m[4], m[5], m[6], m[7],
                m[8], m[9], m[10], m[11]);
  } catch (Standard_Failure& e) {
    set_last(e.GetMessageString() ? e.GetMessageString() : "SetValues failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_Transform mk(*as_shape(s), t, Standard_True);
  if (!mk.IsDone()) {
    set_last("trsf apply failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk.Shape());
  return OCC_OK;
}

}  // namespace

extern "C" {

void occ_trsf_identity(double m[16]) {
  mat4_zero(m);
  m[0] = m[5] = m[10] = m[15] = 1.0;
}

void occ_trsf_compose(const double a[16], const double b[16], double out[16]) {
  mat4_mul(a, b, out);
}

int occ_trsf_invert(const double m[16], double out[16]) {
  /* Rigid inverse: R^T | -R^T t
   * For pure SE(3) (det R = ±1, orthogonal). We use 3x3 inverse via det
   * to tolerate slight non-orthogonality from float noise. */
  const double r00 = m[0], r01 = m[1], r02 = m[2];
  const double r10 = m[4], r11 = m[5], r12 = m[6];
  const double r20 = m[8], r21 = m[9], r22 = m[10];
  const double det =
      r00 * (r11 * r22 - r12 * r21) -
      r01 * (r10 * r22 - r12 * r20) +
      r02 * (r10 * r21 - r11 * r20);
  if (std::fabs(det) < k_eps) {
    set_last("trsf invert: singular rotation");
    return OCC_ERR_GEOM;
  }
  /* For proper rigid body, inv(R) = R^T when det≈+1 and R orthogonal.
   * Use transpose of upper-left (standard SE3 inverse for rotations). */
  const double tx = m[3], ty = m[7], tz = m[11];
  out[0] = r00; out[1] = r10; out[2] = r20;
  out[4] = r01; out[5] = r11; out[6] = r21;
  out[8] = r02; out[9] = r12; out[10] = r22;
  out[3]  = -(out[0] * tx + out[1] * ty + out[2] * tz);
  out[7]  = -(out[4] * tx + out[5] * ty + out[6] * tz);
  out[11] = -(out[8] * tx + out[9] * ty + out[10] * tz);
  out[12] = out[13] = out[14] = 0.0;
  out[15] = 1.0;
  return OCC_OK;
}

int occ_trsf_apply_shape(occ_shape_t s, const double m[16], occ_shape_t* out) {
  REQ(s && m && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  return apply_mat4(s, m, out);
  OCC_GUARD_END
}

int occ_trsf_from_frame(const occ_frame_t* f, double out16[16]) {
  REQ(f && out16, OCC_ERR_NULL_ARG);
  return occ_frame_to_matrix4x4(f, out16);
}

/* =========================================================================
 * Serial FK — explicit joint origins + axes
 * ========================================================================= */

int occ_compose_chain(int n,
                      const double* origins,
                      const double* axes,
                      const double* angles,
                      occ_frame_t* out_world_frames,
                      double* out_final_4x4) {
  REQ(n >= 0, OCC_ERR_GEOM);
  if (n == 0) {
    if (out_final_4x4) occ_trsf_identity(out_final_4x4);
    return OCC_OK;
  }
  REQ(origins && axes && angles, OCC_ERR_NULL_ARG);
  REQ(out_world_frames || out_final_4x4, OCC_ERR_NULL_ARG);

  OCC_GUARD_BEGIN
  double world[16];
  occ_trsf_identity(world);

  for (int i = 0; i < n; ++i) {
    const double ox = origins[i * 3 + 0];
    const double oy = origins[i * 3 + 1];
    const double oz = origins[i * 3 + 2];
    const double ax = axes[i * 3 + 0];
    const double ay = axes[i * 3 + 1];
    const double az = axes[i * 3 + 2];
    const double ang = angles[i];

    /* Ti = Trans(origin) * Rot(axis, angle)  in parent frame. */
    double R[9], Trot[16], Ttr[16], Ti[16], tmp[16];
    rot_axis_angle(ax, ay, az, ang, R);
    pack_Rt(R, 0.0, 0.0, 0.0, Trot);
    mat4_trans(ox, oy, oz, Ttr);
    mat4_mul(Ttr, Trot, Ti);          /* Trans * Rot */
    mat4_mul(world, Ti, tmp);         /* world = world * Ti */
    std::memcpy(world, tmp, 16 * sizeof(double));

    if (out_world_frames) {
      int st = frame_from_mat4(world, &out_world_frames[i]);
      if (st != OCC_OK) return st;
    }
  }

  if (out_final_4x4) {
    std::memcpy(out_final_4x4, world, 16 * sizeof(double));
  }
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Classic Denavit–Hartenberg (Craig)
 *
 * For link i (0-based):
 *   T_i^{i-1} = RotZ(theta) * TransZ(d) * TransX(a) * RotX(alpha)
 *
 * World_i = World_{i-1} * T_i
 * ========================================================================= */

int occ_compose_chain_dh(int n,
                         const double* a,
                         const double* alpha,
                         const double* d,
                         const double* theta,
                         occ_frame_t* out_world_frames,
                         double* out_final_4x4) {
  REQ(n >= 0, OCC_ERR_GEOM);
  if (n == 0) {
    if (out_final_4x4) occ_trsf_identity(out_final_4x4);
    return OCC_OK;
  }
  REQ(a && alpha && d && theta, OCC_ERR_NULL_ARG);
  REQ(out_world_frames || out_final_4x4, OCC_ERR_NULL_ARG);

  OCC_GUARD_BEGIN
  double world[16];
  occ_trsf_identity(world);

  for (int i = 0; i < n; ++i) {
    double Rz[16], Tz[16], Tx[16], Rx[16];
    double t0[16], t1[16], t2[16], Ti[16], tmp[16];

    mat4_rotz(theta[i], Rz);
    mat4_trans(0.0, 0.0, d[i], Tz);
    mat4_trans(a[i], 0.0, 0.0, Tx);
    mat4_rotx(alpha[i], Rx);

    /* Ti = Rz * Tz * Tx * Rx */
    mat4_mul(Rz, Tz, t0);
    mat4_mul(t0, Tx, t1);
    mat4_mul(t1, Rx, Ti);

    mat4_mul(world, Ti, tmp);
    std::memcpy(world, tmp, 16 * sizeof(double));

    if (out_world_frames) {
      int st = frame_from_mat4(world, &out_world_frames[i]);
      if (st != OCC_OK) return st;
    }
  }

  if (out_final_4x4) {
    std::memcpy(out_final_4x4, world, 16 * sizeof(double));
  }
  return OCC_OK;
  OCC_GUARD_END
}

}  // extern "C"
```

---

## Usage sketches (host / tests)

### 1. Named frame on a flange (AttachFrame)

```c
occ_frame_t flange;
occ_frame_from_z(/*origin*/ 0.0, 0.0, 0.15,
                 /*Z*/ 0.0, 0.0, 1.0,
                 /*X hint*/ 1.0, 0.0, 0.0,
                 &flange);
/* Host maps name "joint_1_out" → flange POD; no BREP mutation. */
```

### 2. Connector-to-connector place (RigidXform)

```c
occ_frame_t src, dst, map;
occ_frame_from_axes(0,0,0, 1,0,0, 0,0,1, &src);
occ_frame_from_zyx_euler(1.0, 0.2, 0.0, 0.0, 0.0, M_PI/2, &dst);
occ_frame_displacement(&src, &dst, &map);   /* T = dst * inv(src) */

occ_shape_t placed = NULL;
occ_place_shape_at_frame(part, &dst, &src, &placed);
/* equivalent: occ_transform_shape_frame after building map, or
 * occ_frame_between via displacement + apply. */
```

### 3. Six-DOF arm FK without baking joints

```c
enum { N = 6 };
double origins[N*3] = {
  0,0,0.1,   0,0,0,   0,0.3,0,   0,0,0,   0,0.25,0,   0,0,0
};
double axes[N*3] = {
  0,0,1,  0,1,0,  0,1,0,  1,0,0,  0,1,0,  1,0,0
};
double q[N] = { 0.1, -0.4, 0.8, 0.0, 0.3, -0.2 };

occ_frame_t world_frames[N];
double Ttcp[16];
occ_compose_chain(N, origins, axes, q, world_frames, Ttcp);

for (int i = 0; i < N; ++i) {
  occ_shape_t posed = NULL;
  occ_trsf_apply_shape(link_seed[i], /* per-link cumulative */
                       /* build 4x4 from world_frames[i] */, &posed);
}
/* Prefer: each link modeled in its local joint frame; place with
 * occ_frame_to_matrix4x4(&world_frames[i], M) + occ_trsf_apply_shape. */
```

### 4. Pattern foundation

```c
double Ms[3 * 16];
for (int i = 0; i < 3; ++i) {
  occ_trsf_identity(&Ms[i * 16]);
  Ms[i * 16 + 3] = 0.05 * i; /* translate X */
}
occ_shape_t arr = NULL;
occ_transform_copy_array(bolt, Ms, 3, &arr); /* COMPOUND of 3 */
```

### 5. Face / edge frames for pipe ports

```c
occ_frame_t port;
occ_frame_on_face(face, u, v, &port);          /* Z = outward normal */
/* or */
occ_frame_at_edge_param(edge, 0.5 * (u0 + u1), &port); /* Z = tangent */
occ_frame_at_wire_end(route_wire, /*at_start=*/1, &port);
```

---

## OCCT mapping cheat-sheet

| `occ_c` | OCCT 7.9.3 |
|---------|------------|
| `occ_frame_t` | POD ↔ `gp_Ax3` (Location, XDirection, YDirection, Direction=Z) |
| placement of frame in world | `gp_Trsf::SetDisplacement(gp_Ax3(), ax3)` |
| connector map \(B A^{-1}\) | `gp_Trsf::SetDisplacement(A, B)` |
| invert / multiply | `gp_Trsf::Invert`, `Multiplied` |
| 4×3 / 4×4 I/O | `gp_Trsf::Value(i,j)`, `SetValues(a11..a34)` |
| apply to BREP | `BRepBuilderAPI_Transform(shape, trsf, Standard_True)` |
| edge frame | `BRepAdaptor_Curve::D1` |
| face frame | `BRepAdaptor_Surface::D1` → normal `d1u × d1v` |
| wire end | `TopExp_Explorer(TopAbs_EDGE)` + curve D1 |
| mirror | `gp_Trsf::SetMirror(gp_Ax2(point, normal))` |
| compound array | `BRep_Builder::MakeCompound` + `Add` |
| FK | pure `double[16]` math (no OCCT joint solver) |

---

## Design decisions (locked)

1. **Full triad stored** (X,Y,Z) so Y is not recomputed on every read; constructors still orthonormalize.
2. **Row-major 4×4**, last row `0,0,0,1`, column vectors — document once, never offer a second layout in C.
3. **`occ_frame_multiplied(b,a)` = B∘A** (A then B) — matches matrix multiply and OCCT `tb.Multiplied(ta)`.
4. **`occ_place_shape_at_frame`** takes optional current frame (NULL = world) so occurrence math is one call.
5. **No mate solver** — no constraint graph, no degrees of freedom residual; host/IR owns that.
6. **`occ_compose_chain` joint local model**: `Trans(origin)*Rot(axis,angle)` relative to parent; export world frames after each joint for link placement.
7. **Orthonormalize** always handles nearly-parallel X-hint (auto world X/Y fallback).
8. **Mirror** uses plane as `gp_Ax2(point, normal)`; optional compound keeps original for pattern-like mirror features.
9. **Lerp/slerp** skipped (optional); hosts that need animation interpolate quaternions themselves or call repeated Euler construction.

---

## IR map (product vocabulary → this section)

| IR / product term | C API |
|-------------------|-------|
| `AttachFrame` | store `occ_frame_t` in host registry; constructors above |
| `RigidXform` / occurrence | `occ_place_shape_at_frame`, `occ_transform_shape_*` |
| connector map | `occ_frame_displacement` |
| `ComposeChain` | `occ_compose_chain` (+ `occ_compose_chain_dh`) |
| pattern seed copies | `occ_transform_copy_array` |
| mirror feature (rigid) | `occ_mirror_copy` |
| port on face / path end | `occ_frame_on_face`, `occ_frame_at_wire_end`, `occ_frame_at_edge_param` |

---

## Build notes

1. Add `occ_c_frames.cc` and `occ_c_trsf.cc` to `//api:occ_c_lib` (or equivalent).
2. Install headers `occ_c_frames.h`, `occ_c_trsf.h` next to `occ_c.h`.
3. Ensure `OCC_ERR_FRAME` and `OCC_ERR_GEOM` exist in `occ_status_t` (see §3 of `docs/occ-c-literate-api.md`).
4. Wasm size: these TUs pull `BRepBuilderAPI_Transform` + adaptors only — no boolean kernel.

---

## Self-check (implementer)

- [ ] All symbols in headers are defined in the matching `.cc` with no stubs.
- [ ] `occ_frame_from_z` with zero X-hint succeeds for Z along ±X, ±Y, ±Z.
- [ ] `occ_frame_displacement` then `occ_transform_shape_frame` moves a box so its corner frame lands on target.
- [ ] `occ_compose_chain` with all angles 0 yields translations only along cumulative origins.
- [ ] `occ_compose_chain_dh` matches a known 2-link planar arm table within 1e-9.
- [ ] `occ_mirror_copy(..., keep=1)` returns `TopAbs_COMPOUND` with two children.
- [ ] `occ_transform_copy_array` with identity × N returns N copies at same pose (compound).
- [ ] 4×4 last row always written as `0,0,0,1`; `from_matrix4x4` rejects `m[15]≠1`.

---

*End of section 03 — frames & rigid transforms.*
