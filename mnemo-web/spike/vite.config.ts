import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The spike is its own Vite root rather than a second entry in the app's config, so it
// cannot leak into the shipped bundle and the app's build stays untouched. It still
// produces a genuine production build, which matters: the harness refuses to record a
// measurement taken against a dev build.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  resolve: {
    alias: {
      // Reaches back into the app for the pieces the spike deliberately reuses rather
      // than reimplements, notably the KaTeX rendering primitive. Measuring a
      // reimplementation would measure the wrong thing.
      '@': path.resolve(import.meta.dirname, '../src'),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    // The spike is measured, not shipped, so readable stack frames in a profile are worth
    // more than a small bundle.
    sourcemap: true,
    // One large chunk is the intended shape here: the arm must be fully loaded before the
    // measurement starts, so code-splitting it would only move cost into the run. The default
    // warning is advice for shipped apps and is noise for this one, and on Windows it reaches
    // PowerShell as a native stderr line that aborts the run script.
    chunkSizeWarningLimit: 2000,
  },
  server: {
    // Deliberately off the app's 5173 so a spike run and an app dev server can coexist.
    port: 5199,
    strictPort: true,
  },
})
