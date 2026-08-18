"use client";

import { useEffect, useRef, useState } from "react";
import { fetchWithActiveTeam } from "@/components/active-scope-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CapacityAddOn } from "@/lib/billing/capacity-catalog";
import type { CapacityChangeAction } from "@/lib/billing/capacity-change-contract";
import type { CapacityChangePreview } from "@/lib/billing/capacity-stripe-changes";
import { formatDate, formatUsd } from "./capacity-billing-format";

type CapacityAddOnDialogProps = {
  addOn: CapacityAddOn | null;
  currentQuantity: number;
  open: boolean;
  allowIncrease?: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<unknown>;
};

function actionFor(current: number, target: number): CapacityChangeAction | null {
  if (target > current) return "increase";
  if (target === 0 && current > 0) return "cancel";
  if (target < current) return "decrease";
  return null;
}
export function CapacityAddOnDialog({
  addOn,
  currentQuantity,
  open,
  allowIncrease = true,
  onOpenChange,
  onChanged,
}: CapacityAddOnDialogProps) {
  const [quantity, setQuantity] = useState(currentQuantity);
  const [preview, setPreview] = useState<CapacityChangePreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogSessionRef = useRef({ open: false, lookupKey: null as string | null });
  const attemptIdRef = useRef<string | null>(null);

  useEffect(() => {
    const lookupKey = addOn?.lookupKey ?? null;
    const priorSession = dialogSessionRef.current;
    const startsNewSession =
      open && (!priorSession.open || priorSession.lookupKey !== lookupKey);
    dialogSessionRef.current = { open, lookupKey };
    if (!startsNewSession) return;
    setQuantity(currentQuantity);
    setPreview(null);
    setError(null);
    attemptIdRef.current = null;
  }, [currentQuantity, open, addOn?.lookupKey]);

  const action = actionFor(currentQuantity, quantity);

  async function reviewChange() {
    if (!addOn || !action) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetchWithActiveTeam("/api/billing/capacity/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lookupKey: addOn.lookupKey,
          quantity,
          effectiveAction: action,
        }),
      });
      const payload = (await response.json()) as CapacityChangePreview & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Preview unavailable");
      attemptIdRef.current = null;
      setPreview(payload);
    } catch (previewError) {
      setError(
        previewError instanceof Error ? previewError.message : "Preview unavailable"
      );
    } finally {
      setPending(false);
    }
  }

  async function confirmChange() {
    if (!preview) return;
    setPending(true);
    setError(null);
    try {
      const attemptId = attemptIdRef.current ?? crypto.randomUUID();
      attemptIdRef.current = attemptId;
      const endpoint =
        preview.action === "increase"
          ? "/api/billing/capacity/checkout"
          : "/api/billing/capacity/schedule";
      const response = await fetchWithActiveTeam(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previewToken: preview.previewToken,
          attemptId,
        }),
      });
      const payload = (await response.json()) as {
        paymentUrl?: string | null;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Change not submitted");
      if (payload.paymentUrl) {
        window.location.assign(payload.paymentUrl);
        return;
      }
      await onChanged();
      attemptIdRef.current = null;
      setPending(false);
      onOpenChange(false);
    } catch (confirmError) {
      setError(
        confirmError instanceof Error ? confirmError.message : "Change not submitted"
      );
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{addOn ? `Manage ${addOn.name}` : "Manage capacity"}</DialogTitle>
          <DialogDescription>
            Review the price and effective date before you confirm.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Quantity</p>
                <p className="text-xs text-muted-foreground">
                  Current quantity: {currentQuantity}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  aria-label="Decrease quantity"
                  disabled={quantity === 0 || pending}
                  onClick={() => setQuantity((value) => Math.max(0, value - 1))}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  −
                </Button>
                <output className="w-8 text-center font-mono text-sm">{quantity}</output>
                <Button
                  aria-label="Increase quantity"
                  disabled={pending || (!allowIncrease && quantity >= currentQuantity)}
                  onClick={() => setQuantity((value) => value + 1)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  +
                </Button>
              </div>
            </div>
            {addOn ? (
              <p className="text-sm text-muted-foreground">
                {allowIncrease
                  ? `${formatUsd(addOn.amountCents)} per quantity each month.`
                  : "Extra parallel agent runs are not available for this account. You can keep or reduce your current quantity."}
              </p>
            ) : null}
          </div>
        ) : (
          <dl className="divide-y rounded-md border text-sm">
            <div className="flex justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Capacity</dt>
              <dd>{preview.currentAllowance} to {preview.resultingAllowance}</dd>
            </div>
            <div className="flex justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Monthly change</dt>
              <dd>{formatUsd(preview.recurringChangeCents)}</dd>
            </div>
            <div className="flex justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Due today</dt>
              <dd>{formatUsd(preview.amountDueNowCents)}</dd>
            </div>
            <div className="flex justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Effective</dt>
              <dd className="text-right">
                {formatDate(preview.effectiveAt)}
                <span className="block text-xs text-muted-foreground">
                  {preview.effectiveTiming === "after_payment"
                    ? "After payment"
                    : "At period end"}
                </span>
              </dd>
            </div>
          </dl>
        )}

        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

        <DialogFooter>
          {preview ? (
            <Button
              disabled={pending}
              onClick={() => {
                attemptIdRef.current = null;
                setPreview(null);
              }}
              variant="outline"
            >
              Back
            </Button>
          ) : null}
          <Button
            disabled={pending || (!preview && !action)}
            onClick={preview ? confirmChange : reviewChange}
          >
            {pending ? "Working…" : preview ? "Confirm change" : "Review change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
