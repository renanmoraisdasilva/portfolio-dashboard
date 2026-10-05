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

The webhook URL used to send portfolio alerts to Home Assistant is a **runtime environment variable**. Set `HOME_ASSISTANT_WEBHOOK_URL` in the Dokploy application environment; `docker-compose.yml` forwards it into the container and the Node process reads it from `process.env`.

It is deployment configuration, not part of the image, so it is never passed as a `--build-arg` or written into the `Dockerfile`. A webhook URL is itself the credential — anyone holding it can post to the automation — which is why it lives in the deployment environment and nowhere in the artifact.

**To update the webhook URL**, change the value in Dokploy and redeploy. No rebuild, no new image tag, no GitHub Actions secret: `PORTFOLIO_IMAGE_TAG` keeps pointing at the same commit.

**Local development** uses `apps/api/.env` (ignored by git). Copy `apps/api/.env.example` and fill in your local HA webhook URL.

Full details, including the payload format and troubleshooting, are in [HOME_ASSISTANT_SETUP.md](HOME_ASSISTANT_SETUP.md).

---

## 5. Accessing the database directly on the server

```bash
cd /opt/portfolio/data
sqlite3 portfolio.db
```
