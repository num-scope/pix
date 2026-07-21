/**
 * App-level error modal (not used for pi agent timeline failures).
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";

export function ErrorDialog(props: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onClose: () => void;
  testId?: string;
}) {
  useEffect(() => {
    if (!props.open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" || ev.key === "Enter") {
        ev.preventDefault();
        props.onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);

  if (!props.open || !props.message || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/50 p-4"
      data-testid={props.testId ?? "error-dialog"}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="error-dialog-title"
      aria-describedby="error-dialog-message"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--popover)] p-4 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2
          id="error-dialog-title"
          className="m-0 mb-2 text-[15px] font-semibold text-[var(--foreground)]"
        >
          {props.title}
        </h2>
        <p
          id="error-dialog-message"
          className="m-0 mb-4 text-[13px] leading-relaxed whitespace-pre-wrap text-[var(--muted-foreground)]"
          data-testid="error-dialog-message"
        >
          {props.message}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            data-testid="error-dialog-confirm"
            className="h-8 rounded-lg bg-[#0a84ff] px-3.5 text-[13px] font-medium text-white hover:bg-[#0a84ff]/90"
            autoFocus
            onClick={props.onClose}
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
