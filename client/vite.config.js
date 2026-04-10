import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative paths so it works from any folder (SharePoint, file share, etc.)
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
