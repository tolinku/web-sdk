import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: false,
  },
  {
    // The CDN build. The Integrate page in the dashboard hands out a script tag
    // pointing at dist/tolinku.min.js, and until now no such file was ever
    // built or published, so that snippet was a 404.
    entry: { 'tolinku.min': 'src/browser.ts' },
    format: ['iife'],
    // No globalName: src/browser.ts assigns the class to globalThis itself, so
    // window.Tolinku is the class and not a namespace wrapping it.
    sourcemap: true,
    clean: false,
    treeshake: true,
    minify: true,
    dts: false,
  },
]);
