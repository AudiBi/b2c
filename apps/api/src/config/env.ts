import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_NAME: z.string().default('B2C'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
    API_PUBLIC_URL: z.url().default('http://localhost:3100'),
    WEB_PUBLIC_URL: z.url().default('http://localhost:5173'),
    /** Panel d'administration (personnel et plateforme) : adresse des liens d'invitation et de réinitialisation de leurs comptes. */
    ADMIN_PUBLIC_URL: z.url().default('http://localhost:5174'),
    CORS_ORIGINS: csv,
    TRUST_PROXY: bool,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    ENABLE_DOCS: bool,

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),

    MAIL_TRANSPORT: z.enum(['smtp', 'memory']).default('smtp'),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().default(1035),
    SMTP_SECURE: bool,
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    MAIL_FROM: z.string().default('B2C <no-reply@example.invalid>'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET : au moins 32 caractères'),
    /** Clé de chiffrement des secrets de double authentification (32 caractères au moins). Absente : dérivée de JWT_ACCESS_SECRET (déconseillé en production). */
    TOTP_ENCRYPTION_KEY: z.string().min(32, 'TOTP_ENCRYPTION_KEY : au moins 32 caractères').optional(),
    /** Double authentification obligatoire pour le personnel et la plateforme (obligatoire en production). */
    REQUIRE_STAFF_2FA: bool,
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    COOKIE_SECURE: bool,
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(1024).default(65536),

    /** Dossier des pièces jointes (stockage disque local). Hors du dossier public ; à sauvegarder avec la base. */
    FILES_DIR: z.string().min(1).default('./.data/files'),

    /** Stockage des pièces jointes : disque local (défaut) ou stockage objet compatible S3. */
    STORAGE_DRIVER: z.enum(['disk', 's3']).default('disk'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(3).max(63).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    /** Adressage « chemin » (http://hôte/bucket/clé) : requis par la plupart des stockages auto-hébergés. */
    S3_FORCE_PATH_STYLE: bool,

    /** Intervalle du traitement de fond des notifications (ms). 0 : désactivé (tests, ou traitement externe). */
    NOTIFICATION_WORKER_INTERVAL_MS: z.coerce.number().int().min(0).default(10_000),

    /**
     * Confirmations de paiement par un prestataire : le point d'entrée n'existe que si ces deux variables sont renseignées.
     * Le secret signe chaque notification (HMAC-SHA256) ; il se partage avec le prestataire, jamais dans le dépôt.
     */
    PAYMENT_WEBHOOK_PROVIDER: z.string().regex(/^[a-z][a-z0-9_-]{1,30}$/).optional(),
    PAYMENT_WEBHOOK_SECRET: z.string().min(32).optional(),
  })
  .superRefine((env, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (env.STORAGE_DRIVER === 's3') {
      for (const name of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[name]) fail(name, 'obligatoire quand STORAGE_DRIVER=s3');
      }
    }
    if (env.NODE_ENV !== 'production') return;
    if (!env.COOKIE_SECURE) fail('COOKIE_SECURE', 'doit être true en production');
    if (!env.REQUIRE_STAFF_2FA) fail('REQUIRE_STAFF_2FA', 'doit être true en production (double authentification du personnel)');
    if (!env.TOTP_ENCRYPTION_KEY) fail('TOTP_ENCRYPTION_KEY', 'obligatoire en production (clé distincte de JWT_ACCESS_SECRET)');
    if (env.TOTP_ENCRYPTION_KEY && env.TOTP_ENCRYPTION_KEY === env.JWT_ACCESS_SECRET) fail('TOTP_ENCRYPTION_KEY', 'doit différer de JWT_ACCESS_SECRET');
    if (env.MAIL_TRANSPORT === 'memory') fail('MAIL_TRANSPORT', 'memory est réservé aux tests');
    if (env.ARGON2_MEMORY_KIB < 19456) fail('ARGON2_MEMORY_KIB', 'minimum 19456 (19 Mio) en production');
    if (env.JWT_ACCESS_SECRET.startsWith('__') || /change.?me/i.test(env.JWT_ACCESS_SECRET)) {
      fail('JWT_ACCESS_SECRET', 'valeur de substitution détectée');
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Une variable vide (docker compose transmet « VAR: ${VAR:-} » comme une chaîne vide) équivaut à une variable absente
  const present = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Configuration invalide :\n${lines.join('\n')}`);
  }
  return parsed.data;
}
