// Client half of the Neon-backed Better Auth browser sign-in flow.

import { createAuthClient } from "better-auth/react";
import { ssoClient } from "@better-auth/sso/client";

export const authClient = createAuthClient({
  plugins: [ssoClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
