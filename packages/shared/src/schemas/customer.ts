import { z } from 'zod';
import { LOCALES, emailSchema, passwordSchema, phoneSchema } from './auth';

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

/** Code pays ISO 3166-1 alpha-2, normalisé en majuscules. */
export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'country_format');

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_format');

export const TRANSPORT_MODES = ['AIR', 'SEA'] as const;
export type TransportModeCode = (typeof TRANSPORT_MODES)[number];

// ---------------------------------------------------------------------------------------------
// Profil et préférences
// ---------------------------------------------------------------------------------------------

export const notificationPrefsSchema = z.strictObject({
  email: z.boolean(),
  whatsapp: z.boolean(),
  inApp: z.boolean(),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const updateProfileSchema = z
  .strictObject({
    firstName: text(80),
    lastName: text(80),
    phone: phoneSchema.nullable(),
    locale: z.enum(LOCALES),
    businessName: text(120),
    notificationPrefs: notificationPrefsSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'no_changes');
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

// ---------------------------------------------------------------------------------------------
// Adresses du client
// ---------------------------------------------------------------------------------------------

const addressFields = {
  kind: z.enum(['PERSONAL', 'DELIVERY']),
  label: text(60),
  recipientName: text(120),
  phone: phoneSchema.optional(),
  line1: text(160),
  line2: optionalText(160),
  city: text(80),
  region: optionalText(80),
  country: countryCodeSchema,
  postalCode: optionalText(20),
  instructions: optionalText(500),
  isDefault: z.boolean().default(false),
};

export const createAddressSchema = z.strictObject(addressFields);
export type CreateAddressInput = z.infer<typeof createAddressSchema>;

export const updateAddressSchema = z
  .strictObject({ ...addressFields, isDefault: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'no_changes');
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;

// ---------------------------------------------------------------------------------------------
// Bénéficiaires autorisés à retirer un colis
// ---------------------------------------------------------------------------------------------

export const ID_DOCUMENT_TYPES = ['NATIONAL_ID', 'PASSPORT', 'DRIVING_LICENSE', 'OTHER'] as const;

const beneficiaryFields = {
  fullName: text(120),
  idDocumentType: z.enum(ID_DOCUMENT_TYPES).optional(),
  // Seuls les 4 derniers caractères de la pièce d'identité sont acceptés et conservés
  idDocumentLast4: z.string().trim().regex(/^[A-Za-z0-9]{1,4}$/, 'id_last4_format').optional(),
  phone: phoneSchema.optional(),
  validFrom: isoDateSchema.optional(),
  validTo: isoDateSchema.optional(),
};

const validityOrder = (value: { validFrom?: string; validTo?: string }, ctx: z.RefinementCtx) => {
  if (value.validFrom && value.validTo && value.validTo < value.validFrom) {
    ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'date_order' });
  }
};

export const createBeneficiarySchema = z.strictObject(beneficiaryFields).superRefine(validityOrder);
export type CreateBeneficiaryInput = z.infer<typeof createBeneficiarySchema>;

export const updateBeneficiarySchema = z
  .strictObject(beneficiaryFields)
  .partial()
  .superRefine(validityOrder)
  .refine((value) => Object.keys(value).length > 0, 'no_changes');
export type UpdateBeneficiaryInput = z.infer<typeof updateBeneficiarySchema>;

// ---------------------------------------------------------------------------------------------
// Entrepôts (administration)
// ---------------------------------------------------------------------------------------------

export const ADDRESS_TEMPLATE_TOKENS = ['customerName', 'customerCode', 'mode'] as const;

export const addressTemplateSchema = z
  .array(text(120))
  .min(1)
  .max(10)
  .superRefine((lines, ctx) => {
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/\{([^{}]*)\}/g)) {
        if (!(ADDRESS_TEMPLATE_TOKENS as readonly string[]).includes(match[1])) {
          ctx.addIssue({
            code: 'custom',
            path: [index],
            message: `Variable inconnue {${match[1]}} (autorisées : ${ADDRESS_TEMPLATE_TOKENS.map((t) => `{${t}}`).join(', ')})`,
          });
        }
      }
      if (/[{}]/.test(line.replace(/\{[^{}]*\}/g, ''))) {
        ctx.addIssue({ code: 'custom', path: [index], message: 'Accolade isolée' });
      }
    });
    if (!lines.some((line) => line.includes('{customerCode}'))) {
      ctx.addIssue({ code: 'custom', message: 'Au moins une ligne doit contenir {customerCode} : sans lui les colis ne sont pas identifiables' });
    }
  });

const warehouseFields = {
  reference: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, '2 à 20 caractères : lettres, chiffres, tirets'),
  name: text(120),
  country: countryCodeSchema,
  city: text(80),
  addressLine: text(200),
  publicVisible: z.boolean(),
  addressTemplate: addressTemplateSchema,
  timezone: text(60),
};

export const createWarehouseSchema = z.strictObject({
  ...warehouseFields,
  publicVisible: z.boolean().default(true),
  timezone: warehouseFields.timezone.default('UTC'),
});
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

export const updateWarehouseSchema = z
  .strictObject({ ...warehouseFields, status: z.enum(['ACTIVE', 'INACTIVE']) })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'no_changes');
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;

// ---------------------------------------------------------------------------------------------
// Paramètres publics de l'entreprise (page Contact)
// ---------------------------------------------------------------------------------------------

const httpsUrl = z.url({ protocol: /^https$/, hostname: z.regexes.domain });

export const publicContactSchema = z.strictObject({
  email: emailSchema.optional(),
  phones: z.array(phoneSchema).max(6).default([]),
  whatsapp: phoneSchema.optional(),
  address: optionalText(300),
  hours: optionalText(300),
  facebook: httpsUrl.optional(),
  instagram: httpsUrl.optional(),
  tiktok: httpsUrl.optional(),
  youtube: httpsUrl.optional(),
});
export type PublicContact = z.infer<typeof publicContactSchema>;

export const publicCompanySlugParamSchema = z.strictObject({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
});

export const listCustomersQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  type: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
});

// ---------------------------------------------------------------------------------------------
// Clients créés par le personnel (comptoir) : avec ou sans accès au site
// ---------------------------------------------------------------------------------------------

export const createCustomerByStaffSchema = z.strictObject({
  customerType: z.enum(['INDIVIDUAL', 'BUSINESS']).default('INDIVIDUAL'),
  firstName: text(80),
  lastName: text(80),
  businessName: optionalText(120),
  phone: phoneSchema.optional(),
  /** Sans adresse e-mail, le client n'a pas d'accès au site (colis suivis au comptoir). */
  email: emailSchema.optional(),
  locale: z.enum(LOCALES).default('fr'),
});
export type CreateCustomerByStaffInput = z.infer<typeof createCustomerByStaffSchema>;

export const updateCustomerByStaffSchema = z.strictObject({
  firstName: text(80).optional(),
  lastName: text(80).optional(),
  businessName: optionalText(120),
  phone: phoneSchema.optional(),
});
export type UpdateCustomerByStaffInput = z.infer<typeof updateCustomerByStaffSchema>;

export const inviteCustomerSchema = z.strictObject({
  email: emailSchema,
  locale: z.enum(LOCALES).default('fr'),
});
export type InviteCustomerInput = z.infer<typeof inviteCustomerSchema>;

/** Domaine réservé (RFC 2606) des adresses factices des clients sans accès. */
export const NO_ACCESS_EMAIL_DOMAIN = 'no-access.invalid';
