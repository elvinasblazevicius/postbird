"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { attributionFromUrl, uetEvent } from "./ads";

type EventPayload = { type: string; path?: string; jobId?: number; props?: Record<string, unknown> };

/** Events that also count as Microsoft Ads conversions. */
const UET_EVENTS: Record<string, string> = { apply_click: "apply_click", premium_cta_click: "begin_trial" };

/** Send an analytics event. Cookieless; never blocks navigation. */
export function track(e: EventPayload) {
  if (UET_EVENTS[e.type]) uetEvent(UET_EVENTS[e.type], { event_category: "engagement" });
  try {
    const body = JSON.stringify({ ...e, path: e.path ?? location.pathname + location.search, ref: document.referrer || undefined });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
    } else {
      void fetch("/api/track", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true });
    }
  } catch {
    /* analytics must never break the page */
  }
}

export function PageviewTracker() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin") || last.current === pathname) return;
    last.current = pathname;
    const campaign = attributionFromUrl();
    track({ type: "pageview", path: pathname + location.search, props: campaign ? { campaign } : undefined });
  }, [pathname]);
  return null;
}

/** Fires one event when the component mounts (job views, searches). */
export function TrackOnMount({ event }: { event: EventPayload }) {
  const sent = useRef(false);
  const key = JSON.stringify(event);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    track(JSON.parse(key));
  }, [key]);
  return null;
}

/** The official application link; records the click, then opens the employer's page. */
export function ApplyLink({ href, jobId, className, children }: { href: string; jobId: number; className?: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="nofollow noopener noreferrer"
      className={className}
      onClick={() => track({ type: "apply_click", jobId })}
    >
      {children}
    </a>
  );
}

/** A link that records a named click (used for the Premium trial button). */
export function TrackedLink({ href, event, className, children }: { href: string; event: string; className?: string; children: React.ReactNode }) {
  return (
    <a href={href} className={className} onClick={() => track({ type: event })}>
      {children}
    </a>
  );
}
