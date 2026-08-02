# CAD browser demo — no OCCT / Bazel / emcc on this machine.
# Runtime downloads a pre-built stage tarball from a GitHub Release (bb-built).
#
#   docker build -f deploy/Dockerfile -t cad-demo .
#   docker run --rm -p 8765:8765 \
#     -e CAD_RELEASE_URL=https://github.com/NarendraPatwardhan/opencascade-bazel/releases/download/demo-v0.1.0/cad-demo-stage.tar.gz \
#     cad-demo
#
# Optional build-arg CAD_RELEASE_URL bakes the tarball into the image (offline run).

FROM node:22-alpine

RUN apk add --no-cache curl ca-certificates tar gzip

WORKDIR /app
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Optional bake at image build (Dokploy can also set CAD_RELEASE_URL at runtime).
ARG CAD_RELEASE_URL=
ENV CAD_RELEASE_URL=${CAD_RELEASE_URL}
ENV PORT=8765
ENV HOST=0.0.0.0
ENV CACHE_MODE=release
ENV STAGE_DIR=/app/stage

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1

ENTRYPOINT ["/entrypoint.sh"]
