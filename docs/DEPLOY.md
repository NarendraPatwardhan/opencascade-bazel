# Deploy the browser demo (bb → GitHub Release → Dokploy)

The CAD UI is a **static stage tree** served by a tiny Node process. **OCCT is never compiled on the VPS.** Heavy Wasm is built with **BuildBuddy (`bb`)** and published as a GitHub Release asset; Dokploy only downloads that tarball.

```text
bb (RBE)  →  cad-demo-stage.tar.gz  →  GitHub Release
                                           ↓
                              Dokploy docker compose
                              https://cad.opyt.cloud
```

Patterns borrowed from:

| Source | What we reuse |
|--------|----------------|
| [`agent-os` `//bazel/tools/gh-release`](https://github.com/NarendraPatwardhan/agent-os) | REST-only publisher (`tools/gh-release/publish.mjs`), no `gh` CLI, mandatory notes, idempotent asset replace, `SHA256SUMS` |
| [`nml` publish + SYSTEM §12](../nml) | Token **file or env**, never in git / Bazel flags / layers; public URLs are not secrets |

---

## What you need (credentials)

### 1. BuildBuddy (`bb`) — build Wasm

Used only on a machine that **builds** releases (laptop/CI), **not** Dokploy.

1. Install [BuildBuddy CLI](https://www.buildbuddy.io/docs/cli).
2. `bb login` (API key lands in local git config / bb config — **never commit**).
3. Confirm remote works:

   ```bash
   bb build --config=buildbuddy //api:libocc_c_wasm
   ```

No BuildBuddy secret belongs in this repository or in Dokploy.

### 2. GitHub token — publish releases

Used only by `./scripts/release-demo.sh` / `tools/gh-release/publish.mjs`.

**Create a token** (either):

| Kind | Scopes / permissions |
|------|----------------------|
| **Fine-grained PAT** (preferred) | Resource: this repo only. **Contents: Read and write**. **Metadata: Read**. |
| **Classic PAT** | `public_repo` if the repo is public; full `repo` if private. |

**Store it (pick one):**

```bash
# A) env (shell session only)
export GITHUB_TOKEN=github_pat_…   # or ghp_…

# B) token file outside the repo (recommended, same idea as nml's ../github.packages.key)
printf '%s\n' 'github_pat_…' > ../github.cad.key
chmod 600 ../github.cad.key
# release-demo.sh auto-probes (first hit wins):
#   ../github.cad.key
#   ../github.release.key
#   ../github.packages.key
# or pass: --token-file /path/to/key
```

**Do not:**

- Commit the token or put it in `.bazelrc` / compose / Dockerfile
- Put `GITHUB_TOKEN` in Dokploy (deploy only needs a **public** asset URL)
- Use the `gh` CLI as part of this workflow (REST only)

### 3. Dokploy — no build tokens

Dokploy only needs:

- This repo’s `docker-compose.yml` (or a compose app pointing at it)
- Env **`CAD_RELEASE_URL`** = public download URL of `cad-demo-stage.tar.gz`
- Domain `cad.opyt.cloud` → service **`cad`**, container port **8765**

---

## Release path (operator machine)

Prereqs: `bb login`, Node 20+, `bun` (browserify mc-core), `curl`, git.

```bash
cd /path/to/opencascade-bazel

# Optional: dry-run pack + validate assets (no GitHub mutation)
./scripts/release-demo.sh --tag demo-v0.1.0 --notes "CAD demo stage (Wasm + AgentOS)." --dry-run

# Real release (creates/reuses tag release, uploads tarball + SHA256SUMS)
./scripts/release-demo.sh \
  --tag demo-v0.1.0 \
  --notes-file /tmp/demo-notes.md \
  --target "$(git rev-parse HEAD)"   # pin release to this commit (recommended)
```

What the script does:

1. `agent-os/scripts/fetch-release.sh` — AgentOS **v0.5.0** assets (kernel, loom, mc-core, catalog, git-engine)
2. `browserify-mc-core.sh` — browser-safe `mc-core`
3. `bb build --config=buildbuddy --remote_download_outputs=all //api:libocc_c_wasm`
4. `stage.mjs` → self-contained tree (`libocc_c.*`, batteries, src, demo, `serve.mjs`)
5. `dist/cad-demo-stage.tar.gz`
6. REST publish via `tools/gh-release/publish.mjs` (idempotent re-upload of same-named assets)

**Assets on the release:**

| File | Role |
|------|------|
| `cad-demo-stage.tar.gz` | Full demo stage (Dokploy downloads this) |
| `SHA256SUMS` | `sha256sum -c` over uploaded bytes |

**URL for Dokploy:**

```text
https://github.com/NarendraPatwardhan/opencascade-bazel/releases/download/demo-v0.1.0/cad-demo-stage.tar.gz
```

Pack only (no publish):

```bash
./scripts/pack-demo-stage.sh
# → dist/cad-demo-stage.tar.gz
```

Reuse existing `vendor/occ` without rebuilding Wasm:

```bash
SKIP_WASM_BUILD=1 ./scripts/pack-demo-stage.sh
```

---

## Compose / Dokploy

Root file: [`docker-compose.yml`](../docker-compose.yml).

```bash
export CAD_RELEASE_URL=https://github.com/NarendraPatwardhan/opencascade-bazel/releases/download/demo-v0.1.0/cad-demo-stage.tar.gz
docker compose up -d --build
# → http://127.0.0.1:8765/  (health: /healthz)
```

Image: `deploy/Dockerfile` (Node 22 alpine + curl). **Entrypoint** downloads `CAD_RELEASE_URL` into `/app/stage` and runs `serve.mjs` on `HOST=0.0.0.0:8765`.

| Env | Meaning |
|-----|---------|
| `GITHUB_TOKEN` / `GH_TOKEN` | **Required** (private repo) — PAT **Contents: Read** |
| `CAD_RELEASE_TAG` | **Required** — e.g. `demo-v0.1.0` |
| `CAD_RELEASE_REPO` | default `NarendraPatwardhan/opencascade-bazel` |
| `CAD_RELEASE_ASSET` | default `cad-demo-stage.tar.gz` |
| `PORT` / `HOST` | default `8765` / `0.0.0.0` |
| `CACHE_MODE=release` | Long-cache for wasm/js |

### Private repo note (this repo)

`opencascade-bazel` is **private**. The browser URL

```text
https://github.com/.../releases/download/demo-v0.1.0/cad-demo-stage.tar.gz
```

returns **HTTP 404** even for many token styles. GitHub only streams private
release blobs via the **API asset endpoint**:

```text
GET /repos/{owner}/{repo}/releases/assets/{id}
Accept: application/octet-stream
Authorization: Bearer <token>
```

entrypoint resolves `CAD_RELEASE_TAG` → asset id, then downloads that way.
Verified locally: tag `demo-v0.1.0` → asset `499063674` → gzip stage → `/healthz` ok.

Never put the token in git; Dokploy **environment / secret** only (paste contents of `../github.cad.key`).

### Dokploy checklist

1. Redeploy compose from `master` (image must include API-fetch entrypoint).
2. Env:
   ```text
   GITHUB_TOKEN=<fine-grained PAT, Contents: Read>
   CAD_RELEASE_TAG=demo-v0.1.0
   ```
3. **Domains**: `cad.opyt.cloud` → service **`cad`** → container port **`8765`**.
4. Stack on **`dokploy-network`**.
5. Healthy logs:
   ```text
   entrypoint: resolve … @ demo-v0.1.0 asset cad-demo-stage.tar.gz
   entrypoint: fetching (auth) https://api.github.com/.../releases/assets/…
   entrypoint: serving … on 0.0.0.0:8765
   ```
6. `curl https://cad.opyt.cloud/healthz` → `ok`.

If logs still show `releases/download/…` 404: old image (rebuild) or missing token.

If browser shows plain **`404 page not found`** (Traefik): domain not on `cad:8765`.

| Probe | Healthy | Broken routing |
|-------|---------|----------------|
| `https://cad.opyt.cloud/healthz` | `ok` | `404 page not found` |
| `https://cad.opyt.cloud/` | HTML `occ_c × AgentOS` | plain Traefik 404 |

**Update:** cut `demo-v0.2.0` with `release-demo.sh`, set `CAD_RELEASE_TAG` to the new tag, redeploy.

---

## Local dev (not Dokploy)

```bash
./agent-os/scripts/dev.sh
# HOST defaults to 0.0.0.0; for laptop-only: HOST=127.0.0.1 ./agent-os/scripts/dev.sh
```

---

## License boundary

| In the tarball | License |
|----------------|---------|
| `libocc_c.js` / `.wasm` | Apache-2.0 (`api/`) |
| AgentOS kernel/loom/mc-core + `agent-os/src` batteries/UI | BSL 1.1 (`agent-os/`) |

Public demo at `cad.opyt.cloud` ships both; keep the product split clear in docs/footer (already on the demo page).

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `bb` auth errors | `bb login`; org remote execution enabled |
| `missing libocc_c` after pack | Ensure `--remote_download_outputs=all` (script sets it) |
| Publish 401/403 | Token scopes; repo name `MC_RELEASE_REPO` |
| Publish 404 on upload | Release created but assets API — re-run (idempotent) |
| Container exits “set CAD_RELEASE_URL” | Compose/Dokploy env not set |
| Page loads, mesh never appears | Browser console; confirm `/agent-os/libocc_c.wasm` 200 |
| Monaco fails | CDN blocked; network to jsDelivr |
