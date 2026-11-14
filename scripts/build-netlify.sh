#!/usr/bin/env bash
# Netlify production build: applies database migrations before `next build`, so
# the database is ready before the new code goes live. A failed migration fails
# the build, and the site keeps running the previous deploy. Preview and branch
# builds never migrate: they share the production database. Migrations must be
# additive (README, "Database migrations").
#
# Like the other two ways migrations are applied (the Deploy migrations and
# Scheduled jobs workflows), only for a commit whose CI run succeeded: the build
# asks GitHub's API for the CI workflow's run on this commit (COMMIT_REF), waiting
# for it while it runs (up to CI_WAIT_SECONDS). CI failed: the build fails, so
# code that didn't pass its checks never goes live. CI's result can't be found
# out (private repository without a token, API limit, CI still running after the
# wait, run canceled): the build fails too, with a message saying what to do, so
# nothing is published unchecked. A public repository needs no token; a private
# one needs GITHUB_TOKEN (read access to Actions) in Netlify's build environment.
set -euo pipefail

CI_WORKFLOW="ci.yml"
# Netlify stops a build after 15 minutes by default; CI usually takes a few minutes, and next build needs its own.
CI_WAIT_SECONDS=480
CI_POLL_SECONDS=30

# owner/repo from Netlify's REPOSITORY_URL (https://github.com/owner/repo(.git) or git@github.com:owner/repo(.git)).
github_repo() {
  local url="${REPOSITORY_URL:-}"
  if [[ "$url" =~ github\.com[:/]([^/]+)/([^/]+)$ ]]; then
    echo "${BASH_REMATCH[1]}/${BASH_REMATCH[2]%.git}"
  fi
}

# Prints the CI run's state for COMMIT_REF: success, failure, pending or unknown.
ci_state() {
  local repo="$1" body
  local api="https://api.github.com/repos/${repo}/actions/workflows/${CI_WORKFLOW}/runs?head_sha=${COMMIT_REF}&per_page=20"
  local auth=()
  if [ -n "${GITHUB_TOKEN:-}" ]; then auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}"); fi
  if ! body=$(curl -fsS --max-time 15 -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" ${auth[@]+"${auth[@]}"} "$api" 2>/dev/null); then
    echo unknown
    return
  fi
  # The newest run for this commit from a push (a pull request's run checks a merge commit instead).
  printf '%s' "$body" | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let runs = [];
      try { runs = JSON.parse(s).workflow_runs || []; } catch { console.log("unknown"); return; }
      const run = runs.find((r) => r.event === "push") || runs[0];
      if (!run) console.log("pending"); // not started yet
      else if (run.status !== "completed") console.log("pending");
      else if (run.conclusion === "success") console.log("success");
      else if (run.conclusion === "failure" || run.conclusion === "timed_out") console.log("failure");
      else console.log("unknown"); // canceled (a newer push), skipped, ...
    });'
}

if [ "${CONTEXT:-}" = "production" ]; then
  repo="$(github_repo)"
  state=unknown
  if [ -n "$repo" ] && [ -n "${COMMIT_REF:-}" ]; then
    waited=0
    unknowns=0
    while :; do
      state="$(ci_state "$repo" || true)"
      state="${state:-unknown}"
      # "unknown" is usually GitHub's API refusing an unauthenticated call for a while (shared build
      # machines hit its hourly limit): ask again a few times before giving up.
      if [ "$state" = "unknown" ] && [ "$unknowns" -lt 6 ] && [ "$waited" -lt "$CI_WAIT_SECONDS" ]; then
        unknowns=$((unknowns + 1))
        echo "Couldn't read CI's result for ${COMMIT_REF:0:7} yet; asking again (${unknowns}/6)..."
        sleep "$CI_POLL_SECONDS"
        waited=$((waited + CI_POLL_SECONDS))
        continue
      fi
      if [ "$state" != "pending" ] || [ "$waited" -ge "$CI_WAIT_SECONDS" ]; then break; fi
      echo "Waiting for CI on ${COMMIT_REF:0:7} (${waited}s so far)..."
      sleep "$CI_POLL_SECONDS"
      waited=$((waited + CI_POLL_SECONDS))
    done
  fi
  case "$state" in
    success)
      if [ -n "${DATABASE_URL:-}" ]; then
        echo "CI passed for ${COMMIT_REF:0:7}. Applying database migrations (production build)."
        npm run db:migrate
      else
        echo "CI passed for ${COMMIT_REF:0:7}."
        echo "Notice: DATABASE_URL isn't available to the build, so migrations were not applied here."
        echo "Give DATABASE_URL the Builds scope in Netlify (README Step 3), or rely on the Deploy migrations workflow."
      fi
      ;;
    failure)
      echo "Error: CI failed for ${COMMIT_REF:0:7}, so this deploy stops here (no migrations, no new code); the site keeps running the previous deploy."
      echo "Fix CI and push again."
      exit 1
      ;;
    *)
      echo "Error: couldn't find out whether CI passed for ${COMMIT_REF:-this commit} (${state}), so this deploy stops here (no migrations, no new code); the site keeps running the previous deploy."
      echo "For a private repository, set GITHUB_TOKEN in Netlify's build environment (a token with read access to Actions; README Step 3)."
      echo "If CI was still running or was canceled, retry this deploy in Netlify once CI has passed."
      exit 1
      ;;
  esac
else
  echo "Notice: ${CONTEXT:-local} build, so migrations are not applied (production builds only)."
fi

npm run build
