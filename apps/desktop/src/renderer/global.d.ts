import type { PixDesktopApi } from "@pix/contracts";

declare global {
  interface Window {
    pix: PixDesktopApi;
  }
}

export {};
