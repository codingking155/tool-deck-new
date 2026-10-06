import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";

/* Sheaf (public/sheaf, the PDF Toolkit's visual studio) is plain scripts that expect its libraries
   and fonts next to it. Copy them from node_modules into public/sheaf/vendor (gitignored) so dev,
   build and the CSP preview all serve them same-origin — no CDN, no CSP exceptions. */
function sheafVendor() {
  const out = "public/sheaf/vendor";
  const files = {
    "pdf-lib.min.js": "@cantoo/pdf-lib/dist/pdf-lib.min.js",
    "pdf.min.mjs": "pdfjs-dist/build/pdf.min.mjs",
    "pdf.worker.min.mjs": "pdfjs-dist/build/pdf.worker.min.mjs",
    "jszip.min.js": "jszip/dist/jszip.min.js",
    "Sortable.min.js": "sortablejs/Sortable.min.js",
  };
  const fonts = [["Besley", "besley", [500, 700, 800]], ["Instrument Sans", "instrument-sans", [400, 500, 600, 700]], ["Mrs Saint Delafield", "mrs-saint-delafield", [400]]];
  return {
    name: "sheaf-vendor",
    buildStart() {
      mkdirSync(`${out}/fonts`, { recursive: true });
      for (const [to, from] of Object.entries(files)) copyFileSync(`node_modules/${from}`, `${out}/${to}`);
      let css = "";
      for (const [family, pkg, weights] of fonts) for (const w of weights) {
        const f = `${pkg}-latin-${w}-normal.woff2`;
        copyFileSync(`node_modules/@fontsource/${pkg}/files/${f}`, `${out}/fonts/${f}`);
        css += `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url(fonts/${f}) format('woff2')}\n`;
      }
      writeFileSync(`${out}/fonts.css`, css);
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load all env vars (including non-VITE_ prefixed ones) so we can
  // forward the Supabase integration vars that arrive without the VITE_ prefix.
  const env = loadEnv(mode, process.cwd(), "");

  return {
  plugins: [react(), sheafVendor()],
  define: {
    // Make Supabase vars available as import.meta.env.VITE_SUPABASE_* even
    // when the integration injects them without the VITE_ prefix.
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
      env.VITE_SUPABASE_URL || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || ""
    ),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(
      env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
    ),
  },
  build: {
    target: "es2020",
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // React in its own long-cached chunk; each tool route is already
        // split automatically via React.lazy() dynamic imports.
        manualChunks: { vendor: ["react", "react-dom"] },
        // Optimize chunk size with better naming for caching
        chunkFileNames: "js/[name]-[hash].js",
        entryFileNames: "js/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  };
});
