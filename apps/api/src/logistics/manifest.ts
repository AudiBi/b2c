import PDFDocument from 'pdfkit';

export interface ManifestRow {
  n: number;
  trackingNumber: string;
  customerCode: string;
  customerName: string;
  description: string;
  supplierTracking: string;
  actualWeightKg: string;
  declaredValue: string;
  declaredCurrency: string;
}

export interface ManifestData {
  reference: string;
  status: string;
  transportMode: string;
  origin: string;
  destination: string;
  carrierName: string;
  transportRef: string;
  departedAt: string;
  arrivedAt: string;
  generatedAt: string;
  rows: ManifestRow[];
  totals: { count: number; actualWeightKg: string; declared: Record<string, string> };
}

/**
 * Protection contre l'injection de formules : un tableur interprète une cellule qui commence par = + - @ (ou
 * une tabulation / un retour chariot) comme une formule. Les textes saisis par des tiers (nom du client, contenu…)
 * sont donc précédés d'une apostrophe, puis protégés selon la RFC 4180.
 */
export function csvCell(value: string): string {
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const HEADER = ['N°', 'Numéro de suivi', 'Code client', 'Client', 'Contenu', 'N° du marchand', 'Poids réel (kg)', 'Valeur déclarée', 'Devise'];

/** CSV en UTF-8 avec BOM (ouverture correcte des accents dans Excel). */
export function manifestCsv(data: ManifestData): string {
  const lines: string[] = [];
  const meta: [string, string][] = [
    ['Lot', data.reference],
    ['Mode', data.transportMode],
    ['Origine', data.origin],
    ['Destination', data.destination],
    ['Transporteur', data.carrierName],
    ['N° de connaissement / LTA', data.transportRef],
    ['Statut', data.status],
    ['Départ réel', data.departedAt],
    ['Arrivée réelle', data.arrivedAt],
    ['Édité le', data.generatedAt],
  ];
  for (const [label, value] of meta) lines.push(`${csvCell(label)},${csvCell(value)}`);
  lines.push('');
  lines.push(HEADER.map(csvCell).join(','));
  for (const r of data.rows) {
    lines.push(
      [String(r.n), r.trackingNumber, r.customerCode, r.customerName, r.description, r.supplierTracking, r.actualWeightKg, r.declaredValue, r.declaredCurrency].map(csvCell).join(','),
    );
  }
  lines.push('');
  lines.push(['', 'Total', '', '', '', '', data.totals.actualWeightKg, '', ''].map(csvCell).join(','));
  lines.push([`Nombre de colis`, String(data.totals.count)].map(csvCell).join(','));
  for (const [currency, amount] of Object.entries(data.totals.declared)) lines.push(['Valeur déclarée totale', amount, currency].map(csvCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Manifeste imprimable (A4 paysage). Les dates sont celles réellement saisies ; aucune prévision n'y figure. */
export function manifestPdf(data: ManifestData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: `Manifeste ${data.reference}`, Producer: 'Plateforme logistique' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(16).text(`Manifeste du lot ${data.reference}`);
    doc.moveDown(0.3).font('Helvetica').fontSize(9);
    doc.text(`Mode : ${data.transportMode}   ·   Statut : ${data.status}   ·   Origine : ${data.origin}   ·   Destination : ${data.destination}`);
    doc.text(`Transporteur : ${data.carrierName || '—'}   ·   Connaissement / LTA : ${data.transportRef || '—'}`);
    doc.text(`Départ réel : ${data.departedAt || '—'}   ·   Arrivée réelle : ${data.arrivedAt || '—'}   ·   Édité le : ${data.generatedAt}`);
    doc.moveDown(0.8);

    const columns: { title: string; width: number; get: (r: ManifestRow) => string; align?: 'right' }[] = [
      { title: 'N°', width: 28, get: (r) => String(r.n) },
      { title: 'Suivi', width: 105, get: (r) => r.trackingNumber },
      { title: 'Code client', width: 70, get: (r) => r.customerCode },
      { title: 'Client', width: 150, get: (r) => r.customerName },
      { title: 'Contenu', width: 215, get: (r) => r.description },
      { title: 'Poids (kg)', width: 60, get: (r) => r.actualWeightKg, align: 'right' },
      { title: 'Valeur déclarée', width: 100, get: (r) => (r.declaredValue ? `${r.declaredValue} ${r.declaredCurrency}` : ''), align: 'right' },
    ];
    const left = doc.page.margins.left;
    const rowHeight = 16;
    const drawRow = (cells: string[], bold: boolean) => {
      if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
      }
      const y = doc.y;
      let x = left;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      columns.forEach((column, i) => {
        doc.text(cells[i] ?? '', x + 2, y + 3, { width: column.width - 4, height: rowHeight - 4, ellipsis: true, lineBreak: false, align: column.align ?? 'left' });
        x += column.width;
      });
      doc.moveTo(left, y + rowHeight).lineTo(x, y + rowHeight).lineWidth(0.3).strokeColor('#999999').stroke();
      doc.y = y + rowHeight;
    };
    drawRow(columns.map((c) => c.title), true);
    for (const row of data.rows) drawRow(columns.map((c) => c.get(row)), false);

    doc.moveDown(1).font('Helvetica-Bold').fontSize(10).text(`Total : ${data.totals.count} colis — ${data.totals.actualWeightKg} kg`, left);
    for (const [currency, amount] of Object.entries(data.totals.declared)) doc.font('Helvetica').fontSize(9).text(`Valeur déclarée totale : ${amount} ${currency}`, left);
    doc.end();
  });
}
