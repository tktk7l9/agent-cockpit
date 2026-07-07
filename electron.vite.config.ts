import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// Dependencies are bundled into out/ (no externalizeDepsPlugin) so the packaged
// app ships without node_modules. All deps are pure JS — nothing native.
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        output: { format: "cjs" },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        // sandboxed preload scripts must be CommonJS
        output: { format: "cjs" },
      },
    },
  },
  renderer: {
    plugins: [
      react(),
      {
        name: "inject-csp",
        transformIndexHtml: {
          order: "post" as const,
          handler(html: string, ctx: { server?: unknown }) {
            // dev server needs react-refresh inline scripts; production gets strict CSP
            if (ctx.server) return html.replace("<!--csp-->", "");
            return html.replace(
              "<!--csp-->",
              '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'self\'; font-src \'self\'; object-src \'none\'; base-uri \'none\'" />',
            );
          },
        },
      },
    ],
  },
});
