import { z } from 'zod';
import { COMMON_PASSWORDS } from '../common-passwords';
import { ROLE_CODES, SCOPE_TYPES } from '../roles';

export const LOCALES = ['fr', 'ht', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const PLATFORM_COMPANY_SLUG = 'platform';
/** Identifiant fixe de l'entreprise « plateforme » (créée par la migration 0001). */
export const PLATFORM_COMPANY_ID = '00000000-0000-7000-8000-000000000001';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());

export const passwordSchema = z
  .string()
  .min(10, 'password_min')
  .max(128, 'password_max')
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), 'password_common');

/** Numéro au format international E.164, par exemple +50937000000. */
export const phoneSchema = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'phone_format');

export const companySlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, 'slug_format');

const nameSchema = z.string().trim().min(1).max(80);
const tokenSchema = z.string().trim().min(20).max(300);
const uuidSchema = z.uuid();

export const registerSchema = z
  .strictObject({
    companySlug: companySlugSchema,
    accountType: z.enum(['INDIVIDUAL', 'BUSINESS']),
    email: emailSchema,
    password: passwordSchema,
    firstName: nameSchema,
    lastName: nameSchema,
    phone: phoneSchema.optional(),
    businessName: z.string().trim().min(1).max(120).optional(),
    locale: z.enum(LOCALES).default('fr'),
    acceptTerms: z.literal(true, { error: 'terms_required' }),
  })
  .superRefine((value, ctx) => {
    if (value.accountType === 'BUSINESS' && !value.businessName) {
      ctx.addIssue({ code: 'custom', path: ['businessName'], message: 'required' });
    }
    if (value.password.toLowerCase().includes(value.email.split('@')[0])) {
      if (value.email.split('@')[0].length >= 4) {
        ctx.addIssue({ code: 'custom', path: ['password'], message: 'password_contains_email' });
      }
    }
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.strictObject({
  companySlug: companySlugSchema.optional(),
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.strictObject({ token: tokenSchema });
export const resendVerificationSchema = z.strictObject({ companySlug: companySlugSchema, email: emailSchema });
export const forgotPasswordSchema = z.strictObject({ companySlug: companySlugSchema.optional(), email: emailSchema });
export const resetPasswordSchema = z.strictObject({ token: tokenSchema, newPassword: passwordSchema });
export const refreshSchema = z.strictObject({ refreshToken: z.string().min(20).max(300).optional() });
export const logoutSchema = z.strictObject({ allSessions: z.boolean().default(false) });

export const roleAssignmentSchema = z
  .strictObject({
    roleCode: z.enum(ROLE_CODES),
    scopeType: z.enum(SCOPE_TYPES).default('COMPANY'),
    scopeId: uuidSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scopeType === 'COMPANY' && value.scopeId) {
      ctx.addIssue({ code: 'custom', path: ['scopeId'], message: 'scope_id_forbidden' });
    }
    if (value.scopeType !== 'COMPANY' && !value.scopeId) {
      ctx.addIssue({ code: 'custom', path: ['scopeId'], message: 'required' });
    }
  });
export type RoleAssignmentInput = z.infer<typeof roleAssignmentSchema>;

export const createStaffSchema = z.strictObject({
  email: emailSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  phone: phoneSchema.optional(),
  locale: z.enum(LOCALES).default('fr'),
  roles: z.array(roleAssignmentSchema).min(1).max(10),
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const createCompanySchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  slug: companySlugSchema.refine((s) => s !== PLATFORM_COMPANY_SLUG, 'reserved_slug'),
  trackingPrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/),
  customerCodePrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/),
  defaultCurrency: z.enum(['USD', 'HTG']).default('USD'),
  defaultLocale: z.enum(LOCALES).default('fr'),
  paymentPolicy: z.enum(['PAY_BEFORE_SHIPMENT', 'PAY_BEFORE_RELEASE']).default('PAY_BEFORE_SHIPMENT'),
  adminEmail: emailSchema,
  adminFirstName: nameSchema,
  adminLastName: nameSchema,
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

const cursorQuery = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: uuidSchema.optional(),
};

export const listUsersQuerySchema = z.strictObject({
  ...cursorQuery,
  q: z.string().trim().min(1).max(100).optional(),
  kind: z.enum(['STAFF', 'CUSTOMER', 'PLATFORM']).optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'DISABLED']).optional(),
});

export const auditQuerySchema = z.strictObject({
  ...cursorQuery,
  action: z.string().trim().min(1).max(100).optional(),
  entityType: z.string().trim().min(1).max(60).optional(),
  entityId: uuidSchema.optional(),
  actorUserId: uuidSchema.optional(),
});

export const idParamSchema = z.strictObject({ id: uuidSchema });
export const userRoleParamSchema = z.strictObject({ id: uuidSchema, userRoleId: uuidSchema });
