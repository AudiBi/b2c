import type { ZodError } from 'zod';
import { ApiError } from '../api/client';
import { format } from '../i18n';
import type { Messages } from '../i18n/fr';

type Issue = ZodError['issues'][number];

/**
 * Les schémas partagés (packages/shared) utilisent des codes de message stables (ex. « password_common ») :
 * le serveur les renvoie tels quels, l'interface les traduit dans la langue courante.
 */
function fromCode(code: string, m: Messages): string | undefined {
  const v = m.validation;
  switch (code) {
    case 'required': return v.required;
    case 'password_min': return format(v.minLength, { n: 10 });
    case 'password_max': return format(v.maxLength, { n: 128 });
    case 'password_common': return v.passwordCommon;
    case 'password_contains_email': return v.passwordContainsEmail;
    case 'phone_format': return v.phone;
    case 'terms_required': return v.terms;
    case 'country_format': return v.countryCode;
    case 'date_format': return v.dateFormat;
    case 'date_order': return v.dateOrder;
    case 'id_last4_format': return v.idLast4;
    default: return undefined;
  }
}

export function localizeIssue(issue: Issue, m: Messages): string {
  const byCode = fromCode(issue.message, m);
  if (byCode) return byCode;
  const v = m.validation;
  switch (issue.code) {
    case 'invalid_type':
      return v.required;
    case 'too_small':
      return Number(issue.minimum) === 1 ? v.required : format(v.minLength, { n: Number(issue.minimum) });
    case 'too_big':
      return format(v.maxLength, { n: Number(issue.maximum) });
    case 'invalid_format':
      return issue.format === 'email' ? v.email : v.invalid;
    default:
      return v.invalid;
  }
}

export type FieldErrors = Record<string, string>;

export function issuesToErrors(error: ZodError, m: Messages): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (!(key in errors)) errors[key] = localizeIssue(issue, m);
  }
  return errors;
}

/** Erreurs de champ renvoyées par le serveur (détails de VALIDATION_ERROR), traduites. */
export function serverFieldErrors(error: ApiError, m: Messages): FieldErrors {
  const errors: FieldErrors = {};
  for (const [path, message] of Object.entries(error.fieldErrors)) {
    errors[path] = fromCode(message, m) ?? m.validation.invalid;
  }
  return errors;
}

/** Message général pour une erreur d'API : texte du catalogue selon le code, sinon message générique. */
export function apiErrorMessage(error: unknown, m: Messages): string {
  if (error instanceof ApiError) return m.auth.errors[error.code] ?? m.common.errorGeneric;
  return m.common.errorNetwork;
}
