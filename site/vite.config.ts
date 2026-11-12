import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages serves the site under /vouch/; Vercel serves it at the domain root.
export default defineConfig({
  base: process.env.VERCEL ? '/' : '/vouch/',
  plugins: [react(), tailwindcss()],
  server: { port: 5187, strictPort: true },
  preview: { port: 5187, strictPort: true },
});
