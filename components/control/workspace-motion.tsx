"use client";

import { LayoutGroup, MotionConfig, MotionConfigContext } from "motion/react";
import { useContext, useSyncExternalStore, type ReactNode } from "react";

const preference = "(prefers-reduced-motion: reduce)";
const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(preference);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const readPreference = () => window.matchMedia(preference).matches;
const serverPreference = () => true;

export function useWorkspaceTransition(resizing: boolean) {
  const { transition } = useContext(MotionConfigContext);
  return resizing ? { duration: 0 } : transition;
}

export function WorkspaceMotion({ children }: { children: ReactNode }) {
  const reduced = useSyncExternalStore(subscribe, readPreference, serverPreference);
  return <MotionConfig reducedMotion={reduced ? "always" : "never"} transition={{ duration: reduced ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}>
    <LayoutGroup>{children}</LayoutGroup>
  </MotionConfig>;
}
