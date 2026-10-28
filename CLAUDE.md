@AGENTS.md

# Deploying negaresh (read before pushing)

- Live at https://negaresh.caravansanat.com (VPS, Coolify, the repo's Dockerfile, Node 22, port 3000). Render is retired.
- Every push to `main` deploys automatically (GitHub webhook → Coolify, 1–4 min, full Next.js rebuild). Pushes to other branches do not deploy.
- Before pushing to `main`: run `npm test` (and `npx tsc --noEmit -p .`); only finished code goes to `main`, work in progress stays on a branch.
- Push only when no content job is running: `GET /api/v1/health` must show `pendingJobs: 0` and `slots.active: 0`. A redeploy kills running jobs.
- About 5 minutes after a push, check `/api/v1/health`: `build.builtAt` (and `build.commit` when Coolify passes it) must be the new build.
- Panel login uses `BETA_ACCESS_SECRET`; its cookie works only over https. Keep it that way.
- `SITE_URL` / `NEXT_PUBLIC_SITE_URL` are Negaresh's own address (NEXT_PUBLIC needs a rebuild to change). Products are read from `STORE_URL` (default https://caravansanat.com), never from `SITE_URL`.
- Storage: Redis 7 with persistence (`REDIS_URL`) for content results; `LLM_USAGE_DB=/data/usage.sqlite` on a persistent volume. Nightly backups (server 7 days, Google Drive 14 days).
- The `product-crawler` repository is out of scope here.
