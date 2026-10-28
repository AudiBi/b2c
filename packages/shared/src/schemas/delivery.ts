import { z } from 'zod';
import { isoDateSchema } from './customer';

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

// ---------------------------------------------------------------------------------------------
// Tournées et remise
// ---------------------------------------------------------------------------------------------

export const ROUTE_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];
export const STOP_STATUSES = ['PENDING', 'DELIVERED', 'FAILED', 'REMOVED'] as const;
export type StopStatus = (typeof STOP_STATUSES)[number];

/** Motifs d'une livraison échouée (le texte libre complète, il ne remplace pas). */
export const FAILURE_REASONS = ['ABSENT', 'WRONG_ADDRESS', 'REFUSED', 'NO_ACCESS', 'PAYMENT_DUE', 'OTHER'] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

/** Nombre d'échecs successifs à partir duquel l'interface propose le retour du colis. */
export const FAILED_ATTEMPTS_ALERT = 3;

/** Durée de validité d'un code de remise (heures) et nombre d'essais erronés avant blocage. */
export const HANDOVER_CODE_TTL_HOURS = 72;
export const HANDOVER_CODE_MAX_FAILURES = 5;
export const handoverCodeSchema = z.string().trim().regex(/^\d{6}$/, 'otp_format');

export const createRouteSchema = z.strictObject({
  agencyId: z.uuid(),
  driverUserId: z.uuid(),
  plannedDate: isoDateSchema,
  notes: optionalText(500),
});

export const addStopSchema = z.strictObject({
  packageId: z.uuid(),
  /** Adresse de livraison du client (la sienne par défaut si absente). */
  addressId: z.uuid().optional(),
  instructions: optionalText(300),
});

export const listRoutesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  status: z.enum(ROUTE_STATUSES).optional(),
  agencyId: z.uuid().optional(),
  date: isoDateSchema.optional(),
});

/** Remise : sur place à l'agence ou par le livreur. Les preuves exigées dépendent de la règle de l'entreprise. */
export const handoverSchema = z
  .strictObject({
    recipientKind: z.enum(['CUSTOMER', 'BENEFICIARY']),
    /** Bénéficiaire autorisé du client (obligatoire si ce n'est pas le client lui-même). */
    beneficiaryId: z.uuid().optional(),
    /** Nom de la personne qui reçoit (par défaut : le client, ou le bénéficiaire choisi). */
    recipientName: optionalText(120),
    idDocumentType: optionalText(40),
    /** 4 derniers caractères de la pièce seulement : jamais le numéro complet. */
    idDocumentLast4: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{4}$/, 'id_last4_format')
      .optional(),
    otp: handoverCodeSchema.optional(),
    /** Photo de preuve déjà jointe au colis (pièces jointes de type PHOTO). */
    proofFileId: z.uuid().optional(),
    /** Dérogation : remise malgré un solde dû (permission spéciale, motif obligatoire, journalisée). */
    overrideBalance: z.strictObject({ reason: text(300) }).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.recipientKind === 'BENEFICIARY' && !value.beneficiaryId) {
      ctx.addIssue({ code: 'custom', path: ['beneficiaryId'], message: 'beneficiary_required' });
    }
    if (value.recipientKind === 'CUSTOMER' && value.beneficiaryId) {
      ctx.addIssue({ code: 'custom', path: ['beneficiaryId'], message: 'beneficiary_not_expected' });
    }
  });
export type HandoverInput = z.infer<typeof handoverSchema>;

export const failDeliverySchema = z.strictObject({
  reason: z.enum(FAILURE_REASONS),
  note: optionalText(300),
  /** Nouvelle date proposée au client (indicative). */
  rescheduleFor: isoDateSchema.optional(),
});

export const deliverySettingsSchema = z
  .strictObject({
    requireOtp: z.boolean().optional(),
    requireIdDocument: z.boolean().optional(),
    requirePhoto: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'no_changes');

export const DEFAULT_DELIVERY_SETTINGS = { requireOtp: true, requireIdDocument: true, requirePhoto: false } as const;

// ---------------------------------------------------------------------------------------------
// Réclamations
// ---------------------------------------------------------------------------------------------

export const CLAIM_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const CLAIM_CATEGORIES = ['DAMAGED', 'LOST', 'DELAYED', 'BILLING', 'SERVICE', 'OTHER'] as const;
export type ClaimCategory = (typeof CLAIM_CATEGORIES)[number];

export const createClaimSchema = z.strictObject({
  category: z.enum(CLAIM_CATEGORIES),
  subject: text(120),
  message: text(2000),
  /** Colis concerné (un colis du client). */
  packageId: z.uuid().optional(),
});

export const claimMessageSchema = z.strictObject({
  body: text(2000),
  /** Note interne, invisible du client (personnel seulement). */
  internal: z.boolean().optional(),
});

export const claimStatusSchema = z
  .strictObject({
    status: z.enum(CLAIM_STATUSES),
    resolution: optionalText(1000),
  })
  .superRefine((value, ctx) => {
    if ((value.status === 'RESOLVED' || value.status === 'REJECTED') && !value.resolution) {
      ctx.addIssue({ code: 'custom', path: ['resolution'], message: 'resolution_required' });
    }
  });

export const assignClaimSchema = z.strictObject({ userId: z.uuid().nullable() });

export const listClaimsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  status: z.enum(CLAIM_STATUSES).optional(),
  category: z.enum(CLAIM_CATEGORIES).optional(),
  assignedTo: z.uuid().optional(),
  q: z.string().trim().min(1).max(40).optional(),
});

export const myClaimsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
});

// ---------------------------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------------------------

export const dashboardQuerySchema = z
  .strictObject({ from: isoDateSchema.optional(), to: isoDateSchema.optional() })
  .superRefine((value, ctx) => {
    if ((value.from === undefined) !== (value.to === undefined)) ctx.addIssue({ code: 'custom', path: ['to'], message: 'range_incomplete' });
    if (value.from && value.to) {
      if (value.to < value.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'date_order' });
      const days = (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000;
      if (days > 366) ctx.addIssue({ code: 'custom', path: ['to'], message: 'range_too_long' });
    }
  });
