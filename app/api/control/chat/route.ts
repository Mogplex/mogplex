import { requireUserId } from "@/lib/auth";
import { after } from "next/server";
import { runAuthorizedControlChat } from "./_lib/authorized-request";

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;
  return runAuthorizedControlChat(req, userId, { onCompletion: after });
}
