# Portfolio Dashboard — Server Setup (Ubuntu + Docker)

## Prerequisites

- Fresh Ubuntu server (root access, simple root password)
- Internet connection verified
- GitHub Personal Access Token (PAT) with `read:packages` scope — needed because the Docker image is in a **private** GitHub Container Registry
- An exact Portfolio commit SHA to deploy

---

## 1. First-time login to GHCR

```bash
export PAT="<your-github-pat>"
echo "$PAT" | docker login ghcr.io -u renanmoraisdasilva --password-stdin
export PORTFOLIO_IMAGE_TAG="<commit-sha>"
```

Pull the image manually to verify access:

```bash
docker pull "ghcr.io/renanmoraisdasilva/portfolio-dashboard:${PORTFOLIO_IMAGE_TAG}"
```

Check container logs at any time:

```bash
docker logs portfolio-dashboard
```

---

## 2. Persistent data directory

The database lives on the host so it survives container restarts and image updates.  
**If this volume is missing, all data is lost on restart.**

```bash
mkdir -p /opt/portfolio/data
chown -R root:root /opt/portfolio/data
```

---

## 3. Dokploy deployment

Create Portfolio as a Dokploy Docker Compose application using the repository's
`docker-compose.yml`. Configure the GHCR registry in Dokploy and provide this
required application environment variable:

```dotenv
PORTFOLIO_IMAGE_TAG=<full-commit-sha>
```

Keep the Compose health check enabled. The web service is published on host port
`3002` and serves container port `3000`; Dokploy retains host ports `80`, `443`,
and `3000`. Preserve the `/opt/portfolio/data` bind mount so the SQLite data
survives redeployments. Do not add `container_name` values or change the image
tag to `latest`.

Portfolio telemetry is sent to the shared SigNoz installation managed by
`server-infra`. The production Compose file points web and worker processes at
the host OTLP HTTP endpoint on port `4318`. SigNoz is the only observability
stack: Portfolio runs no separate metrics, tracing, or dashboards service.

To ship a new release, set `PORTFOLIO_IMAGE_TAG` to the new commit SHA in the
Dokploy application environment and redeploy. Dokploy keeps the previous
release for rollback, and the `/opt/portfolio/data` bind mount is preserved
across redeployments.

---

## 4. Environment variables / secrets

### HOME_ASSISTANT_WEBHOOK_URL

The webhook URL used to send portfolio alerts to Home Assistant is **baked into the Docker image at build time** — it is not read from a `.env` file at runtime.

**How it works:**

1. The value is stored as a **GitHub Actions secret** named `HOME_ASSISTANT_WEBHOOK_URL` in the repository settings (`Settings → Secrets and variables → Actions`).
2. The CI workflow (`.github/workflows/docker-image.yml`) passes it to the Docker build as a `--build-arg`:
   ```yaml
   build-args: |
     HOME_ASSISTANT_WEBHOOK_URL=${{ secrets.HOME_ASSISTANT_WEBHOOK_URL }}
   ```
3. The `Dockerfile` accepts it as an `ARG` and promotes it to an `ENV`, so it is available to the Node.js process at runtime:
   ```dockerfile
   ARG HOME_ASSISTANT_WEBHOOK_URL
   ENV HOME_ASSISTANT_WEBHOOK_URL=${HOME_ASSISTANT_WEBHOOK_URL}
   ```

**To update the webhook URL**, change the secret value in GitHub and trigger a new push to `main` — the CI will rebuild and push a new image. Update `PORTFOLIO_IMAGE_TAG` to that commit SHA in Dokploy and redeploy to pick it up.

**Local development** uses `apps/api/.env` (ignored by git). Copy `apps/api/.env.example` and fill in your local HA webhook URL.

---

## 5. Accessing the database directly on the server

```bash
cd /opt/portfolio/data
sqlite3 portfolio.db
```
