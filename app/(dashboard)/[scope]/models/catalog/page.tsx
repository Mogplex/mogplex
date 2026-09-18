import type { Metadata } from "next";
import { ModelCatalog } from "@/components/models/model-catalog";

export const metadata: Metadata = {
  title: "Model catalog | Mogplex",
  description: "Browse, enable, and disable the models available to your agents.",
  robots: { index: false, follow: false },
};

export default function ModelCatalogPage() {
  return <ModelCatalog />;
}
