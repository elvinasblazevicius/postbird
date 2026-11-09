import type { Metadata } from "next";
import { NotFoundMessage } from "@/components/not-found-message";

// No robots setting here: Next.js adds <meta name="robots" content="noindex"> to
// every 404 itself, and a second robots tag would only conflict with it.
export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return <NotFoundMessage />;
}
