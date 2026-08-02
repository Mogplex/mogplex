// Client half of the better-auth foundation. Not used by any UI surface yet —
// Supabase auth remains the live sign-in path until the Neon cutover.

import { createAuthClient } from "better-auth/react";
import { ssoClient } from "@better-auth/sso/client";

export const authClient = createAuthClient({
  plugins: [ssoClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
