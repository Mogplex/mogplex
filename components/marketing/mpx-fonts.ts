// next/font loaders live in their own leaf module: when they were defined in
// mpx-chrome.tsx, the font objects crossed two module boundaries into client
// SSR chunks and Turbopack could evaluate the consumer before the loader,
// crashing SSR with "Cannot read properties of undefined (reading 'variable')"
// (Sentry MOGPLEX-S). A leaf module keeps the loader first in every chunk.
import { IBM_Plex_Mono, Inter_Tight } from "next/font/google";

export const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const interTight = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter-tight",
});
