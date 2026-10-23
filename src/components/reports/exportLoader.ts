// Excel / CSV / print / copy code is loaded only when someone is about to use it.
// Call `preloadExport()` on hover or focus of an export control; by the time it is clicked the
// module is usually ready, so `loadedExport()` can run it synchronously inside the click
// (pop-ups, clipboard and share sheets need that user gesture).
type ExportModule = typeof import('../../lib/reports/export');

let loaded: ExportModule | null = null;
let pending: Promise<ExportModule> | null = null;

export function preloadExport(): Promise<ExportModule> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= import('../../lib/reports/export')
    .then(mod => (loaded = mod))
    .catch(error => { pending = null; throw error; });
  return pending;
}

export const loadedExport = () => loaded;
