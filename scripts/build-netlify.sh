#!/usr/bin/env bash
# Netlify production build: applies database migrations before `next build`, so
# the database is ready before the new code goes live. A failed migration fails
# the build, and the site keeps running the previous deploy. Preview and branch
# builds never migrate: they share the production database. Migrations must be
# additive (README, "Database migrations").
set -euo pipefail

if [ "${CONTEXT:-}" = "production" ] && [ -n "${DATABASE_URL:-}" ]; then
  echo "Applying database migrations (production build)."
  npm run db:migrate
elif [ "${CONTEXT:-}" = "production" ]; then
  echo "Notice: DATABASE_URL isn't available to the build, so migrations were not applied here."
  echo "Give DATABASE_URL the Builds scope in Netlify (README Step 3), or rely on the Deploy migrations workflow."
else
  echo "Notice: ${CONTEXT:-local} build, so migrations are not applied (production builds only)."
fi

npm run build
