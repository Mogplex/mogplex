"use client";

// Inspired by react-hot-toast library
import * as React from "react";

import type { ToastActionElement, ToastProps } from "@/components/ui/toast";

const TOAST_REMOVE_DELAY = 10000;

type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
};

const _actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const;

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

type ActionType = typeof _actionTypes;

type Action =
  | {
      type: ActionType["ADD_TOAST"];
      toast: ToasterToast;
    }
  | {
      type: ActionType["UPDATE_TOAST"];
      toast: Partial<ToasterToast>;
    }
  | {
      type: ActionType["DISMISS_TOAST"];
      toastId?: ToasterToast["id"];
    }
  | {
      type: ActionType["REMOVE_TOAST"];
      toastId?: ToasterToast["id"];
    };

type State = {
  toasts: ToasterToast[];
};

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: "REMOVE_TOAST",
      toastId,
    });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(toastId, timeout);
};

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST": {
      const toasts = [action.toast, ...state.toasts];
      // Closed cards have no remaining action; a new card can release them.
      for (const dropped of toasts.filter((toast) => toast.open === false)) {
        clearTimeout(toastTimeouts.get(dropped.id));
        toastTimeouts.delete(dropped.id);
      }
      return {
        ...state,
        toasts: toasts.filter((toast) => toast.open !== false),
      };
    }

    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      };

    case "DISMISS_TOAST": {
      const { toastId } = action;

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId && state.toasts.some((toast) => toast.id === toastId)) {
        addToRemoveQueue(toastId);
      } else if (toastId === undefined) {
        for (const toast of state.toasts) {
          addToRemoveQueue(toast.id);
        }
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t
        ),
      };
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        };
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
};

const listeners = new Set<() => void>();

let memoryState: State = { toasts: [] };

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => memoryState;

type Toast = Omit<ToasterToast, "id">;

/**
 * Show a toast. Always choose a status `variant` so users can read state at a
 * glance:
 * - `success`: an action completed (created, saved, connected).
 * - `info`: neutral state change or FYI (archived, paused, removed, queued).
 * - `warning`: partial success or something needs attention.
 * - `destructive`: the action failed.
 * Prefer the `toast.success()` / `toast.info()` / `toast.warning()` /
 * `toast.error()` helpers.
 */
function showToast({ ...props }: Toast) {
  const id = genId();

  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id });
  let onOpenChange = props.onOpenChange;
  const handleOpenChange = (open: boolean) => {
    if (!open) dismiss();
    onOpenChange?.(open);
  };
  const update = (updates: Partial<Toast>) => {
    if ("onOpenChange" in updates) onOpenChange = updates.onOpenChange;
    if (updates.open === true) {
      clearTimeout(toastTimeouts.get(id));
      toastTimeouts.delete(id);
    }
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...updates, id, onOpenChange: handleOpenChange },
    });
    if (updates.open === false) dismiss();
  };

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: handleOpenChange,
    },
  });

  return {
    id,
    dismiss,
    update,
  };
}

type StatusToast = Omit<Toast, "variant">;

const toast = Object.assign(showToast, {
  success: (props: StatusToast) => showToast({ ...props, variant: "success" }),
  info: (props: StatusToast) => showToast({ ...props, variant: "info" }),
  warning: (props: StatusToast) => showToast({ ...props, variant: "warning" }),
  error: (props: StatusToast) =>
    showToast({ ...props, variant: "destructive" }),
});

function useToast() {
  const state = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  };
}

export { useToast, toast };
