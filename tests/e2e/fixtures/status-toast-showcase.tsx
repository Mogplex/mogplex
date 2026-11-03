import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/toaster";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";

function Showcase() {
  const [undoCount, setUndoCount] = useState(0);
  const [stopCount, setStopCount] = useState(0);
  const [closedCount, setClosedCount] = useState(0);
  const showStatuses = () => {
    toast.success({ title: "Changes saved", description: "Saved to your workspace.", duration: Infinity });
    toast.info({ title: "Compute paused", description: "Your workspace files are preserved.", duration: Infinity });
    toast.warning({ title: "Checks need attention", description: "Two checks still need a result.", duration: Infinity });
    toast.error({ title: "Build failed", description: "Review the errors before shipping.", duration: Infinity });
  };
  return (
    <>
      <header style={{ height: 56, borderBottom: "1px solid var(--border)", padding: "16px 24px", fontWeight: 600 }}>Mogplex · Toast interaction fixture</header>
      <main style={{ padding: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>Keep control while shipping</h1>
        <div className="task-workspace-toolbar" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
          <button onClick={showStatuses}>Show statuses</button>
          <button onClick={() => { showStatuses(); showStatuses(); showStatuses(); }}>Show burst</button>
          <button onClick={() => toast.info({ title: "Chat archived", description: "Bring it back whenever you need.", duration: Infinity, onOpenChange: (open) => { if (!open) setClosedCount((value) => value + 1); }, action: <ToastAction altText="Undo archiving this chat" onClick={() => setUndoCount((value) => value + 1)}>Undo</ToastAction> })}>Show action</button>
          <button onClick={() => toast.success({ title: "Brief confirmation", duration: 1000 })}>Show brief toast</button>
          <button onClick={async () => { await fetch("/__e2e/notify"); toast.success({ title: "Background task finished", duration: Infinity }); }}>Simulate background completion</button>
        </div>
        <p className="sr-only">Closed count: <output data-testid="closed-count">{closedCount}</output></p>
        <p className="sr-only">Undo count: <output data-testid="undo-count">{undoCount}</output></p>
      </main>
      <section style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", width: "min(640px, calc(100vw - 32px))", border: "1px solid var(--border)", borderRadius: 12, background: "var(--popover)", padding: 12 }}>
        <textarea id="control-composer" aria-label="Steer agent" placeholder="Steer the agent…" style={{ display: "block", width: "100%", minHeight: 48, resize: "none", outlineOffset: 3 }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <span>Stop count: <output data-testid="stop-count">{stopCount}</output></span>
          <button onClick={() => setStopCount((value) => value + 1)}>Stop agent</button>
        </div>
      </section>
      <Toaster />
    </>
  );
}

createRoot(document.getElementById("toast-fixture")!).render(<Showcase />);
