/**
 * In-app rename modal (Electron disables window.prompt by default).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function RenameDialog(props: {
  open: boolean;
  title: string;
  label?: string;
  initialValue: string;
  confirmLabel?: string;
  cancelLabel?: string;
  testId?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(props.initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setValue(props.initialValue);
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [props.open, props.initialValue]);

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

  function submit() {
    props.onConfirm(value.trim());
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/50 p-4"
      data-testid={props.testId ?? "rename-dialog"}
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onCancel();
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--popover)] p-4 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="m-0 mb-3 text-[15px] font-semibold text-[var(--foreground)]">
          {props.title}
        </h2>
        {props.label ? (
          <label className="mb-1.5 block text-[12px] text-[var(--muted-foreground)]">
            {props.label}
          </label>
        ) : null}
        <input
          ref={inputRef}
          data-testid="rename-dialog-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          className="mb-4 h-9 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--ring,#0a84ff)]"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="rename-dialog-cancel"
            className="h-8 rounded-lg px-3 text-[13px] text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
            onClick={props.onCancel}
          >
            {props.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            data-testid="rename-dialog-confirm"
            className="h-8 rounded-lg bg-[#0a84ff] px-3 text-[13px] font-medium text-white hover:bg-[#0a84ff]/90 disabled:opacity-40"
            disabled={!value.trim()}
            onClick={submit}
          >
            {props.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
