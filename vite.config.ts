import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            // Rich-text editor
            if (id.includes('@tiptap') || id.includes('prosemirror') || id.includes('w3c-keyname')) {
              return 'vendor-tiptap';
            }
            // Firebase SDK
            if (id.includes('firebase')) {
              return 'vendor-firebase';
            }
            // Date utilities
            if (id.includes('date-fns') || id.includes('react-day-picker')) {
              return 'vendor-date';
            }
            // UI component libraries (radix, floating-ui, icons, toasts)
            if (id.includes('radix-ui') || id.includes('@floating-ui') || id.includes('lucide-react') || id.includes('sonner')) {
              return 'vendor-ui';
            }
            // React core (exact package match)
            if (/node_modules[\\/]react-dom[\\/]/.test(id) ||
                /node_modules[\\/]react[\\/]/.test(id) ||
                /node_modules[\\/]scheduler[\\/]/.test(id) ||
                id.includes('use-sync-external-store')) {
              return 'vendor-react';
            }
            // Router (react-router + its internal @remix-run/router)
            if (id.includes('react-router') || id.includes('@remix-run/router')) {
              return 'vendor-router';
            }
            // Forms + validation
            if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('/zod/')) {
              return 'vendor-forms';
            }
            // PDF viewer (pdfjs-dist core — worker is already a separate asset)
            if (id.includes('pdfjs-dist') && !id.includes('worker')) {
              return 'vendor-pdf';
            }
            // XML/document processing (jszip dependencies)
            if (id.includes('xmlbuilder') || id.includes('@xmldom') || id.includes('bluebird') || id.includes('jszip')) {
              return 'vendor-docproc';
            }
          }
        },
      },
    },
  },
})
