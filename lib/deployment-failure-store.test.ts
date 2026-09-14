import { expect, it, vi } from "vitest";
import {
  getDeploymentFailure,
  getServerDeploymentFailure,
  setDeploymentFailure,
  subscribeDeploymentFailure,
} from "./deployment-failure-store";

it("retains failures before hydration, coalesces repeated notices, and supports dismissal", () => {
  setDeploymentFailure(false);
  setDeploymentFailure(true);
  expect(getDeploymentFailure()).toBe(true);
  expect(getServerDeploymentFailure()).toBe(false);
  const listener = vi.fn();
  const unsubscribe = subscribeDeploymentFailure(listener);
  setDeploymentFailure(true);
  expect(listener).not.toHaveBeenCalled();
  setDeploymentFailure(false);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(getDeploymentFailure()).toBe(false);
  unsubscribe();
  setDeploymentFailure(true);
  expect(listener).toHaveBeenCalledTimes(1);
  setDeploymentFailure(false);
});
