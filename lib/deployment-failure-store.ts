let visible = false;
const listeners = new Set<() => void>();

export const getDeploymentFailure = () => visible;
export const getServerDeploymentFailure = () => false;

export function subscribeDeploymentFailure(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setDeploymentFailure(value: boolean) {
  if (value === visible) return;
  visible = value;
  for (const listener of listeners) listener();
}
