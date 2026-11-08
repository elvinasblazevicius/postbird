import { unsubscribe } from "@/lib/subscribers";

export const dynamic = "force-dynamic";

/** One-click unsubscribe (RFC 8058) used by Gmail/Outlook "Unsubscribe" buttons. */
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (token) await unsubscribe(token);
  return new Response("Unsubscribed", { status: 200 });
}
