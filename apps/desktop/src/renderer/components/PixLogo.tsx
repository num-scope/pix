/**
 * Pix brand mark — sidebar / chrome.
 * Geometry mirrors `src/renderer/assets/logo.svg` and `build/icon.svg`.
 */
import { cn } from "../lib/utils.ts";

export function PixLogo(props: { className?: string; title?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="none"
      className={cn("size-5 shrink-0", props.className)}
      role="img"
      aria-label={props.title ?? "Pix"}
    >
      <defs>
        <linearGradient id="pixLogoBg" x1="5" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#222228" />
          <stop offset="1" stopColor="#121216" />
        </linearGradient>
        <linearGradient
          id="pixLogoMark"
          x1="9"
          y1="7"
          x2="23"
          y2="25"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#9BB0FF" />
          <stop offset="0.55" stopColor="#5B7CFF" />
          <stop offset="1" stopColor="#3B82F6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#pixLogoBg)" />
      <rect x="8.5" y="9" width="15" height="3.2" rx="1.6" fill="url(#pixLogoMark)" />
      <rect x="10" y="10.5" width="3.2" height="13" rx="1.6" fill="url(#pixLogoMark)" />
      <rect x="17" y="10.5" width="3.2" height="10.5" rx="1.6" fill="url(#pixLogoMark)" />
      <rect x="21.5" y="7.5" width="3.6" height="3.6" rx="0.95" fill="#7DD3FC" />
      <rect x="25" y="9.2" width="2.1" height="2.1" rx="0.55" fill="#38BDF8" />
      <rect x="22.8" y="5.6" width="1.7" height="1.7" rx="0.45" fill="#E0F2FE" />
    </svg>
  );
}
