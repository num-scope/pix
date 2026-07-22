/** Selectors that share auto-hide overlay scrollbar chrome (no layout gutter). */
export const OVERLAY_SCROLL_SELECTOR =
  ".pix-scroll, .timeline-scroll, .page-body, .settings-page-body";

const HIDE_MS = 900;
const THUMB_CLASS = "pix-scroll-thumb";
const MIN_THUMB_PX = 28;
const THUMB_HITBOX_PX = 12;

let nextId = 0;

interface ThumbDragState {
  host: HTMLElement;
  thumb: HTMLDivElement;
  pointerId: number;
  startY: number;
  startScrollTop: number;
  thumbHeight: number;
  previousScrollBehavior: string;
}

function isScrollport(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && el.matches(OVERLAY_SCROLL_SELECTOR);
}

function hostId(host: HTMLElement): string {
  let id = host.dataset.pixScrollId;
  if (!id) {
    id = `ps${++nextId}`;
    host.dataset.pixScrollId = id;
  }
  return id;
}

/**
 * Thumb lives on document.body (position:fixed) so React re-renders never strip it,
 * and so it never participates in the scrollport's layout width.
 */
function ensureThumb(host: HTMLElement): HTMLDivElement {
  const id = hostId(host);
  let thumb = document.querySelector<HTMLDivElement>(
    `.${THUMB_CLASS}[data-for="${CSS.escape(id)}"]`,
  );
  if (!thumb) {
    thumb = document.createElement("div");
    thumb.className = THUMB_CLASS;
    thumb.dataset.for = id;
    thumb.setAttribute("aria-hidden", "true");
    document.body.appendChild(thumb);
  }
  return thumb;
}

function removeThumb(host: HTMLElement): void {
  const id = host.dataset.pixScrollId;
  if (!id) return;
  document.querySelector(`.${THUMB_CLASS}[data-for="${CSS.escape(id)}"]`)?.remove();
}

function thumbForHost(host: HTMLElement): HTMLDivElement | null {
  const id = host.dataset.pixScrollId;
  if (!id) return null;
  return document.querySelector<HTMLDivElement>(`.${THUMB_CLASS}[data-for="${CSS.escape(id)}"]`);
}

function hostForThumb(thumb: Element): HTMLElement | null {
  const id = thumb.getAttribute("data-for");
  if (!id) return null;
  const host = document.querySelector<HTMLElement>(`[data-pix-scroll-id="${CSS.escape(id)}"]`);
  return host && isScrollport(host) ? host : null;
}

function eventThumb(target: EventTarget | null): HTMLDivElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLDivElement>(`.${THUMB_CLASS}`);
}

export function scrollTopFromThumbDrag(input: {
  startScrollTop: number;
  deltaY: number;
  clientHeight: number;
  scrollHeight: number;
  thumbHeight: number;
}): number {
  const scrollRange = Math.max(0, input.scrollHeight - input.clientHeight);
  const thumbRange = Math.max(1, input.clientHeight - input.thumbHeight);
  const next = input.startScrollTop + (input.deltaY / thumbRange) * scrollRange;
  return Math.min(scrollRange, Math.max(0, next));
}

/**
 * Position a floating thumb over the scrollport. Native scrollbar stays fully
 * suppressed so content width never shrinks/expands.
 */
export function updateOverlayThumb(host: HTMLElement, visible: boolean): void {
  if (!host.isConnected) {
    removeThumb(host);
    return;
  }
  const thumb = ensureThumb(host);
  const { scrollTop, scrollHeight, clientHeight } = host;
  if (scrollHeight <= clientHeight + 1) {
    thumb.dataset.visible = "false";
    return;
  }

  const rect = host.getBoundingClientRect();
  const track = clientHeight;
  const thumbH = Math.max(MIN_THUMB_PX, (clientHeight / scrollHeight) * track);
  const maxTop = Math.max(0, track - thumbH);
  const progress = scrollTop / Math.max(1, scrollHeight - clientHeight);
  const visualTop = maxTop * progress;

  thumb.style.height = `${thumbH}px`;
  thumb.style.top = `${rect.top + visualTop}px`;
  thumb.style.left = `${rect.right - THUMB_HITBOX_PX}px`;
  const pinned = thumb.dataset.hovered === "true" || thumb.dataset.dragging === "true";
  thumb.dataset.visible = visible || pinned ? "true" : "false";
}

/**
 * Overlay-style scrollbars: native bar never reserves width; a floating thumb
 * shows while scrolling and auto-hides after idle.
 */
export function installOverlayScroll(root: ParentNode = document): () => void {
  const timers = new Map<HTMLElement, number>();
  let drag: ThumbDragState | undefined;

  const clearHide = (host: HTMLElement) => {
    const timer = timers.get(host);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.delete(host);
  };

  const scheduleHide = (host: HTMLElement) => {
    clearHide(host);
    const id = window.setTimeout(() => {
      timers.delete(host);
      const thumb = thumbForHost(host);
      if (thumb?.dataset.hovered === "true" || thumb?.dataset.dragging === "true") return;
      host.removeAttribute("data-scrolling");
      updateOverlayThumb(host, false);
    }, HIDE_MS);
    timers.set(host, id);
  };

  const show = (host: HTMLElement) => {
    host.setAttribute("data-scrolling", "true");
    updateOverlayThumb(host, true);
  };

  const onScroll = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element) || !isScrollport(target)) return;

    show(target);
    const thumb = thumbForHost(target);
    if (thumb?.dataset.hovered !== "true" && thumb?.dataset.dragging !== "true") {
      scheduleHide(target);
    }
  };

  const onResize = () => {
    document.querySelectorAll(OVERLAY_SCROLL_SELECTOR).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const thumb = thumbForHost(node);
      const visible =
        node.getAttribute("data-scrolling") === "true" ||
        thumb?.dataset.hovered === "true" ||
        thumb?.dataset.dragging === "true";
      if (node.scrollHeight > node.clientHeight) updateOverlayThumb(node, visible);
      else removeThumb(node);
    });
  };

  const onPointerOver = (event: PointerEvent) => {
    const thumb = eventThumb(event.target);
    if (!thumb || (event.relatedTarget instanceof Node && thumb.contains(event.relatedTarget))) {
      return;
    }
    const host = hostForThumb(thumb);
    if (!host) return;
    thumb.dataset.hovered = "true";
    clearHide(host);
    show(host);
  };

  const onPointerOut = (event: PointerEvent) => {
    const thumb = eventThumb(event.target);
    if (!thumb || (event.relatedTarget instanceof Node && thumb.contains(event.relatedTarget))) {
      return;
    }
    const host = hostForThumb(thumb);
    if (!host) return;
    delete thumb.dataset.hovered;
    if (thumb.dataset.dragging !== "true") scheduleHide(host);
  };

  const finishDrag = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const { host, thumb, pointerId, previousScrollBehavior } = drag;
    drag = undefined;
    host.style.scrollBehavior = previousScrollBehavior;
    delete thumb.dataset.dragging;
    if (thumb.hasPointerCapture?.(pointerId)) thumb.releasePointerCapture(pointerId);
    if (thumb.matches(":hover")) {
      thumb.dataset.hovered = "true";
      show(host);
    } else {
      delete thumb.dataset.hovered;
      scheduleHide(host);
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const thumb = eventThumb(event.target);
    if (!thumb || thumb.dataset.visible !== "true") return;
    const host = hostForThumb(thumb);
    if (!host) return;

    clearHide(host);
    const previousScrollBehavior = host.style.scrollBehavior;
    host.style.scrollBehavior = "auto";
    drag = {
      host,
      thumb,
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: host.scrollTop,
      thumbHeight: thumb.getBoundingClientRect().height,
      previousScrollBehavior,
    };
    thumb.dataset.dragging = "true";
    show(host);
    thumb.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.host.isConnected) {
      finishDrag(event);
      return;
    }
    drag.host.scrollTop = scrollTopFromThumbDrag({
      startScrollTop: drag.startScrollTop,
      deltaY: event.clientY - drag.startY,
      clientHeight: drag.host.clientHeight,
      scrollHeight: drag.host.scrollHeight,
      thumbHeight: drag.thumbHeight,
    });
    updateOverlayThumb(drag.host, true);
    event.preventDefault();
  };

  root.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("pointerover", onPointerOver);
  document.addEventListener("pointerout", onPointerOut);
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", finishDrag);
  document.addEventListener("pointercancel", finishDrag);

  return () => {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    if (drag) drag.host.style.scrollBehavior = drag.previousScrollBehavior;
    drag = undefined;
    root.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("pointerover", onPointerOver);
    document.removeEventListener("pointerout", onPointerOut);
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", finishDrag);
    document.removeEventListener("pointercancel", finishDrag);
    document.querySelectorAll(`.${THUMB_CLASS}`).forEach((n) => n.remove());
  };
}
