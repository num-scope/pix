/**
 * Top-layer popup menu (portal + fixed) so sidebar overflow never clips it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/utils.ts";

export interface AnchorRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function anchorFromEvent(target: EventTarget | null): AnchorRect | null {
  if (!(target instanceof HTMLElement)) return null;
  const r = target.getBoundingClientRect();
  return {
    top: r.top,
    left: r.left,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  };
}

export function anchorFromElement(el: HTMLElement | null): AnchorRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top,
    left: r.left,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  };
}

export type FloatingMenuPlacement = "bottom" | "top" | "right" | "left";

export function FloatingMenu(props: {
  open: boolean;
  anchor: AnchorRect | null;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  /** Preferred min width in px */
  minWidth?: number;
  className?: string;
  /** Open below (default), above, or to the right of the anchor. */
  placement?: FloatingMenuPlacement;
  /** Stacking order — flyouts should sit above the parent menu. */
  zIndex?: number;
  /** When false, outside click / Escape still close unless nested menus handle it. Default true. */
  closeOnOutside?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 0, ready: false });
  const minWidth = props.minWidth ?? 200;
  const placement = props.placement ?? "bottom";
  const zIndex = props.zIndex ?? 10_000;
  const closeOnOutside = props.closeOnOutside !== false;

  useLayoutEffect(() => {
    if (!props.open || !props.anchor) {
      setPos((p) => ({ ...p, ready: false }));
      return;
    }
    const anchor = props.anchor;
    const el = ref.current;
    const pad = 8;
    const gap = 4;
    const topGap = 6;
    const minMenuH = 120;
    const spaceAbove = Math.max(0, anchor.top - pad - topGap);
    const spaceBelow = Math.max(0, window.innerHeight - anchor.bottom - pad - gap);
    const spaceSide = Math.max(minMenuH, window.innerHeight - pad * 2);

    // Clamp height to available viewport before measuring, so long lists
    // (e.g. model picker) never paint taller than the window.
    let maxHeight: number;
    if (placement === "top") {
      maxHeight = Math.max(minMenuH, spaceAbove > minMenuH ? spaceAbove : spaceBelow);
    } else if (placement === "bottom") {
      maxHeight = Math.max(minMenuH, spaceBelow > minMenuH ? spaceBelow : spaceAbove);
    } else {
      maxHeight = spaceSide;
    }
    if (el) {
      el.style.maxHeight = `${maxHeight}px`;
    }

    const menuW = Math.max(minWidth, el?.offsetWidth ?? minWidth);
    const menuH = el?.offsetHeight ?? Math.min(160, maxHeight);

    let top: number;
    let left: number;

    if (placement === "right") {
      left = anchor.right + gap;
      top = anchor.top;
      if (left + menuW > window.innerWidth - pad) {
        left = Math.max(pad, anchor.left - menuW - gap);
      }
      if (top + menuH > window.innerHeight - pad) {
        top = Math.max(pad, window.innerHeight - menuH - pad);
      }
      top = Math.max(pad, top);
    } else if (placement === "left") {
      left = anchor.left - menuW - gap;
      top = anchor.top;
      if (left < pad) {
        left = Math.min(anchor.right + gap, window.innerWidth - menuW - pad);
      }
      if (top + menuH > window.innerHeight - pad) {
        top = Math.max(pad, window.innerHeight - menuH - pad);
      }
      top = Math.max(pad, top);
    } else if (placement === "top") {
      // Open above the trigger (composer controls). Prefer room above; else below.
      if (spaceAbove >= menuH || spaceAbove >= spaceBelow) {
        maxHeight = Math.max(minMenuH, spaceAbove);
        if (el) el.style.maxHeight = `${maxHeight}px`;
        const h = el?.offsetHeight ?? Math.min(menuH, maxHeight);
        top = anchor.top - h - topGap;
        left = anchor.left;
      } else {
        maxHeight = Math.max(minMenuH, spaceBelow);
        if (el) el.style.maxHeight = `${maxHeight}px`;
        top = anchor.bottom + gap;
        left = anchor.left;
      }
      if (left + menuW > window.innerWidth - pad) {
        left = Math.max(pad, window.innerWidth - menuW - pad);
      }
      left = Math.max(pad, left);
      top = Math.max(pad, Math.min(top, window.innerHeight - (el?.offsetHeight ?? menuH) - pad));
    } else {
      // bottom (default)
      if (spaceBelow >= menuH || spaceBelow >= spaceAbove) {
        maxHeight = Math.max(minMenuH, spaceBelow);
        if (el) el.style.maxHeight = `${maxHeight}px`;
        top = anchor.bottom + gap;
        left = anchor.left;
      } else {
        maxHeight = Math.max(minMenuH, spaceAbove);
        if (el) el.style.maxHeight = `${maxHeight}px`;
        const h = el?.offsetHeight ?? Math.min(menuH, maxHeight);
        top = anchor.top - h - topGap;
        left = anchor.left;
      }
      if (left + menuW > window.innerWidth - pad) {
        left = Math.max(pad, window.innerWidth - menuW - pad);
      }
      left = Math.max(pad, left);
      top = Math.max(pad, Math.min(top, window.innerHeight - (el?.offsetHeight ?? menuH) - pad));
    }
    setPos({ top, left, maxHeight, ready: true });
  }, [props.open, props.anchor, minWidth, placement]);

  useEffect(() => {
    if (!props.open || !closeOnOutside) return;
    // Use click (not mousedown) so menu item onClick always fires first.
    const onClick = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (ref.current && ref.current.contains(target)) return;
      // Nested flyouts are separate portals — treat any floating menu as "inside".
      if (target instanceof Element && target.closest("[data-floating-menu]")) return;
      props.onClose();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") props.onClose();
    };
    // Close when the page scrolls, but not when scrolling inside this menu (or nested menus).
    const onScroll = (ev: Event) => {
      const target = ev.target;
      if (target instanceof Node) {
        if (ref.current?.contains(target)) return;
        if (target instanceof Element && target.closest("[data-floating-menu]")) return;
      }
      props.onClose();
    };
    // defer attach so the opening click doesn't immediately close
    const timer = window.setTimeout(() => {
      document.addEventListener("click", onClick, true);
    }, 0);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [props.open, props.onClose, closeOnOutside]);

  if (!props.open || !props.anchor || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      data-testid={props.testId}
      data-floating-menu=""
      className={cn(
        "project-context-menu surface-panel fixed overflow-x-hidden overflow-y-auto py-1 shadow-2xl",
        !pos.ready && "invisible",
        props.className,
      )}
      style={{
        top: pos.top,
        left: pos.left,
        minWidth,
        ...(pos.maxHeight > 0 ? { maxHeight: pos.maxHeight } : {}),
        zIndex,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {props.children}
    </div>,
    document.body,
  );
}
