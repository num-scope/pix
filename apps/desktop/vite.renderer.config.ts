import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  root: resolve(import.meta.dirname, "src/renderer"),
  base: "./",
  plugins: [tailwindcss()],
  build: {
    outDir: resolve(import.meta.dirname, "dist/renderer"),
    emptyOutDir: true,
    sourcemap: true,
    // Mermaid's generated parser is a lazy 663 kB chunk (143 kB gzip); app entry chunks stay lower.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /node_modules[\\/](?:react|react-dom|scheduler|zustand|lucide-react|clsx|tailwind-merge|class-variance-authority)[\\/]/,
            },
            {
              name: "rich-content-vendor",
              test: /node_modules[\\/](?:katex|highlight\.js)[\\/]/,
            },
            {
              name: "markdown-vendor",
              test: /node_modules[\\/](?:react-markdown|remark-[^\\/]+|rehype-[^\\/]+|unified|micromark[^\\/]*|mdast-util-[^\\/]+|hast-util-[^\\/]+|unist-util-[^\\/]+|vfile[^\\/]*|property-information)[\\/]/,
            },
          ],
        },
      },
    },
  },
  test: {
    include: ["**/*.test.ts", "../agent-host/**/*.test.ts"],
    exclude: ["**/e2e/**", "**/node_modules/**"],
  },
});
