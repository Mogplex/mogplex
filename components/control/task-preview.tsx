"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { PreviewPaneTab } from "@/hooks/use-split-panes";
import type { PreviewPaneProps } from "@/components/preview-pane/types";

const PreviewPane = dynamic(() => import("@/components/preview-pane").then(module => module.PreviewPane), { ssr: false });

export function TaskPreview(props: PreviewPaneProps) {
  const [tab, setTab] = useState<PreviewPaneTab>("preview");
  return <PreviewPane {...props} workspaceSessionId={null} hideCodeTab initialTab={tab} onTabChange={setTab} />;
}
