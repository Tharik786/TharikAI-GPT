import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          pdf: ["pdfjs-dist"],
          export: ["jspdf", "xlsx", "jszip", "pptxgenjs"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL || "https://tharikai-gpt.onrender.com",
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
});
