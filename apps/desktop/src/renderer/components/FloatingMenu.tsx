/**
 * Top-layer popup menu (portal) so sidebar overflow never clips it.
 * Built on shadcn Popover for focus/escape/animation; keeps anchor-rect API.
 */
import { useEffect, useMemo, type ReactNode } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
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
  /** When true, menu width matches the anchor rect (e.g. composer card). */
  matchAnchorWidth?: boolean;
  /**
   * When false, no drop shadow / elevated chrome (composer / and @ panels).
   * Default true keeps project-context-menu elevation for other menus.
   */
  elevated?: boolean;
  /** Gap in px between menu and anchor (default 6 above / 4 below). */
  offsetPx?: number;
}) {
  const minWidth = props.minWidth ?? 200;
  const placement = props.placement ?? "bottom";
  const zIndex = props.zIndex ?? 10_000;
  const closeOnOutside = props.closeOnOutside !== false;
  const matchAnchorWidth = props.matchAnchorWidth === true;
  const elevated = props.elevated !== false;
  const matchedWidth =
    matchAnchorWidth && props.anchor
      ? Math.max(minWidth, Math.round(props.anchor.width))
      : undefined;
  const sideOffset = props.offsetPx ?? (placement === "top" ? 6 : 4);

  const open = props.open && Boolean(props.anchor);

  // Close when the page scrolls (but not when scrolling inside this / nested menus).
  useEffect(() => {
    if (!open || !closeOnOutside) return;
    const onScroll = (ev: Event) => {
      const target = ev.target;
      if (target instanceof Node) {
        if (target instanceof Element && target.closest("[data-floating-menu]")) return;
      }
      props.onClose();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, closeOnOutside, props.onClose]);

  const anchorStyle = useMemo(() => {
    if (!props.anchor) return undefined;
    return {
      position: "fixed" as const,
      top: props.anchor.top,
      left: props.anchor.left,
      width: Math.max(1, props.anchor.width),
      height: Math.max(1, props.anchor.height),
      pointerEvents: "none" as const,
    };
  }, [props.anchor]);

  return (
    <Popover
      open={open}
      modal={false}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
    >
      {props.anchor && anchorStyle ? (
        <PopoverAnchor asChild>
          <span aria-hidden style={anchorStyle} />
        </PopoverAnchor>
      ) : null}
      <PopoverContent
        side={placement}
        align="start"
        sideOffset={sideOffset}
        collisionPadding={8}
        // Keep focus in composer / parent while the menu is open.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (!closeOnOutside) {
            e.preventDefault();
            return;
          }
          // Nested floating menus (flyouts) should not dismiss the parent.
          const target = e.target;
          if (target instanceof Element && target.closest("[data-floating-menu]")) {
            e.preventDefault();
          }
        }}
        data-testid={props.testId}
        data-floating-menu=""
        data-elevated={elevated ? "true" : "false"}
        role="menu"
        className={cn(
          "surface-panel overflow-x-hidden p-0 py-1 text-popover-foreground outline-none",
          elevated
            ? "project-context-menu max-h-[min(70vh,480px)] overflow-y-auto shadow-2xl"
            : "composer-suggest-menu overflow-hidden shadow-none",
          props.className,
        )}
        style={{
          zIndex,
          minWidth: matchedWidth ?? minWidth,
          ...(matchedWidth !== undefined ? { width: matchedWidth } : { width: "auto" }),
          ...(elevated ? {} : { boxShadow: "none", filter: "none", WebkitFilter: "none" }),
        }}
      >
        {props.children}
      </PopoverContent>
    </Popover>
  );
}
