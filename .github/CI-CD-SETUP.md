# CI/CD Setup — Ofoq Accelerator

Four GitHub Actions workflows wire up lint/test, integration tests, security
scanning, and automated deploys to Render on every merge to `main`.

## Workflows

| File | Trigger | Purpose |
| --- | --- | --- |
| `.github/workflows/ci.yml` | PR + push to `main` | Lint, type-check, unit tests, build |
| `.github/workflows/e2e.yml` | PR + push to `main` | Integration tests with Postgres + Redis service containers |
| `.github/workflows/security.yml` | PR + push to `main` + weekly cron | CodeQL, pnpm audit, Gitleaks, Trivy |
| `.github/workflows/deploy.yml` | After CI + E2E + Security succeed on `main` | Deploy to Render and wait for the deploy to go live |

`dependabot.yml` also keeps npm, GitHub Actions, and Docker dependencies fresh
with weekly grouped PRs.

## Required repository secrets

Add these under **Settings → Secrets and variables → Actions**.

### Deploy (Render — primary target)

| Secret | Required | What it's for |
| --- | --- | --- |
| `RENDER_DEPLOY_HOOK_URL` | Yes | Unique deploy hook from the Render service's **Settings → Deploy Hook** page |
| `RENDER_API_KEY` | Recommended | Enables deploy-status polling so the workflow fails fast on a broken deploy |
| `RENDER_SERVICE_ID` | Recommended | The `srv-…` id of the Render service (pairs with `RENDER_API_KEY`) |

### Security

| Secret | Required | What it's for |
| --- | --- | --- |
| `GITLEAKS_LICENSE` | Only for org-owned repos on paid Gitleaks | Unlocks Gitleaks for private org repos |

### Alternative deploy targets

If you ever swap Render for Vercel or Netlify, add the relevant secrets and
uncomment the matching block in `deploy.yml`.

- Vercel: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- Netlify: `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`

## First-time setup

1. Push this `.github/` directory to a new branch and open a PR. The CI, E2E,
   and Security workflows will run on the PR.
2. Create a Render service for the API (environment: Node, build command:
   `pnpm install --frozen-lockfile && pnpm build`, start command:
   `pnpm --filter @ofoq/api start`).
3. Copy the Render deploy hook URL and API key into repo secrets as above.
4. Merge the PR. The deploy workflow runs automatically once CI / E2E /
   Security all pass on `main`.

## Branch protection recommendation

Under **Settings → Branches → main**:
- Require pull request reviews before merging.
- Require status checks: `CI / Lint`, `CI / Type-check`, `CI / Unit tests`,
  `CI / Build`, `E2E / Integration tests`, and the Security jobs.
- Require branches to be up to date before merging.
- Require linear history (optional but keeps rollbacks clean).

## Local parity

You can reproduce the CI checks locally with:

```bash
pnpm install --frozen-lockfile
pnpm -r --if-present run lint
pnpm -r exec tsc --noEmit
pnpm -r --if-present run test
pnpm build
```

For E2E parity, `docker-compose.yml` already boots Postgres + Redis.
