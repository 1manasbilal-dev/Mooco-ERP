const importRuntime = () => Promise.all([import('html2canvas'), import('jspdf')])
  .then(([canvas, pdf]) => ({ html2canvas: canvas.default, jsPDF: pdf.default }));
let runtime: ReturnType<typeof importRuntime> | undefined;

// Load only for an actual export, share concurrent requests and allow failed loads to retry.
export function loadPdfRuntime() {
  if (!runtime) runtime = importRuntime().catch(error => { runtime = undefined; throw error; });
  return runtime;
}
