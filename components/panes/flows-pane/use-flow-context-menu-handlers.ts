import {
  useCallback,
  type RefObject,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import {
  selectFlowDraftEdge,
  selectFlowDraftNode,
  type FlowCanvasNode,
  type FlowDraftSnapshot,
} from "@/lib/flows/editor";
import type { FlowContextMenuState } from "./types";

export type FlowContextMenuHandlersDeps = {
  // State setters
  setContextMenu: (menu: FlowContextMenuState | null) => void;
  updateDraft: (
    updater: (current: FlowDraftSnapshot) => FlowDraftSnapshot,
    options?: { recordHistory?: boolean; mergeKey?: string | null }
  ) => void;
  // Refs
  editorRef: RefObject<HTMLElement | null>;
  canvasRef: RefObject<HTMLDivElement | null>;
  reactFlowRef: RefObject<ReactFlowInstance<FlowCanvasNode> | null>;
};

export type FlowContextMenuHandlers = {
  closeContextMenu: () => void;
  resolveContextMenuPoint: (
    clientX: number,
    clientY: number
  ) => { x: number; y: number };
  openCanvasContextMenu: (clientX: number, clientY: number) => void;
  openNodeContextMenu: (
    node: FlowCanvasNode,
    clientX: number,
    clientY: number
  ) => void;
  openEdgeContextMenu: (
    edgeId: string,
    clientX: number,
    clientY: number
  ) => void;
  handlePaneContextMenu: (event: MouseEvent | ReactMouseEvent) => void;
  runContextMenuAction: (action: () => void | Promise<unknown>) => void;
};

/**
 * Handlers for opening, closing, and running context menu actions.
 */
export function useFlowContextMenuHandlers(
  deps: FlowContextMenuHandlersDeps
): FlowContextMenuHandlers {
  const { setContextMenu, updateDraft, editorRef, canvasRef, reactFlowRef } =
    deps;

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, [setContextMenu]);

  const resolveContextMenuPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
        return { x: clientX, y: clientY };
      }

      const rect = editorRef.current?.getBoundingClientRect();
      if (!rect) {
        return { x: 24, y: 96 };
      }

      return {
        x: Math.min(rect.left + 320, rect.right - 24),
        y: Math.min(rect.top + 96, rect.bottom - 24),
      };
    },
    [editorRef]
  );

  const openCanvasContextMenu = useCallback(
    (clientX: number, clientY: number) => {
      const point = resolveContextMenuPoint(clientX, clientY);
      setContextMenu({
        kind: "canvas",
        x: point.x,
        y: point.y,
        flowPosition: reactFlowRef.current?.screenToFlowPosition(point) ?? null,
        nodeId: null,
        nodeType: null,
        edgeId: null,
      });
    },
    [reactFlowRef, resolveContextMenuPoint, setContextMenu]
  );

  const openNodeContextMenu = useCallback(
    (node: FlowCanvasNode, clientX: number, clientY: number) => {
      const point = resolveContextMenuPoint(clientX, clientY);
      updateDraft((current) => selectFlowDraftNode(current, node.id), {
        recordHistory: false,
      });
      setContextMenu({
        kind: "node",
        x: point.x,
        y: point.y,
        flowPosition: reactFlowRef.current?.screenToFlowPosition(point) ?? null,
        nodeId: node.id,
        nodeType: node.type,
        edgeId: null,
      });
    },
    [reactFlowRef, resolveContextMenuPoint, setContextMenu, updateDraft]
  );

  const openEdgeContextMenu = useCallback(
    (edgeId: string, clientX: number, clientY: number) => {
      const point = resolveContextMenuPoint(clientX, clientY);
      updateDraft((current) => selectFlowDraftEdge(current, edgeId), {
        recordHistory: false,
      });
      setContextMenu({
        kind: "edge",
        x: point.x,
        y: point.y,
        flowPosition: reactFlowRef.current?.screenToFlowPosition(point) ?? null,
        nodeId: null,
        nodeType: null,
        edgeId,
      });
    },
    [reactFlowRef, resolveContextMenuPoint, setContextMenu, updateDraft]
  );

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | ReactMouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".react-flow__node, .react-flow__edge")) return;

      event.preventDefault();
      if ("stopPropagation" in event) {
        event.stopPropagation();
      }
      canvasRef.current?.focus();
      openCanvasContextMenu(event.clientX, event.clientY);
    },
    [canvasRef, openCanvasContextMenu]
  );

  const runContextMenuAction = useCallback(
    (action: () => void | Promise<unknown>) => {
      closeContextMenu();
      const result = action();
      if (result instanceof Promise) {
        void result;
      }
    },
    [closeContextMenu]
  );

  return {
    closeContextMenu,
    resolveContextMenuPoint,
    openCanvasContextMenu,
    openNodeContextMenu,
    openEdgeContextMenu,
    handlePaneContextMenu,
    runContextMenuAction,
  };
}
