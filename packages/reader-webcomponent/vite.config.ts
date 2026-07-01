import { defineConfig } from 'vite';

// root stays at the package root (not demo/) so demo/index.html's
// `../src/index.ts` script reference resolves to a server path (/src/index.ts)
// that Vite can actually serve, instead of falling outside the server root.
// `build.lib` only takes effect for `vite build` — it does not affect the
// `vite` dev server used for the demo (demo/index.html is not a build entry).
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'MyReader',
      formats: ['es', 'umd'],
      fileName: (format) => `myreader.${format === 'es' ? 'esm' : 'umd'}.js`,
    },
    rollupOptions: {
      // foliate-js/pdf.js statically imports the `@pdfjs/*` alias that
      // app/ resolves via its own bundler config + vendored pdf.js assets.
      // This package is EPUB-only for now (no vendored pdf.js, see
      // document/MyReader_WebComponent_Design.md §9.1) — PDF support is
      // deferred, so the branch that reaches this import is externalized
      // rather than bundled, just so `DocumentLoader`'s dynamic import()
      // of the PDF loader doesn't block the whole build.
      external: [/^@pdfjs\//],
    },
  },
});
