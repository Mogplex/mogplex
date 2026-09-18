import type { ReactNode } from "react";
import { ModelsShell } from "@/components/models/models-shell";

export default function ModelsLayout({ children }: { children: ReactNode }) {
  return <ModelsShell>{children}</ModelsShell>;
}
