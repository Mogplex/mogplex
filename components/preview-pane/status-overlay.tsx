"use client";

import { StartingOverlay, BuildingOverlay, PausingOverlay } from "./status-progress";
import { StoppedOverlay, PausedOverlay, NotAvailableOverlay } from "./status-inactive";
import {
  AppErrorOverlay,
  BuildFailedOverlay,
  UnreachableOverlay,
  DeploymentMissingOverlay,
  GenericErrorOverlay,
} from "./status-errors";
import type { StatusOverlayProps } from "./status-overlay-types";

export type { StatusOverlayProps };

export function StatusOverlay(props: StatusOverlayProps) {
  const { status } = props;

  if (status === "starting") {
    return <StartingOverlay {...props} />;
  }

  if (status === "building") {
    return <BuildingOverlay {...props} />;
  }

  if (status === "pausing") {
    return <PausingOverlay {...props} />;
  }

  if (status === "stopped") {
    return <StoppedOverlay {...props} />;
  }

  if (status === "app_error") {
    return <AppErrorOverlay {...props} />;
  }

  if (status === "build_failed") {
    return <BuildFailedOverlay {...props} />;
  }

  if (status === "unreachable") {
    return <UnreachableOverlay {...props} />;
  }

  if (status === "deployment_missing") {
    return <DeploymentMissingOverlay {...props} />;
  }

  if (status === "error") {
    return <GenericErrorOverlay {...props} />;
  }

  if (status === "paused") {
    return <PausedOverlay {...props} />;
  }

  if (status === "idle_warning") {
    return null;
  }

  // not_available
  return <NotAvailableOverlay {...props} />;
}
