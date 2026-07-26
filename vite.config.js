import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Load all env vars (including non-VITE_ prefixed ones) so we can
  // forward the Supabase integration vars that arrive without the VITE_ prefix.
  const env = loadEnv(mode, process.cwd(), "");

  return {
  plugins: [react()],
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
    minify: "terser",
    terserOptions: {
      compress: { drop_console: true, passes: 2 },
      mangle: true,
    },
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
