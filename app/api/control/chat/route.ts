import { requireUserId } from "@/lib/auth";
import { after } from "next/server";
import { runAuthorizedControlChat } from "./_lib/authorized-request";

// A coordinator turn plans, starts compute, creates checkouts, launches
// workers, and saves its handoff. The project default (300s) killed such turns
// mid-flight, leaving the call streaming forever and the handoff never ready.
export const maxDuration = 800;

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;
  return runAuthorizedControlChat(req, userId, { onCompletion: after });
}
