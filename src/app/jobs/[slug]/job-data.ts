import { cache } from "react";
import { getJob, type JobDetail } from "@/lib/jobs";
import { parseJobParam } from "@/lib/site";

/** The job behind a /jobs/<slug> URL (shared by the layout, the page and its metadata within one request). */
export const loadJob = cache(async (param: string) => {
  const id = parseJobParam(param);
  if (!id) return null;
  const job = await getJob(id);
  // Listings removed by an admin are treated as never having existed.
  if (!job || job.status === "removed") return null;
  return job;
});

/** Open: still listed by its source and not past its published closing date. */
export function isJobOpen(job: JobDetail) {
  return job.status === "active" && (!job.deadline || job.deadline >= new Date().toISOString().slice(0, 10));
}
