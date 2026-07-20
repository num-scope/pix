/** Selectors that share auto-hide overlay scrollbar chrome (no layout gutter). */
export const OVERLAY_SCROLL_SELECTOR =
  ".pix-scroll, .timeline-scroll, .page-body, .settings-page-body";

const HIDE_MS = 900;
const THUMB_CLASS = "pix-scroll-thumb";
const MIN_THUMB_PX = 28;

let nextId = 0;

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
    thumb.style.opacity = "0";
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
  thumb.style.left = `${rect.right - 8}px`;
  thumb.dataset.visible = visible ? "true" : "false";
  thumb.style.opacity = visible ? "1" : "0";
}

/**
 * Overlay-style scrollbars: native bar never reserves width; a floating thumb
 * shows while scrolling and auto-hides after idle.
 */
export function installOverlayScroll(root: ParentNode = document): () => void {
  const timers = new WeakMap<Element, number>();

  const onScroll = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element) || !isScrollport(target)) return;

    updateOverlayThumb(target, true);
    target.setAttribute("data-scrolling", "true");
    const prev = timers.get(target);
    if (prev !== undefined) window.clearTimeout(prev);
    const id = window.setTimeout(() => {
      target.removeAttribute("data-scrolling");
      timers.delete(target);
      if (target instanceof HTMLElement) updateOverlayThumb(target, false);
    }, HIDE_MS);
    timers.set(target, id);
  };

  const onResize = () => {
    document.querySelectorAll(OVERLAY_SCROLL_SELECTOR).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const show = node.getAttribute("data-scrolling") === "true";
      if (node.scrollHeight > node.clientHeight) updateOverlayThumb(node, show);
      else removeThumb(node);
    });
  };

  root.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", onResize, { passive: true });

  return () => {
    root.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
    document.querySelectorAll(`.${THUMB_CLASS}`).forEach((n) => n.remove());
  };
}
