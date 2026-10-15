import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    root: __dirname,
    server: {
        port: 3000,
        host: '0.0.0.0',
        watch: {
          ignored: ['**/*.zip', '**/dist/**', '**/.git/**', '**/screenshots/**', '**/*.csv', '**/*.xlsx']
        }
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        manifest: true,
        rollupOptions: {
          output: {
            manualChunks(id) {
              const moduleId = id.replace(/\\/g, '/');
              // Keep shared JSX/CommonJS helpers out of optional chart/motion chunks.
              if (moduleId.includes('commonjsHelpers')) return 'vendor-runtime';
              if (!moduleId.includes('/node_modules/')) return;
              if (moduleId.includes('/node_modules/clsx/')) return 'vendor-runtime';
              if (/\/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(moduleId)) return 'vendor-react';
              if (/\/node_modules\/(framer-motion|motion-dom|motion-utils)\//.test(moduleId)) return 'vendor-motion';
              if (/\/node_modules\/(recharts|recharts-scale|d3-[^/]+)\//.test(moduleId)) return 'vendor-charts';
              if (moduleId.includes('/node_modules/lucide-react/')) return 'vendor-icons';
              if (moduleId.includes('/node_modules/@supabase/')) return 'vendor-supabase';
            }
          }
        },
      chunkSizeWarningLimit: 800
    }
});
