/**
 * Simple confirm modal (used for delete / archive when prefs require it).
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Destructive styling for delete-style actions. */
  danger?: boolean;
  testId?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!props.open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        props.onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.open, props.onCancel]);

  if (!props.open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/50 p-4"
      data-testid={props.testId ?? "confirm-dialog"}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onCancel();
      }}
    >
      <div
        className="surface-panel w-full max-w-sm p-4 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2
          id="confirm-dialog-title"
          className="m-0 mb-2 text-[15px] font-semibold text-[var(--foreground)]"
        >
          {props.title}
        </h2>
        <p
          id="confirm-dialog-message"
          className="m-0 mb-4 text-[13px] leading-relaxed whitespace-pre-wrap text-[var(--muted-foreground)]"
        >
          {props.message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="confirm-dialog-cancel"
            className="h-8 rounded-lg px-3 text-[13px] text-[var(--muted-foreground)] hover:bg-[var(--hover-fill)]"
            onClick={props.onCancel}
          >
            {props.cancelLabel}
          </button>
          <button
            type="button"
            data-testid="confirm-dialog-confirm"
            className={
              props.danger
                ? "h-8 rounded-lg bg-red-500 px-3.5 text-[13px] font-medium text-white hover:bg-red-600"
                : "h-8 rounded-lg bg-[#0a84ff] px-3.5 text-[13px] font-medium text-white hover:bg-[#0a84ff]/90"
            }
            autoFocus
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
