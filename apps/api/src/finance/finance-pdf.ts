import PDFDocument from 'pdfkit';
import { drawLogo } from '../branding/pdf-logo';
import { htgEquivalent } from './fx';

interface InvoicePdf {
  company: string;
  /** Taux gourdes/dollar pour un équivalent indicatif (absent : aucune ligne). */
  htgPerUsd?: number | null;
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
  htgPerUsd?: number | null;
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
export function invoicePdf(data: InvoicePdf): Promise<Buffer> {
  const { company, invoice: inv } = data;
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
    const htg = htgEquivalent(inv.balance, inv.currency, data.htgPerUsd ?? null);
    if (htg) doc.font('Helvetica-Oblique').fontSize(9).text(`Équivalent indicatif : ${htg} HTG (taux ${data.htgPerUsd})`, left, doc.y, { width: right - left, align: 'right' });
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
    const htg = htgEquivalent(r.amount, r.currency, r.htgPerUsd ?? null);
    if (htg) doc.font('Helvetica-Oblique').fontSize(9).text(`Équivalent indicatif : ${htg} HTG (taux ${r.htgPerUsd})`);
  }, `Reçu ${r.receiptNumber}`);
}

export interface DepositSlipPdf {
  company: string;
  number: string;
  depositDate: string;
  bank: string;
  accountLast4: string | null;
  slipRef: string;
  currency: string;
  expected: string;
  deposited: string;
  difference: string;
  note: string | null;
  sessions: number;
}

/** Bordereau de dépôt bancaire : ce qui devait être déposé, ce qui l'a été, l'écart ; aucune mention légale inventée. */
export function depositSlipPdf(d: DepositSlipPdf): Promise<Buffer> {
  return render((doc) => {
    const logo = drawLogo(doc);
    doc.font('Helvetica-Bold').fontSize(18).text(d.company, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right - logo - 12 });
    doc.moveDown(0.5).fontSize(14).text(`Bordereau de dépôt ${d.number}`);
    doc.font('Helvetica').fontSize(11).moveDown();
    doc.text(`Date : ${d.depositDate}`);
    doc.text(`Banque : ${d.bank}${d.accountLast4 ? ` (compte …${d.accountLast4})` : ''}`);
    doc.text(`Référence du bordereau de la banque : ${d.slipRef}`);
    doc.text(`Caisses rattachées : ${d.sessions}`);
    doc.moveDown();
    doc.text(`Montant attendu : ${d.expected} ${d.currency}`);
    doc.font('Helvetica-Bold').text(`Montant déposé : ${d.deposited} ${d.currency}`);
    doc.font('Helvetica').text(`Écart (déposé − attendu) : ${d.difference} ${d.currency}`);
    if (d.note) doc.moveDown().text(`Note : ${d.note}`);
  }, `Dépôt ${d.number}`);
}

export interface ProformaPdf {
  company: string;
  number: string;
  customer: string;
  validUntil: string;
  currency: string;
  total: string;
  cardName: string;
  lines: { label: string; amount: string }[];
  note: string | null;
}

/** Proforma : estimation chiffrée pour un client, valable jusqu'à une date ; ce n'est pas une facture. */
export function proformaPdf(p: ProformaPdf): Promise<Buffer> {
  return render((doc) => {
    const logo = drawLogo(doc);
    doc.font('Helvetica-Bold').fontSize(18).text(p.company, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right - logo - 12 });
    doc.moveDown(0.5).fontSize(14).text(`PROFORMA ${p.number}`);
    doc.font('Helvetica').fontSize(11).moveDown();
    doc.text(`Client : ${p.customer}`);
    doc.text(`Valable jusqu'au : ${p.validUntil}`);
    doc.text(`Grille : ${p.cardName}`);
    doc.moveDown();
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    for (const line of p.lines) {
      const y = doc.y;
      doc.fontSize(10).text(line.label, left, y, { width: right - left - 110 });
      doc.text(`${line.amount} ${p.currency}`, right - 105, y, { width: 105, align: 'right' });
      doc.moveDown(0.3);
    }
    doc.moveTo(left, doc.y + 4).lineTo(right, doc.y + 4).lineWidth(0.5).stroke();
    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(12).text(`Total estimé : ${p.total} ${p.currency}`, left, doc.y, { width: right - left, align: 'right' });
    doc.font('Helvetica').fontSize(9).moveDown().text("Estimation établie d'après la grille en vigueur et les mesures annoncées ; le montant définitif résulte de la pesée réelle.");
    if (p.note) doc.moveDown().fontSize(10).text(`Note : ${p.note}`);
  }, `Proforma ${p.number}`);
}
