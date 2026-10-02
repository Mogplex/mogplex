"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { NavArrowDown } from "iconoir-react";
import { ProviderIcon } from "@/components/provider-icon";

export const CHIP_CLASS =
  "flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-300 transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50";

function shortModelName(modelId: string) {
  return modelId.split("/").pop() ?? modelId;
}

function modelProvider(modelId: string) {
  return modelId.split("/")[0] ?? modelId;
}

export function ModelChip({
  modelId,
  modelIds,
  onSelect,
  disabled,
  loading = false,
}: {
  modelId: string | null;
  modelIds: string[];
  onSelect: (modelId: string) => void;
  disabled: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [menuPos, setMenuPos] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (btnRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = modelIds.filter(
    (m) => !filter || m.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="relative">
      <button
        ref={btnRef}
        disabled={disabled || loading}
        onClick={() => {
          setOpen((o) => {
            if (!o && btnRef.current) {
              const rect = btnRef.current.getBoundingClientRect();
              setMenuPos({
                left: rect.left,
                bottom: window.innerHeight - rect.top + 4,
              });
            }
            return !o;
          });
          setFilter("");
        }}
        className={`${CHIP_CLASS} font-medium text-ink-200`}
      >
        {modelId ? (
          <ProviderIcon
            provider={modelProvider(modelId)}
            className="size-4 border-0"
          />
        ) : null}
        {loading ? "Loading models…" : modelId ? shortModelName(modelId) : "Model"}
        <NavArrowDown className="size-3 text-ink-400" strokeWidth={2} />
      </button>
      {open && !loading &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[9999] flex max-h-56 w-72 flex-col rounded-lg border border-ink-700 bg-ink-850 shadow-2xl shadow-black/50"
            style={{ left: menuPos.left, bottom: menuPos.bottom }}
          >
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search models..."
              className="border-b border-ink-700 bg-ink-900 px-2 py-1.5 text-[11px] text-ink-100 outline-none"
              autoFocus
            />
            <div className="flex-1 overflow-auto">
              {filtered.length === 0 && (
                <div className="px-2 py-1.5 text-[11px] text-ink-400">
                  No models
                </div>
              )}
              {filtered.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    onSelect(m);
                    setOpen(false);
                    setFilter("");
                  }}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-ink-800 ${
                    m === modelId ? "text-ink-100" : "text-ink-300"
                  }`}
                >
                  <ProviderIcon
                    provider={modelProvider(m)}
                    className="size-4 border-0"
                  />
                  <span className="truncate">{m}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

