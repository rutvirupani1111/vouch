import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/vouch/',
  plugins: [react(), tailwindcss()],
  server: { port: 5187, strictPort: true },
  preview: { port: 5187, strictPort: true },
});
