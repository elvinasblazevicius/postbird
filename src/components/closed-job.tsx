"use client";

import { createContext, useContext } from "react";

/**
 * A closed vacancy's page is a 404 (notFound()), and not-found pages get no
 * props. The job segment's layout, which knows the slug, passes the
 * "this vacancy has closed" notice down through this context; the segment's
 * not-found page shows it, or the normal not-found message when the slug is unknown.
 */
const ClosedNotice = createContext<React.ReactNode>(null);

export function ClosedJobProvider({ notice, children }: { notice: React.ReactNode; children: React.ReactNode }) {
  return <ClosedNotice.Provider value={notice}>{children}</ClosedNotice.Provider>;
}

export function ClosedJobOrNotFound({ fallback }: { fallback: React.ReactNode }) {
  const notice = useContext(ClosedNotice);
  return <>{notice ?? fallback}</>;
}
