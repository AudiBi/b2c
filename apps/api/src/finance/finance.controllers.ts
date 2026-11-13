import { Controller, Delete, Get, Header, Headers, HttpCode, Post, Put, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  closeCashSessionSchema,
  confirmPaymentSchema,
  createInvoiceSchema,
  creditNoteSchema,
  declarePaymentSchema,
  exportQuerySchema,
  financeSettingsSchema,
  idParamSchema,
  listInvoicesQuerySchema,
  listPaymentsQuerySchema,
  openCashSessionSchema,
  recordCashPaymentSchema,
  refundSchema,
  rejectPaymentSchema,
  voidInvoiceSchema,
} from '@b2c/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppException } from '../common/errors';
import { Validate, VBody, VParams, VQuery } from '../common/validation';
import { DbService } from '../database/db.service';
import type { AuthContext } from '../security/auth.types';
import { CurrentAuth, Public, RateLimit, RequirePermission } from '../security/decorators';
import { receiptPdf, invoicePdf } from './finance-pdf';
import { InvoicesService } from './invoices.service';
import { LedgerService } from './ledger.service';
import { PaymentsService } from './payments.service';

type Id = z.infer<typeof idParamSchema>;
const idempotencyHeader = (value: string | undefined) => {
  if (value === undefined) return undefined;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(value)) throw AppException.badRequest('INVALID_IDEMPOTENCY_KEY', 'Clé d’idempotence invalide (8 à 64 caractères : lettres, chiffres, _ -)');
  return value;
};

function sendFile(res: Response, type: string, filename: string, body: Buffer | string) {
  const buffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  res
    .status(200)
    .set({
      'Content-Type': type,
      'Content-Length': String(buffer.length),
      'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    })
    .send(buffer);
}

@ApiTags('Facturation (personnel)')
@ApiBearerAuth()
@Controller('admin/invoices')
export class AdminInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission('invoice:read')
  @Validate({ query: listInvoicesQuerySchema })
  @ApiOperation({ summary: 'Factures (filtres : statut, client, numéro ou code client)' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listInvoicesQuerySchema>) {
    return this.invoices.list(auth, query);
  }

  @Post()
  @RequirePermission('invoice:create')
  @Validate({ body: createInvoiceSchema })
  @ApiOperation({
    summary: 'Crée une facture en BROUILLON',
    description:
      "Les frais des colis viennent de la pesée (grille appliquée). Un colis sans tarif calculé exige une ligne FREIGHT saisie. Une remise exige discount:apply et respecte le plafond de l'entreprise. Un colis n'est facturé qu'une fois.",
  })
  create(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof createInvoiceSchema>) {
    return this.invoices.createDraft(auth, body);
  }

  @Get(':id')
  @RequirePermission('invoice:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Détail : lignes, paiements, avoirs, colis, solde' })
  get(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.invoices.get(auth, params.id);
  }

  @Post(':id/issue')
  @HttpCode(200)
  @RequirePermission('invoice:create')
  @Validate({ params: idParamSchema })
  @ApiOperation({
    summary: 'Émet la facture (numéro sans trou) ',
    description: "Selon la politique de l'entreprise, les colis passent « en attente de paiement » ou « prêts pour expédition ». Le client est notifié. Une facture émise n'est plus modifiable.",
  })
  issue(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.invoices.issue(auth, params.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('invoice:create')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Supprime un brouillon' })
  async remove(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    await this.invoices.deleteDraft(auth, params.id);
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequirePermission('invoice:void')
  @Validate({ params: idParamSchema, body: voidInvoiceSchema })
  @ApiOperation({ summary: 'Annule une facture émise sans encaissement (motif obligatoire)' })
  void(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof voidInvoiceSchema>) {
    return this.invoices.void(auth, params.id, body.reason);
  }

  @Post(':id/credit-notes')
  @HttpCode(201)
  @RequirePermission('invoice:void')
  @Validate({ params: idParamSchema, body: creditNoteSchema })
  @ApiOperation({ summary: 'Émet un avoir (limité à ce qui n’est ni encaissé ni en attente)' })
  credit(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof creditNoteSchema>) {
    return this.invoices.creditNote(auth, params.id, body);
  }

  @Get(':id/pdf')
  @RequirePermission('invoice:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Facture en PDF' })
  async pdf(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @Res() res: Response) {
    const data = await this.invoices.pdfData(auth, params.id, false);
    sendFile(res, 'application/pdf', `${data.invoice.number}.pdf`, await invoicePdf(data));
  }
}

@ApiTags('Espace client')
@ApiBearerAuth()
@Controller('me')
export class PortalFinanceController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly db: DbService,
    private readonly ledger: LedgerService,
  ) {}

  @Get('invoices')
  @RequirePermission('invoice:read_own')
  @Validate({ query: listInvoicesQuerySchema.pick({ limit: true, cursor: true, status: true }) })
  @ApiOperation({ summary: 'Mes factures émises (jamais les brouillons)' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listInvoicesQuerySchema>) {
    return this.invoices.listMine(auth, query);
  }

  @Get('invoices/:id')
  @RequirePermission('invoice:read_own')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Ma facture avec ses lignes, paiements et solde (la facture d’un autre : 404)' })
  get(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.invoices.getMine(auth, params.id);
  }

  @Get('invoices/:id/pdf')
  @RequirePermission('invoice:read_own')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Ma facture en PDF' })
  async pdf(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @Res() res: Response) {
    const data = await this.invoices.pdfData(auth, params.id, true);
    sendFile(res, 'application/pdf', `${data.invoice.number}.pdf`, await invoicePdf(data));
  }

  @Post('invoices/:id/payments')
  @HttpCode(201)
  @RequirePermission('payment:declare_own')
  @Validate({ params: idParamSchema, body: declarePaymentSchema })
  @ApiOperation({
    summary: 'Déclare un paiement par virement ou mobile',
    description: "Le paiement reste EN ATTENTE : il n'est confirmé que par le personnel (qui voit l'argent) ou par une confirmation signée d'un prestataire configuré. Rien n'est débité par la plateforme.",
  })
  declare(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof declarePaymentSchema>) {
    return this.payments.declare(auth, params.id, body);
  }

  @Get('payments')
  @RequirePermission('payment:read_own')
  @ApiOperation({ summary: 'Mes paiements (en attente, confirmés, refusés) et leurs reçus' })
  mine(@CurrentAuth() auth: AuthContext) {
    return this.payments.mine(auth);
  }

  @Delete('payments/:id')
  @HttpCode(204)
  @RequirePermission('payment:declare_own')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Retire un paiement déclaré tant qu’il est en attente' })
  async cancel(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    await this.payments.cancelMine(auth, params.id);
  }

  @Get('payments/:id/receipt.pdf')
  @RequirePermission('payment:read_own')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Mon reçu en PDF' })
  async receipt(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @Res() res: Response) {
    const data = await this.payments.receiptData(auth, params.id, true);
    sendFile(res, 'application/pdf', `${data.receiptNumber}.pdf`, await receiptPdf(data));
  }

  @Get('payment-options')
  @RequirePermission('payment:read_own')
  @ApiOperation({ summary: 'Moyens de paiement réellement disponibles', description: 'Le paiement en ligne par carte n’existe pas (aucun prestataire) : online vaut toujours false.' })
  async options(@CurrentAuth() auth: AuthContext) {
    const settings = await this.db.run({ companyId: auth.companyId }, (tx) => this.ledger.settings(tx));
    return { cash: true, declare: ['BANK_TRANSFER', 'ZELLE', 'MOBILE_MONEY'], online: false, instructions: settings.paymentInstructions };
  }
}

@ApiTags('Paiements (personnel)')
@ApiBearerAuth()
@Controller('admin')
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments')
  @RequirePermission('payment:read')
  @Validate({ query: listPaymentsQuerySchema })
  @ApiOperation({ summary: 'Paiements (filtres : statut, mode, facture)' })
  list(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof listPaymentsQuerySchema>) {
    return this.payments.list(auth, query);
  }

  @Post('payments/cash')
  @HttpCode(201)
  @RequirePermission('payment:record_cash')
  @Validate({ body: recordCashPaymentSchema })
  @ApiOperation({
    summary: 'Enregistre un paiement en espèces',
    description: "Exige une caisse ouverte. Reçu numéroté immédiat. En-tête Idempotency-Key (8-64 caractères) : une requête rejouée ne double pas l'encaissement.",
  })
  cash(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof recordCashPaymentSchema>, @Headers('idempotency-key') key?: string) {
    return this.payments.recordCash(auth, body, idempotencyHeader(key));
  }

  @Post('payments/:id/confirm')
  @HttpCode(200)
  @RequirePermission('payment:reconcile')
  @Validate({ params: idParamSchema, body: confirmPaymentSchema })
  @ApiOperation({ summary: 'Valide un virement ou un paiement mobile déclaré (rapprochement manuel)' })
  confirm(@CurrentAuth() auth: AuthContext, @VParams() params: Id) {
    return this.payments.confirmByStaff(auth, params.id);
  }

  @Post('payments/:id/reject')
  @HttpCode(200)
  @RequirePermission('payment:reconcile')
  @Validate({ params: idParamSchema, body: rejectPaymentSchema })
  @ApiOperation({ summary: 'Refuse un paiement déclaré (motif obligatoire)' })
  reject(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof rejectPaymentSchema>) {
    return this.payments.reject(auth, params.id, body.reason);
  }

  @Post('payments/:id/refunds')
  @HttpCode(201)
  @RequirePermission('payment:refund')
  @Validate({ params: idParamSchema, body: refundSchema })
  @ApiOperation({ summary: 'Enregistre un remboursement (l’argent est rendu hors de la plateforme)' })
  refund(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof refundSchema>) {
    return this.payments.refund(auth, params.id, body);
  }

  @Get('payments/:id/receipt.pdf')
  @RequirePermission('payment:read')
  @Validate({ params: idParamSchema })
  @ApiOperation({ summary: 'Reçu en PDF' })
  async receipt(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @Res() res: Response) {
    const data = await this.payments.receiptData(auth, params.id, false);
    sendFile(res, 'application/pdf', `${data.receiptNumber}.pdf`, await receiptPdf(data));
  }

  @Get('cash-sessions')
  @RequirePermission('payment:read')
  @ApiOperation({ summary: 'Sessions de caisse (périmètre respecté)' })
  sessions(@CurrentAuth() auth: AuthContext) {
    return this.payments.listCash(auth);
  }

  @Post('cash-sessions')
  @HttpCode(201)
  @RequirePermission('payment:record_cash')
  @Validate({ body: openCashSessionSchema })
  @ApiOperation({ summary: 'Ouvre une caisse (une seule à la fois par agence, ou pour l’entreprise)' })
  open(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof openCashSessionSchema>) {
    return this.payments.openCash(auth, body);
  }

  @Post('cash-sessions/:id/close')
  @HttpCode(200)
  @RequirePermission('payment:record_cash')
  @Validate({ params: idParamSchema, body: closeCashSessionSchema })
  @ApiOperation({ summary: 'Clôture la caisse : montant attendu, compté et écart' })
  close(@CurrentAuth() auth: AuthContext, @VParams() params: Id, @VBody() body: z.infer<typeof closeCashSessionSchema>) {
    return this.payments.closeCash(auth, params.id, body.countedAmount);
  }

  @Get('finance/summary')
  @RequirePermission('payment:reconcile')
  @Validate({ query: exportQuerySchema })
  @ApiOperation({ summary: 'Synthèse de rapprochement par mode et par devise' })
  summary(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof exportQuerySchema>) {
    return this.payments.summary(auth, query.from, query.to);
  }

  @Get('finance/export.csv')
  @RequirePermission('payment:export')
  @Validate({ query: exportQuerySchema })
  @ApiOperation({ summary: 'Registre comptable en CSV (factures, paiements, remboursements, avoirs)' })
  async export(@CurrentAuth() auth: AuthContext, @VQuery() query: z.infer<typeof exportQuerySchema>, @Res() res: Response) {
    sendFile(res, 'text/csv; charset=utf-8', `registre-${query.from}-${query.to}.csv`, await this.payments.exportCsv(auth, query.from, query.to));
  }
}

@ApiTags('Administration : paramètres')
@ApiBearerAuth()
@Controller('admin/settings')
export class FinanceSettingsController {
  constructor(private readonly db: DbService, private readonly ledger: LedgerService) {}

  @Get('finance')
  @RequirePermission('settings:read')
  @ApiOperation({ summary: 'Plafond de remise et consignes de paiement' })
  get(@CurrentAuth() auth: AuthContext) {
    return this.db.run({ companyId: auth.companyId }, (tx) => this.ledger.settings(tx));
  }

  @Put('finance')
  @RequirePermission('settings:update')
  @Validate({ body: financeSettingsSchema })
  @ApiOperation({ summary: 'Modifie le plafond de remise et/ou les consignes de paiement (texte affiché au client)' })
  async put(@CurrentAuth() auth: AuthContext, @VBody() body: z.infer<typeof financeSettingsSchema>) {
    return this.db.run({ companyId: auth.companyId }, async (tx) => {
      const current = await this.ledger.settings(tx);
      const next = {
        maxDiscountPercent: body.maxDiscountPercent ?? current.maxDiscountPercent,
        paymentInstructions: body.paymentInstructions === undefined ? current.paymentInstructions : body.paymentInstructions,
      };
      await tx.companySetting.upsert({
        where: { companyId_key: { companyId: auth.companyId, key: 'finance' } },
        create: { companyId: auth.companyId, key: 'finance', value: next },
        update: { value: next },
      });
      return next;
    });
  }
}

/** Confirmations de paiement d'un prestataire : signées, horodatées, sans rejeu. N'existe que si un prestataire est configuré. */
@ApiTags('Public')
@Controller('webhooks/payments')
export class PaymentWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':slug/:provider')
  @Public()
  @HttpCode(200)
  @RateLimit({ name: 'payment-webhook', limit: 300, windowSeconds: 60 })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Confirmation de paiement signée d’un prestataire',
    description: 'En-tête X-Signature : t=<secondes>,v1=<HMAC-SHA256 hex de « t.corps »>. 404 tant qu’aucun prestataire n’est configuré ; 401 si la signature est invalide ou périmée (5 min) ; un événement déjà reçu répond DUPLICATE sans effet.',
  })
  handle(@Req() req: Request & { rawBody?: Buffer }) {
    const { slug, provider } = req.params as { slug: string; provider: string };
    if (!req.rawBody) throw AppException.badRequest('INVALID_PAYLOAD', 'Corps absent');
    return this.payments.handleWebhook(slug, provider, req.rawBody, req.headers['x-signature'] as string | undefined);
  }
}
