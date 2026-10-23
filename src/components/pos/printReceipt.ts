import '../../styles/receipt.css';

const ROOT_ID = 'receipt-print-root';
let printJob = 0;

/**
 * Prints one receipt instead of the whole screen. The node (a `.receipt-paper` element) is copied
 * into a body-level print root; print CSS in styles/receipt.css hides everything else while
 * `html.receipt-printing` is set, so the open POS / Sales History behind the dialog never prints.
 */
export function printReceipt(node: HTMLElement | null) {
  if (!node) { window.print(); return; }
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('aria-hidden', 'true');
    document.body.appendChild(root);
  }
  const copy = node.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  root.replaceChildren(copy);

  const job = ++printJob;
  const html = document.documentElement;
  html.classList.add('receipt-printing');
  // Long lists expand every row on beforeprint (useProgressiveList) so printed ledgers are complete.
  // A receipt prints none of them, so that work is skipped for this print.
  const skipListExpansion = (event: Event) => event.stopImmediatePropagation();
  const cleanup = () => {
    window.removeEventListener('afterprint', cleanup);
    window.removeEventListener('beforeprint', skipListExpansion, { capture: true });
    if (job !== printJob) return;
    html.classList.remove('receipt-printing');
    root?.replaceChildren();
  };
  window.addEventListener('beforeprint', skipListExpansion, { capture: true, once: true });
  window.addEventListener('afterprint', cleanup);
  window.print();
  // Desktop print() blocks until the dialog closes; mobile browsers return at once and fire afterprint later.
  window.setTimeout(cleanup, 60_000);
}
