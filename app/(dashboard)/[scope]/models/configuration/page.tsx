import type { Metadata } from "next";
import { ModelConfiguration } from "@/components/models/model-configuration";

export const metadata: Metadata = {
  title: "Model configuration | Mogplex",
  description: "Set the primary model, ordered fallbacks, and catalog policy.",
  robots: { index: false, follow: false },
};

export default function ModelConfigurationPage() {
  return <ModelConfiguration />;
}
