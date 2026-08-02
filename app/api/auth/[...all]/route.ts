// better-auth handler. Static /api/auth/* siblings (login, logout, waitlist,
// github, vercel, user) take precedence over this catch-all, so the Supabase
// auth stack keeps working during the transition.

import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/better-auth/server";

export const { GET, POST } = toNextJsHandler(auth.handler);
