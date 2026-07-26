import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2020",
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // React in its own long-cached chunk; each tool route is already
        // split automatically via React.lazy() dynamic imports.
        manualChunks: { vendor: ["react", "react-dom"] },
      },
    },
  },
});
