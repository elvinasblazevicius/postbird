"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { adMeasurementAllowed, attributionFromUrl, isPrivatePath, uetEvent, withoutClickId } from "./ads";

type EventPayload = { type: string; path?: string; jobId?: number; props?: Record<string, unknown> };

/**
 * Events also sent to Microsoft Ads (UET). A click on an email-alert button is only interest, so it
 * goes as "trial_cta_click", which is not set up as a conversion; "begin_trial" is sent only when a
 * Paddle checkout completes (src/components/paddle-checkout.tsx).
 */
const UET_EVENTS: Record<string, string> = { apply_click: "apply_click", premium_cta_click: "trial_cta_click" };

/** Current path with only campaign parameters kept (never tokens, emails or search text). */
function safePath(): string {
  try {
    const keep = new URLSearchParams();
    new URLSearchParams(location.search).forEach((v, k) => {
      if (k.startsWith("utm_")) keep.set(k, v);
      // The unique click id only with advertising consent; otherwise just mark that it was there.
      else if (k === "msclkid") keep.set(k, adMeasurementAllowed() ? v : "present");
    });
    const q = keep.toString();
    return location.pathname + (q ? `?${q}` : "");
  } catch {
    return "/";
  }
}

/** Send an analytics event. Cookieless; never blocks navigation; never runs on private pages. */
export function track(e: EventPayload) {
  if (isPrivatePath(location.pathname)) return;
  if (UET_EVENTS[e.type]) uetEvent(UET_EVENTS[e.type], { event_category: "engagement" });
  try {
    const body = JSON.stringify({ ...e, path: e.path ?? safePath(), ref: document.referrer ? document.referrer.split("?")[0] : undefined });
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
    if (!pathname || isPrivatePath(pathname) || last.current === pathname) return;
    last.current = pathname;
    const campaign = withoutClickId(attributionFromUrl());
    track({ type: "pageview", props: campaign ? { campaign } : undefined });
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
export function TrackedLink({ href, event, source, className, target, rel, children }: { href: string; event: string; source?: string; className?: string; target?: string; rel?: string; children: React.ReactNode }) {
  return (
    <a href={href} className={className} target={target} rel={rel} onClick={() => track({ type: event, props: source ? { source } : undefined })}>
      {children}
    </a>
  );
}
