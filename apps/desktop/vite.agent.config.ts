import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "vite-plus";

const external = [
  "electron",
  "@earendil-works/pi-coding-agent",
  "@silvia-odwyer/photon-node",
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

export default defineConfig({
  build: {
    target: "node24",
    outDir: resolve(import.meta.dirname, "dist/agent-host"),
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, "src/agent-host/index.ts"),
      formats: ["es"],
      fileName: () => "agent-host.mjs",
    },
    rollupOptions: { external },
  },
});
