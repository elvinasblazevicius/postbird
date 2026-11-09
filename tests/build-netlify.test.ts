/**
 * scripts/build-netlify.sh: a production build applies migrations only when CI passed for the
 * commit (asked from GitHub's API, waiting while CI runs), and stops when CI failed or its result
 * can't be found out (nothing is published unchecked). curl, npm and sleep are replaced by stubs; nothing
 * is built, migrated or fetched. No database needed.
 */
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(__dirname, "..", "scripts", "build-netlify.sh");
const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("Netlify production build and CI", () => {
  let stubs: string;

  const stub = (name: string, body: string) => {
    writeFileSync(path.join(stubs, name), `#!/usr/bin/env bash\nd="$(dirname "$0")"\n${body}\n`);
    chmodSync(path.join(stubs, name), 0o755);
  };
  /** GitHub's answers, one per call (the last one repeats); null: the request fails. */
  const github = (...answers: (object | null)[]) => answers.forEach((a, i) => { if (a) writeFileSync(path.join(stubs, `response-${i + 1}.json`), JSON.stringify(a)); else writeFileSync(path.join(stubs, `fail-${i + 1}`), ""); });
  const runs = (...r: { status: string; conclusion: string | null; event?: string }[]) => ({ total_count: r.length, workflow_runs: r.map((x) => ({ event: "push", ...x })) });
  const read = (f: string) => (existsSync(path.join(stubs, f)) ? readFileSync(path.join(stubs, f), "utf8").trim().split("\n") : []);

  const build = (env: Record<string, string>) => new Promise<{ code: number; out: string }>((resolve) => {
    const childEnv = { PATH: `${stubs}:${process.env.PATH}`, HOME: stubs, ...env } as unknown as NodeJS.ProcessEnv;
    execFile("bash", [SCRIPT], { env: childEnv, timeout: 20_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, out: stdout + stderr });
    });
  });
  const production = { CONTEXT: "production", DATABASE_URL: "postgres://unused", COMMIT_REF: SHA, REPOSITORY_URL: "https://github.com/owner/postbird" };

  beforeEach(() => {
    stubs = mkdtempSync(path.join(tmpdir(), "pb-build-"));
    stub("npm", 'echo "$*" >> "$d/npm-calls"');
    stub("sleep", 'echo "$*" >> "$d/sleeps"');
    stub("curl", [
      'n=$(( $(cat "$d/count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$d/count"',
      'printf "%s\\n" "$*" >> "$d/curl-args"',
      '[ -f "$d/fail-$n" ] && exit 22',
      'f="$d/response-$n.json"; [ -f "$f" ] || f=$(ls "$d"/response-*.json 2>/dev/null | sort -V | tail -1)',
      '[ -n "$f" ] || exit 22',
      'cat "$f"',
    ].join("\n"));
  });
  afterEach(() => rmSync(stubs, { recursive: true, force: true }));

  it("CI passed for the commit: migrates, then builds", async () => {
    github(runs({ status: "completed", conclusion: "success" }));
    const r = await build(production);
    expect(r.code).toBe(0);
    expect(read("npm-calls")).toEqual(["run db:migrate", "run build"]);
    expect(read("curl-args")[0]).toContain(`https://api.github.com/repos/owner/postbird/actions/workflows/ci.yml/runs?head_sha=${SHA}`);
    expect(read("curl-args")[0]).not.toContain("Authorization");
  });

  it("waits while CI runs, and uses GITHUB_TOKEN when set (repository given as git@github.com:…)", async () => {
    github(runs(), runs({ status: "in_progress", conclusion: null }), runs({ status: "completed", conclusion: "success" }));
    const r = await build({ ...production, REPOSITORY_URL: "git@github.com:owner/postbird.git", GITHUB_TOKEN: "ghp_test" });
    expect(r.code).toBe(0);
    expect(read("sleeps")).toHaveLength(2);
    expect(read("curl-args")).toHaveLength(3);
    expect(read("curl-args")[0]).toContain("repos/owner/postbird/");
    expect(read("curl-args")[0]).toContain("Authorization: Bearer ghp_test");
    expect(read("npm-calls")).toEqual(["run db:migrate", "run build"]);
  });

  it("CI failed: the build stops (no migration, no new code)", async () => {
    // A pull request's successful run for the same commit doesn't count; the push run's does.
    github(runs({ status: "completed", conclusion: "failure" }, { status: "completed", conclusion: "success", event: "pull_request" }));
    const r = await build(production);
    expect(r.code).toBe(1);
    expect(r.out).toContain("CI failed");
    expect(read("npm-calls")).toEqual([]);
  });

  it("CI's result can't be found out (API unreachable, run canceled, still running after the wait): the build stops and says why", async () => {
    github(null);
    let r = await build(production);
    expect(r.code).toBe(1);
    expect(r.out).toContain("couldn't find out whether CI passed");
    expect(r.out).toContain("set GITHUB_TOKEN in Netlify's build environment");
    expect(read("npm-calls")).toEqual([]);

    rmSync(stubs, { recursive: true, force: true });
    stubs = mkdtempSync(path.join(tmpdir(), "pb-build-"));
    stub("npm", 'echo "$*" >> "$d/npm-calls"');
    stub("sleep", 'echo "$*" >> "$d/sleeps"');
    stub("curl", 'cat "$d/response.json"');
    writeFileSync(path.join(stubs, "response.json"), JSON.stringify(runs({ status: "completed", conclusion: "cancelled" })));
    r = await build(production);
    expect(r.code).toBe(1);
    expect(r.out).toContain("(unknown)");
    expect(read("npm-calls")).toEqual([]);

    writeFileSync(path.join(stubs, "response.json"), JSON.stringify(runs({ status: "queued", conclusion: null })));
    r = await build(production);
    expect(r.code).toBe(1);
    expect(read("sleeps").length).toBeGreaterThan(5); // waited (sleep is a stub), then gave up
    expect(r.out).toContain("(pending)");
    expect(r.out).toContain("retry this deploy in Netlify once CI has passed");
    expect(read("npm-calls")).toEqual([]);
  });

  it("without DATABASE_URL, a production build still waits for CI: builds without migrating once it passed, stops otherwise", async () => {
    const { DATABASE_URL: _unused, ...noDb } = production;
    void _unused;
    github(runs({ status: "completed", conclusion: "success" }));
    let r = await build(noDb);
    expect(r.code).toBe(0);
    expect(r.out).toContain("migrations were not applied here");
    expect(read("npm-calls")).toEqual(["run build"]);

    // No repository to ask: CI's result can't be found out.
    rmSync(path.join(stubs, "npm-calls"));
    r = await build({ ...noDb, REPOSITORY_URL: "" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("couldn't find out whether CI passed");
    expect(read("npm-calls")).toEqual([]);
  });

  it("previews and branch deploys never ask GitHub or migrate", async () => {
    const r = await build({ CONTEXT: "deploy-preview", DATABASE_URL: "postgres://unused", COMMIT_REF: SHA });
    expect(r.code).toBe(0);
    expect(read("curl-args")).toEqual([]);
    expect(read("npm-calls")).toEqual(["run build"]);
  });
});
