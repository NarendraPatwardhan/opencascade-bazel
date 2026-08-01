// occ_c.h — C API over OCCT, modeled on build123d's public surface.
// All exports use extern "C" linkage and return int (0 = OCC_OK).
// Shapes are owning handles; pass to occ_shape_free when done.
//
// Expansion modules (session, construct, frames, route, …) are included
// at the bottom so a single #include "occ_c.h" exposes the full surface.
// Prefer #include "occ_c_all.h" for explicit one-stop inclusion.

#ifndef OCC_C_H_
#define OCC_C_H_

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#if defined(_WIN32)
#define OCC_API __declspec(dllexport)
#else
#define OCC_API __attribute__((visibility("default")))
#endif

typedef struct occ_shape_s* occ_shape_t;
typedef struct occ_mesh_s*  occ_mesh_t;

typedef enum {
  OCC_OK                = 0,
  OCC_ERR_NULL_ARG      = 1,
  OCC_ERR_INVALID_SHAPE = 2,
  OCC_ERR_BOOLEAN       = 3,
  OCC_ERR_FILLET        = 4,
  OCC_ERR_IO            = 5,
  OCC_ERR_INDEX         = 6,
  OCC_ERR_EXCEPTION     = 7,
  /* v2 expansions — keep 0–7 numeric-stable */
  OCC_ERR_NO_SESSION    = 8,
  OCC_ERR_UNKNOWN_OP    = 9,
  OCC_ERR_BAD_QUERY     = 10,
  OCC_ERR_CAPACITY      = 11,
  OCC_ERR_NOT_FOUND     = 12,
  OCC_ERR_MATH          = 13,
  OCC_ERR_UNSUPPORTED   = 14,
  OCC_ERR_GEOM          = 15,
  OCC_ERR_FRAME         = 16,
  OCC_ERR_CLASH         = 17,
  OCC_ERR_BUILD         = 18,
} occ_status_t;

typedef enum {
  OCC_SHAPE_UNKNOWN   = 0,
  OCC_SHAPE_COMPOUND  = 1,
  OCC_SHAPE_COMPSOLID = 2,
  OCC_SHAPE_SOLID     = 3,
  OCC_SHAPE_SHELL     = 4,
  OCC_SHAPE_FACE      = 5,
  OCC_SHAPE_WIRE      = 6,
  OCC_SHAPE_EDGE      = 7,
  OCC_SHAPE_VERTEX    = 8,
  OCC_SHAPE_SHAPE     = 9,
} occ_shape_kind_t;

typedef enum {
  OCC_CLASH_SEPARATED = 0,
  OCC_CLASH_CLEARANCE = 1,
  OCC_CLASH_INTERFERE = 2,
} occ_clash_status_t;

OCC_API const char* occ_version(void);
OCC_API const char* occ_last_error(void);

OCC_API void        occ_shape_free(occ_shape_t s);
OCC_API occ_shape_t occ_shape_copy(occ_shape_t s);
OCC_API int         occ_shape_is_null(occ_shape_t s);

/* ---- Primitives (build123d: Box, Cylinder, Sphere, Cone, Torus, Wedge) ---- */
OCC_API int occ_make_box(double dx, double dy, double dz, occ_shape_t* out);
OCC_API int occ_make_cylinder(double cx, double cy, double cz,
                              double ax, double ay, double az,
                              double radius, double height,
                              occ_shape_t* out);
OCC_API int occ_make_sphere(double cx, double cy, double cz, double radius,
                            occ_shape_t* out);
OCC_API int occ_make_cone(double cx, double cy, double cz,
                          double ax, double ay, double az,
                          double r1, double r2, double height,
                          occ_shape_t* out);
OCC_API int occ_make_torus(double cx, double cy, double cz,
                           double ax, double ay, double az,
                           double major_r, double minor_r,
                           occ_shape_t* out);
OCC_API int occ_make_wedge(double dx, double dy, double dz, double ltx,
                           occ_shape_t* out);

/* ---- Booleans ---- */
OCC_API int occ_fuse(occ_shape_t a, occ_shape_t b, occ_shape_t* out);
OCC_API int occ_cut(occ_shape_t a, occ_shape_t b, occ_shape_t* out);
OCC_API int occ_intersect(occ_shape_t a, occ_shape_t b, occ_shape_t* out);
OCC_API int occ_section(occ_shape_t a, occ_shape_t b, occ_shape_t* out);

/* ---- Features ---- */
OCC_API int occ_fillet_all(occ_shape_t s, double radius, occ_shape_t* out);
OCC_API int occ_fillet_edges(occ_shape_t s, const int* edge_idx, int n,
                             double radius, occ_shape_t* out);
OCC_API int occ_chamfer_all(occ_shape_t s, double distance, occ_shape_t* out);
OCC_API int occ_chamfer_edges(occ_shape_t s, const int* edge_idx, int n,
                              double distance, occ_shape_t* out);
OCC_API int occ_shell(occ_shape_t s, const int* face_idx, int n,
                      double thickness, occ_shape_t* out);
OCC_API int occ_offset_3d(occ_shape_t s, double offset, occ_shape_t* out);

/* ---- Sweeps ---- */
OCC_API int occ_extrude(occ_shape_t profile,
                        double dx, double dy, double dz,
                        occ_shape_t* out);
OCC_API int occ_revolve(occ_shape_t profile,
                        double px, double py, double pz,
                        double ax, double ay, double az,
                        double angle_rad,
                        occ_shape_t* out);
OCC_API int occ_loft(const occ_shape_t* profiles, int n, int solid,
                     occ_shape_t* out);
OCC_API int occ_pipe(occ_shape_t profile, occ_shape_t spine,
                     occ_shape_t* out);

/* ---- Transforms ---- */
OCC_API int occ_translate(occ_shape_t s, double dx, double dy, double dz,
                          occ_shape_t* out);
OCC_API int occ_rotate(occ_shape_t s,
                       double px, double py, double pz,
                       double ax, double ay, double az,
                       double angle_rad, occ_shape_t* out);
OCC_API int occ_scale(occ_shape_t s,
                      double cx, double cy, double cz, double factor,
                      occ_shape_t* out);
OCC_API int occ_mirror(occ_shape_t s,
                       double px, double py, double pz,
                       double nx, double ny, double nz,
                       occ_shape_t* out);

/* ---- Measurement ---- */
OCC_API int occ_volume(occ_shape_t s, double* out);
OCC_API int occ_surface_area(occ_shape_t s, double* out);
OCC_API int occ_center_of_mass(occ_shape_t s, double out_xyz[3]);
OCC_API int occ_bbox(occ_shape_t s, double out_min[3], double out_max[3]);

/* ---- Topology (1-based indices, match build123d) ---- */
OCC_API int occ_count_faces(occ_shape_t s, int* out);
OCC_API int occ_count_edges(occ_shape_t s, int* out);
OCC_API int occ_count_vertices(occ_shape_t s, int* out);
OCC_API int occ_face_at(occ_shape_t s, int idx, occ_shape_t* out);
OCC_API int occ_edge_at(occ_shape_t s, int idx, occ_shape_t* out);
OCC_API int occ_vertex_xyz(occ_shape_t s, int idx, double out_xyz[3]);

/* ---- Import / Export ---- */
OCC_API int occ_step_write(occ_shape_t s, const char* path);
OCC_API int occ_step_read(const char* path, occ_shape_t* out);
OCC_API int occ_brep_write(occ_shape_t s, const char* path);
OCC_API int occ_brep_read(const char* path, occ_shape_t* out);
OCC_API int occ_stl_write(occ_shape_t s, const char* path, double linear_deflection);
OCC_API int occ_gltf_write(occ_shape_t s, const char* path, double linear_deflection);
OCC_API int occ_obj_write(occ_shape_t s, const char* path, double linear_deflection);
OCC_API int occ_obj_read(const char* path, occ_shape_t* out);

/* ---- Mesh (for external visualizers) ---- */
OCC_API int  occ_mesh_compute(occ_shape_t s, double linear_deflection, occ_mesh_t* out);
OCC_API int  occ_mesh_vertex_count(occ_mesh_t m, int* out);
OCC_API int  occ_mesh_index_count(occ_mesh_t m, int* out);
OCC_API int  occ_mesh_vertices(occ_mesh_t m, const float** xyz);
OCC_API int  occ_mesh_normals(occ_mesh_t m, const float** nxyz);
OCC_API int  occ_mesh_indices(occ_mesh_t m, const int32_t** idx);
OCC_API void occ_mesh_free(occ_mesh_t m);

#ifdef __cplusplus
}  // extern "C"
#endif

/* Expansion modules are NOT included here (avoids circular includes when a
 * module header does #include "occ_c.h"). Use occ_c_all.h for the full surface. */

#endif  // OCC_C_H_
