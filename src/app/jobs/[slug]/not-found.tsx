import { ClosedJobOrNotFound } from "@/components/closed-job";
import { NotFoundMessage } from "@/components/not-found-message";

/** 404 for /jobs/<slug>: the "vacancy has closed" notice for a closed listing, otherwise the normal message. */
export default function JobNotFound() {
  return <ClosedJobOrNotFound fallback={<NotFoundMessage />} />;
}
