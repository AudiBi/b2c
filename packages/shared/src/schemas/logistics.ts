import { z } from 'zod';
import { phoneSchema } from './auth';
import { countryCodeSchema, TRANSPORT_MODES } from './customer';
import { SHIPMENT_STATUSES } from '../shipment-status';

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

// ---------------------------------------------------------------------------------------------
// Emplacements et mouvements en entrepôt
// ---------------------------------------------------------------------------------------------

export const LOCATION_KINDS = ['ZONE', 'SHELF', 'BIN'] as const;

export const createLocationSchema = z.strictObject({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'location_code_format'),
  kind: z.enum(LOCATION_KINDS).default('SHELF'),
});

// Pas de valeur par défaut ici : une modification ne doit pas remettre un champ à sa valeur initiale.
export const updateLocationSchema = z
  .strictObject({ kind: z.enum(LOCATION_KINDS).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'no_changes');

export const moveSchema = z.strictObject({
  /** null : le colis n'est plus rangé à un emplacement précis. */
  locationId: z.uuid().nullable(),
  note: optionalText(200),
});

/** Code lu par un lecteur ou saisi : numéro de suivi (avec ou sans tirets) ou numéro de suivi du marchand. */
export const scanCodeSchema = z.string().trim().min(4).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/, 'reference_format');

export const scanReceiveSchema = z.strictObject({
  warehouseId: z.uuid(),
  code: scanCodeSchema,
  /** Utile seulement si le colis est inconnu (aucune préalerte) : il pourra être pesé ensuite. */
  transportMode: z.enum(TRANSPORT_MODES).optional(),
});

export const inventoryQuerySchema = z.strictObject({ locationId: z.uuid().optional() });

export const anomaliesQuerySchema = z.strictObject({ warehouseId: z.uuid().optional() });

// ---------------------------------------------------------------------------------------------
// Agences et points de retrait
// ---------------------------------------------------------------------------------------------

export const AGENCY_KINDS = ['AGENCY', 'PICKUP_POINT'] as const;

const agencyFields = {
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, '2 à 20 caractères : lettres, chiffres, tirets'),
  name: text(120),
  kind: z.enum(AGENCY_KINDS),
  country: countryCodeSchema,
  city: text(80),
  addressLine: text(200),
  phone: phoneSchema,
  hours: text(200),
  publicVisible: z.boolean(),
};

export const createAgencySchema = z.strictObject({
  ...agencyFields,
  kind: agencyFields.kind.default('AGENCY'),
  phone: phoneSchema.optional(),
  hours: optionalText(200),
  publicVisible: z.boolean().default(true),
});
export type CreateAgencyInput = z.infer<typeof createAgencySchema>;

export const updateAgencySchema = z
  .strictObject({
    name: agencyFields.name.optional(),
    kind: agencyFields.kind.optional(),
    country: agencyFields.country.optional(),
    city: agencyFields.city.optional(),
    addressLine: agencyFields.addressLine.optional(),
    phone: phoneSchema.nullable().optional(),
    hours: text(200).nullable().optional(),
    publicVisible: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'no_changes');
export type UpdateAgencyInput = z.infer<typeof updateAgencySchema>;

export const assignAgencySchema = z.strictObject({ agencyId: z.uuid().nullable() });

export const agencyReceiveSchema = z.strictObject({ code: scanCodeSchema });

// ---------------------------------------------------------------------------------------------
// Lots de transport
// ---------------------------------------------------------------------------------------------

export const createShipmentSchema = z.strictObject({
  transportMode: z.enum(TRANSPORT_MODES),
  originWarehouseId: z.uuid(),
  destinationCountry: countryCodeSchema,
  destinationCity: optionalText(80),
  destinationAgencyId: z.uuid().optional(),
  carrierName: optionalText(120),
  /** Numéro de connaissement (maritime) ou de lettre de transport aérien. */
  transportRef: optionalText(60),
  notes: optionalText(500),
});
export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;

export const updateShipmentSchema = z
  .strictObject({
    destinationCity: text(80).nullable().optional(),
    destinationAgencyId: z.uuid().nullable().optional(),
    carrierName: text(120).nullable().optional(),
    transportRef: text(60).nullable().optional(),
    notes: text(500).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'no_changes');
export type UpdateShipmentInput = z.infer<typeof updateShipmentSchema>;

export const loadPackageSchema = z
  .strictObject({ code: scanCodeSchema.optional(), packageId: z.uuid().optional() })
  .refine((v) => (v.code === undefined) !== (v.packageId === undefined), 'code_or_package');

export const listShipmentsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  q: z.string().trim().min(1).max(60).optional(),
});

export const shipmentActionSchema = z.strictObject({ note: optionalText(300) });

export const shipmentPackageParamSchema = z.strictObject({ id: z.uuid(), packageId: z.uuid() });
