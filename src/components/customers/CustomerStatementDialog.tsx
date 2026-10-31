import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Printer } from 'lucide-react';
import { Button, Modal, SegmentedControl } from '../ui';
import { useToast } from '../../context/ToastContext';
import type { Customer } from '../../types';
import { rangeLabel } from '../../lib/supplierStatement';
import { LedgerPeriodPicker, periodRange, type PeriodChoice } from './LedgerPeriodPicker';
import { paginateStatement, saveStatementPdf, statementFilename, statementHtml } from './statementDoc';
import type { LedgerEntry, LedgerPeriod } from './customerUtils';
import type { ShopInfo } from './printDocs';

// The document is laid out at full A5 width (559px plus its margin) and scaled down to fit a phone.
const SHEET_WIDTH = 585;

type PrintStyle = 'mono' | 'color';
const STYLE_KEY = 'statement_print_style';

// Most statements go to a black-ink printer, so black and white is the default until someone picks colour.
const savedStyle = (): PrintStyle => {
  try {
    return localStorage.getItem(STYLE_KEY) === 'color' ? 'color' : 'mono';
  } catch {
    return 'mono';
  }
};

export interface CustomerStatementDialogProps {
  customer: Customer;
  shop: ShopInfo;
  period: LedgerPeriod;
  rows: LedgerEntry[];
  filterNote?: string;
  ledgerGap: number;
  choice: PeriodChoice;
  onChoiceChange: (choice: PeriodChoice) => void;
  onClose: () => void;
}

export default function CustomerStatementDialog({
  customer, shop, period, rows, filterNote, ledgerGap, choice, onChoiceChange, onClose,
}: CustomerStatementDialogProps) {
  const { showToast } = useToast();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [scale, setScale] = useState(1);
  const [saving, setSaving] = useState<string | null>(null);
  const [printStyle, setPrintStyle] = useState<PrintStyle>(savedStyle);

  const { from, to } = periodRange(choice);
  const html = useMemo(() => {
    return statementHtml({
      customer, shop, period, rows, from, to, filterNote, ledgerGap, mono: printStyle === 'mono',
      issuedDay: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
    });
  }, [customer, shop, period, rows, from, to, filterNote, ledgerGap, printStyle]);

  // Print and PDF wait until the new document has been laid out.
  useEffect(() => setPageCount(0), [html]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setScale(Math.min(1, box.clientWidth / SHEET_WIDTH)));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const handleLoad = async () => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.getElementById('pages')) return;
    // Page breaks depend on the font's widths, but a dead font server must never hold the statement back.
    await Promise.race([
      doc.fonts.load("700 12px 'Plus Jakarta Sans'").then(() => doc.fonts.ready),
      new Promise(resolve => setTimeout(resolve, 2500)),
    ]).catch(() => undefined);
    if (frameRef.current?.contentDocument !== doc) return;
    const count = paginateStatement(doc);
    setSheetHeight(doc.documentElement.scrollHeight);
    setPageCount(count);
  };

  const pickStyle = (style: PrintStyle) => {
    setPrintStyle(style);
    try {
      localStorage.setItem(STYLE_KEY, style);
    } catch {
      // Without storage the choice just lasts until the dialog closes.
    }
  };

  const handlePrint = () => {
    frameRef.current?.contentWindow?.focus();
    frameRef.current?.contentWindow?.print();
  };

  const handleSavePdf = async () => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    try {
      await saveStatementPdf(doc, statementFilename(customer.name, from, to), (done, total) => setSaving(`Page ${Math.min(done + 1, total)} of ${total}`));
      showToast('PDF saved to your downloads', 'success');
    } catch (err: any) {
      showToast("PDF couldn't be created: " + (err?.message || 'please try again'), 'error');
    } finally {
      setSaving(null);
    }
  };

  const ready = pageCount > 0;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      dismissible={!saving}
      icon={<span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-fg"><FileText className="size-5" /></span>}
      title="Customer statement"
      description={`${customer.name} · ${from || to ? rangeLabel(from, to) : 'All time'}${ready ? ` · ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}` : ''}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={Boolean(saving)}>Close</Button>
          <Button variant="secondary" leftIcon={<Printer />} onClick={handlePrint} disabled={!ready || Boolean(saving)}>Print</Button>
          <Button leftIcon={<Download />} onClick={handleSavePdf} disabled={!ready || Boolean(saving)}>{saving || 'Save PDF'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <LedgerPeriodPicker value={choice} onChange={onChoiceChange} />
          <SegmentedControl<PrintStyle>
            aria-label="Print colour"
            size="sm"
            value={printStyle}
            onChange={pickStyle}
            options={[{ value: 'mono', label: 'Black & white' }, { value: 'color', label: 'Color' }]}
          />
        </div>
        <div ref={boxRef} className="overflow-hidden rounded-control border border-line bg-[#e8eae4]" style={{ height: sheetHeight ? sheetHeight * scale : 320 }}>
          <iframe
            ref={frameRef}
            title="Statement preview"
            srcDoc={html}
            onLoad={handleLoad}
            scrolling="no"
            className="mx-auto block origin-top-left border-0"
            style={{ width: SHEET_WIDTH, height: sheetHeight || 320, transform: `scale(${scale})`, visibility: ready ? 'visible' : 'hidden' }}
          />
        </div>
      </div>
    </Modal>
  );
}
