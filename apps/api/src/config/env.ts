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
    APP_NAME: z.string().default('TransitHaïti'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
    API_PUBLIC_URL: z.url().default('http://localhost:3100'),
    WEB_PUBLIC_URL: z.url().default('http://localhost:5173'),
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
    MAIL_FROM: z.string().default('TransitHaïti <no-reply@example.invalid>'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET : au moins 32 caractères'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    COOKIE_SECURE: bool,
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(1024).default(65536),

    /** Dossier des pièces jointes (stockage disque local). Hors du dossier public ; à sauvegarder avec la base. */
    FILES_DIR: z.string().min(1).default('./.data/files'),

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
    if (env.NODE_ENV !== 'production') return;
    const fail = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (!env.COOKIE_SECURE) fail('COOKIE_SECURE', 'doit être true en production');
    if (env.MAIL_TRANSPORT === 'memory') fail('MAIL_TRANSPORT', 'memory est réservé aux tests');
    if (env.ARGON2_MEMORY_KIB < 19456) fail('ARGON2_MEMORY_KIB', 'minimum 19456 (19 Mio) en production');
    if (env.JWT_ACCESS_SECRET.startsWith('__') || /change.?me/i.test(env.JWT_ACCESS_SECRET)) {
      fail('JWT_ACCESS_SECRET', 'valeur de substitution détectée');
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Configuration invalide :\n${lines.join('\n')}`);
  }
  return parsed.data;
}
