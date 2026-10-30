import { z } from 'zod';
import { LOCALES } from './schemas/auth';

/** Les 14 événements de notification (DOMAIN_MODEL §6). */
export const EVENT_CODES = [
  'prealert.created',
  'package.received',
  'package.identified',
  'payment.required',
  'payment.confirmed',
  'shipment.prepared',
  'shipment.dispatched',
  'shipment.arrived',
  'package.available_at_agency',
  'delivery.scheduled',
  'package.delivered',
  'package.incident',
  'delivery.failed',
  'claim.updated',
] as const;
export type EventCode = (typeof EVENT_CODES)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'WHATSAPP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const NOTIFICATION_STATUSES = ['QUEUED', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Événements dont le client ne peut pas se désabonner (reçu de paiement, anomalie sur son colis). */
export const MANDATORY_EVENTS: readonly EventCode[] = ['payment.confirmed', 'package.incident'];

const PACKAGE_VARS = ['customerName', 'trackingNumber'] as const;

/** Variables qu'un modèle peut utiliser, par événement : tout autre nom est refusé à l'enregistrement. */
export const EVENT_VARIABLES: Record<EventCode, readonly string[]> = {
  'prealert.created': [...PACKAGE_VARS, 'storeName'],
  'package.received': [...PACKAGE_VARS, 'warehouseCity'],
  'package.identified': [...PACKAGE_VARS],
  'payment.required': ['customerName', 'invoiceNumber', 'amount', 'currency'],
  'payment.confirmed': ['customerName', 'invoiceNumber', 'receiptNumber', 'amount', 'currency'],
  'shipment.prepared': [...PACKAGE_VARS],
  'shipment.dispatched': [...PACKAGE_VARS],
  'shipment.arrived': [...PACKAGE_VARS],
  'package.available_at_agency': [...PACKAGE_VARS, 'agencyName', 'agencyCity'],
  'delivery.scheduled': [...PACKAGE_VARS, 'plannedDate'],
  'package.delivered': [...PACKAGE_VARS],
  'package.incident': [...PACKAGE_VARS],
  'delivery.failed': [...PACKAGE_VARS],
  'claim.updated': ['customerName', 'claimNumber'],
};

const PLACEHOLDER = /\{(\w+)\}/g;

/** Noms de variables d'un texte de modèle. */
export const placeholdersOf = (template: string): string[] => [...template.matchAll(PLACEHOLDER)].map((m) => m[1]);

/** Variables inconnues pour cet événement (liste vide : le modèle est valide). */
export function unknownPlaceholders(event: EventCode, ...texts: (string | undefined)[]): string[] {
  const allowed = new Set(EVENT_VARIABLES[event]);
  return [...new Set(texts.flatMap((t) => (t ? placeholdersOf(t) : [])).filter((name) => !allowed.has(name)))];
}

/**
 * Remplace {variable} par sa valeur. Texte brut uniquement : aucune évaluation, aucun HTML interprété.
 * Retours à la ligne retirés des valeurs insérées dans l'objet d'un e-mail (injection d'en-têtes).
 */
export function renderTemplate(template: string, values: Record<string, string>, options: { singleLine?: boolean } = {}): string {
  return template.replace(PLACEHOLDER, (_m, name: string) => {
    const value = values[name] ?? '';
    return options.singleLine ? value.replace(/[\r\n]+/g, ' ') : value;
  });
}

export const templateSchema = z
  .strictObject({
    eventCode: z.enum(EVENT_CODES),
    channel: z.enum(NOTIFICATION_CHANNELS),
    locale: z.enum(LOCALES),
    subject: z.string().trim().max(150).optional(),
    body: z.string().trim().min(1).max(2000),
    active: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    const unknown = unknownPlaceholders(value.eventCode, value.subject, value.body);
    if (unknown.length > 0) ctx.addIssue({ code: 'custom', path: ['body'], message: `unknown_placeholder:${unknown.join(',')}` });
    if (value.channel === 'EMAIL' && !value.subject) ctx.addIssue({ code: 'custom', path: ['subject'], message: 'subject_required' });
  });
export type TemplateInput = z.infer<typeof templateSchema>;

export const listNotificationsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  channel: z.enum(NOTIFICATION_CHANNELS).optional(),
  eventCode: z.enum(EVENT_CODES).optional(),
});

export const myNotificationsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  unread: z.enum(['true', 'false']).optional(),
});

/** Délai avant la nouvelle tentative (minutes) après le n-ième échec ; au-delà, l'envoi est définitivement en échec. */
export const RETRY_DELAYS_MINUTES = [1, 5, 30, 120] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;
