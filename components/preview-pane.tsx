"use client";

// Re-export from refactored module to maintain backward compatibility
// All implementation is now in components/preview-pane/

export {
  PreviewPane,
  StatusOverlay,
  InlineEnvVarForm,
  formatPreviewToolbarStatus,
} from "./preview-pane/index";

export type {
  PreviewPaneProps,
  SelectionRect,
  StatusOverlayProps,
} from "./preview-pane/index";

// For backwards compatibility - re-export Props as the original interface name
export type { PreviewPaneProps as Props } from "./preview-pane/index";
