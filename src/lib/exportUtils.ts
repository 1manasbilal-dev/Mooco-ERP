export function exportToCSV(filename: string, headers: string[], rows: (string | number | boolean | null | undefined)[][]): void {
  const sanitizeCell = (cell: string | number | boolean | null | undefined): string => {
    if (cell === null || cell === undefined) return '""';
    let str = String(cell);
    // Text starting with =, +, -, @ would run as a spreadsheet formula; keep it as text. Numbers pass through.
    if (typeof cell === 'string' && /^[=+\-@\t\r]/.test(str) && !/^[+-]?\d[\d,.]*$/.test(str)) str = `'${str}`;
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const csvContent = [
    headers.map(sanitizeCell).join(','),
    ...rows.map(row => row.map(sanitizeCell).join(','))
  ].join('\r\n');

  // A UTF-8 BOM so Excel reads the file as UTF-8
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename.replace(/\s+/g, '_')}_${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
