import PDFDocument from 'pdfkit';
import { drawLogo } from '../branding/pdf-logo';

interface InvoicePdf {
  company: string;
  invoice: {
    number: string | null;
    status: string;
    customer: { customerCode: string; name: string };
    currency: string;
    subtotal: string | null;
    discountTotal: string | null;
    taxTotal: string | null;
    total: string | null;
    creditedTotal: string | null;
    paidTotal: string | null;
    balance: string | null;
    issuedAt: Date | null;
    dueDate: string | null;
    lines: { description: string; amount: string | null }[];
    credits: { number: string; amount: string | null }[];
  };
}

export interface ReceiptPdf {
  company: string;
  receiptNumber: string;
  issuedAt: Date;
  invoiceNumber: string;
  customer: string;
  method: string;
  reference: string | null;
  amount: string;
  currency: string;
  refunded: string;
}

function render(build: (doc: PDFKit.PDFDocument) => void, title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: title, Producer: 'Plateforme logistique' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

/** Facture imprimable. Montants tels qu'enregistrés (décimal exact) ; aucune mention légale inventée. */
export function invoicePdf({ company, invoice: inv }: InvoicePdf): Promise<Buffer> {
  return render((doc) => {
    const logo = drawLogo(doc);
    doc.font('Helvetica-Bold').fontSize(18).text(company, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right - logo - 12 });
    doc.moveDown(0.5).fontSize(14).text(`Facture ${inv.number ?? ''}`);
    doc.font('Helvetica').fontSize(10).fillColor('#444').text(`Statut : ${inv.status}   ·   Émise le : ${day(inv.issuedAt)}   ·   Échéance : ${inv.dueDate ?? '—'}`);
    doc.fillColor('#000').moveDown().text(`Client : ${inv.customer.name} (${inv.customer.customerCode})`);
    doc.moveDown();
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    for (const line of inv.lines) {
      const y = doc.y;
      doc.fontSize(10).text(line.description, left, y, { width: right - left - 110 });
      doc.text(`${line.amount ?? ''} ${inv.currency}`, right - 105, y, { width: 105, align: 'right' });
      doc.moveDown(0.3);
    }
    doc.moveTo(left, doc.y + 4).lineTo(right, doc.y + 4).lineWidth(0.5).stroke();
    doc.moveDown();
    const total = (label: string, value: string | null, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(label, left, y, { width: right - left - 110 });
      doc.text(`${value ?? '0.00'} ${inv.currency}`, right - 105, y, { width: 105, align: 'right' });
      doc.moveDown(0.3);
    };
    total('Sous-total', inv.subtotal);
    if (inv.discountTotal && Number(inv.discountTotal) > 0) total('Remise', `-${inv.discountTotal}`);
    if (inv.taxTotal && Number(inv.taxTotal) > 0) total('Taxes', inv.taxTotal);
    total('Total', inv.total, true);
    for (const credit of inv.credits) total(`Avoir ${credit.number}`, `-${credit.amount}`);
    total('Encaissé', inv.paidTotal);
    total('Reste à payer', inv.balance, true);
  }, `Facture ${inv.number ?? ''}`);
}

export function receiptPdf(r: ReceiptPdf): Promise<Buffer> {
  return render((doc) => {
    const logo = drawLogo(doc);
    doc.font('Helvetica-Bold').fontSize(18).text(r.company, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right - logo - 12 });
    doc.moveDown(0.5).fontSize(14).text(`Reçu ${r.receiptNumber}`);
    doc.font('Helvetica').fontSize(11).moveDown();
    doc.text(`Date : ${day(r.issuedAt)}`);
    doc.text(`Client : ${r.customer}`);
    doc.text(`Facture : ${r.invoiceNumber}`);
    doc.text(`Mode de paiement : ${r.method}${r.reference ? ` (${r.reference})` : ''}`);
    doc.moveDown().font('Helvetica-Bold').fontSize(14).text(`Montant reçu : ${r.amount} ${r.currency}`);
    if (Number(r.refunded) > 0) doc.font('Helvetica').fontSize(10).text(`Dont remboursé : ${r.refunded} ${r.currency}`);
  }, `Reçu ${r.receiptNumber}`);
}
