# CAD browser demo — no OCCT / Bazel / emcc on this machine.
# Runtime downloads a pre-built stage tarball from a GitHub Release (bb-built)
# via deploy/entrypoint.sh (API + GITHUB_TOKEN, CAD_RELEASE_TAG=latest).
#
#   docker build -f deploy/Dockerfile -t cad-demo .
#   docker run --rm -p 8765:8765 \
#     -e GITHUB_TOKEN=… \
#     -e CAD_RELEASE_TAG=latest \
#     cad-demo

FROM node:22-alpine

RUN apk add --no-cache curl ca-certificates tar gzip

WORKDIR /app
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV PORT=8765
ENV HOST=0.0.0.0
ENV CACHE_MODE=release
ENV STAGE_DIR=/app/stage
ENV CAD_RELEASE_TAG=latest
ENV CAD_RELEASE_PREFIX=demo-v

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1

ENTRYPOINT ["/entrypoint.sh"]
