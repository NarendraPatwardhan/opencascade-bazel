#include <stdlib.h>
#include "occ_c_all.h"
#include "occ_c_session.h"
#include <stdio.h>
#include <string.h>

int main(void) {
  occ_session_t* S = NULL;
  if (occ_session_create(&S) != OCC_OK) return 1;

  if (occ_session_ensure_world_planes(S) != OCC_OK) {
    fprintf(stderr, "planes: %s\n", occ_last_error());
    return 1;
  }
  occ_entity_id_t xy = 0;
  occ_session_world_plane_xy(S, &xy);
  printf("world_xy entity=%llu\n", (unsigned long long)xy);

  /* Fake: make a box with baseline API then register under op id */
  occ_shape_t box = NULL;
  if (occ_make_box(0.1, 0.06, 0.08, &box) != OCC_OK) {
    fprintf(stderr, "box: %s\n", occ_last_error());
    return 1;
  }

  occ_session_begin_op(S, "box1/solid");
  occ_entity_id_t root = 0;
  if (occ_session_register_shape(S, box, &root) != OCC_OK) {
    fprintf(stderr, "reg: %s\n", occ_last_error());
    return 1;
  }
  occ_session_set_name(S, root, "box1_body");
  occ_session_end_op(S, "box1/solid");

  char opbuf[128];
  occ_session_entity_op_id(S, root, opbuf, (int)sizeof(opbuf));
  printf("root id=%llu created_by=%s\n", (unsigned long long)root, opbuf);

  occ_entity_id_t faces[128];
  int nf = 0;
  int st = occ_query_created_by(S, "box1/solid", OCC_ENTITY_FACE, faces, 128, &nf);
  if (st != OCC_OK && st != OCC_ERR_CAPACITY) {
    fprintf(stderr, "query: %s\n", occ_last_error());
    return 1;
  }
  printf("faces created_by box1/solid: %d\n", nf);

  occ_entity_id_t bodies[8];
  int nb = 0;
  occ_query_created_by(S, "box1/solid", OCC_ENTITY_BODY, bodies, 8, &nb);
  printf("bodies: %d (expect 1)\n", nb);

  occ_entity_id_t by_name = 0;
  if (occ_session_find_by_name(S, "box1_body", &by_name) != OCC_OK ||
      by_name != root) {
    fprintf(stderr, "name lookup failed\n");
    return 1;
  }

  occ_session_frame_t tcp;
  memset(&tcp, 0, sizeof(tcp));
  tcp.x[0] = 1; tcp.y[1] = 1; tcp.z[2] = 1;
  tcp.origin[2] = 0.08;
  if (occ_session_attach_frame(S, root, "tcp", &tcp) != OCC_OK) {
    fprintf(stderr, "frame: %s\n", occ_last_error());
    return 1;
  }
  occ_session_frame_t got;
  occ_session_get_frame(S, root, "tcp", &got);
  printf("tcp origin z=%.3f m\n", got.origin[2]);

  /* algebra */
  occ_entity_id_t allf[128], only_root_prefix[128], inter[128];
  int n1 = 0, n2 = 0, n3 = 0;
  occ_query_created_by(S, "box1", OCC_ENTITY_FACE, allf, 128, &n1);
  occ_query_created_by(S, "box1/solid", OCC_ENTITY_FACE, only_root_prefix, 128,
                       &n2);
  occ_query_intersect_ids(allf, n1, only_root_prefix, n2, inter, 128, &n3);
  printf("intersect faces=%d\n", n3);

  occ_shape_t copy = NULL;
  occ_session_get_shape(S, root, &copy);
  occ_shape_free(copy);
  occ_shape_free(box);
  occ_session_destroy(S);
  printf("session smoke ok\n");
  fflush(stdout);
  _Exit(0);
}
