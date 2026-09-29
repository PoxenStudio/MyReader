// Offload inflate/deflate to a web worker so ZIP decompression stops
// competing with layout/pagination on the main thread — the win that matters
// on weak-CPU (e-ink) devices where a single inflate can block rendering for
// tens of ms. zip.js 2.8's browser build embeds its worker (code + wasm) as
// an inline blob, so enabling workers needs no extra assets; if the platform
// has no Worker at all or CSP blocks `blob:` workers, `new Worker` throws and
// zip.js falls back to main-thread execution on its own. The probe below adds
// a cheap message round trip (cached for the session) so a webview that
// constructs workers but cannot actually run them — the only failure mode
// zip.js does NOT cover — degrades to main-thread too instead of failing
// mid-read on the book path. Warmed at idle so it is settled before a book opens.
const PROBE_TIMEOUT_MS = 500;
let webWorkerProbe: Promise<boolean> | null = null;

const probeWebWorkers = (): Promise<boolean> => {
  if (!webWorkerProbe) {
    webWorkerProbe = (async () => {
      try {
        const url = URL.createObjectURL(
          new Blob(['self.onmessage=e=>self.postMessage(e.data)'], {
            type: 'text/javascript',
          }),
        );
        const worker = new Worker(url);
        try {
          return await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
            worker.onmessage = () => {
              clearTimeout(timer);
              resolve(true);
            };
            worker.onerror = () => {
              clearTimeout(timer);
              resolve(false);
            };
            worker.postMessage(0);
          });
        } finally {
          worker.terminate();
          try {
            URL.revokeObjectURL(url);
          } catch {
            // ignore — probe result already decided above
          }
        }
      } catch {
        return false;
      }
    })();
  }
  return webWorkerProbe;
};

if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
  const warm = () => void probeWebWorkers();
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(warm);
  else setTimeout(warm, 0);
}

// zip.js config is global: per-task options go to the ZipWriter/ZipReader
// constructor, never here, so a backup can't change settings mid-read.
export const configureZip = async () => {
  const { configure } = await import('@zip.js/zip.js');
  configure({
    useCompressionStream: false,
    useWebWorkers: await probeWebWorkers(),
  });
};
