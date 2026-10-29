import { useCallback, useState } from 'react';
import type { ZodType, z } from 'zod';
import { ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { issuesToErrors, serverFieldErrors, type FieldErrors } from './validation';

type Values = Record<string, unknown>;

/** Chaînes vides → valeur absente (les champs facultatifs vides ne sont pas envoyés ; les champs requis signalent « obligatoire »). */
function clean(values: Values): Values {
  const result: Values = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      result[key] = trimmed === '' ? undefined : value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * État d'un formulaire validé par un schéma zod PARTAGÉ avec l'API (mêmes règles des deux côtés).
 * Les erreurs sont traduites dans la langue courante.
 */
export function useZodForm<S extends ZodType>(schema: S, initial: Values) {
  const { m } = useI18n();
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});

  const set = useCallback((name: string, value: unknown) => {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!(name in current)) return current;
      const { [name]: _removed, ...rest } = current;
      return rest;
    });
  }, []);

  /** Renvoie les données validées, ou null en renseignant les erreurs par champ. */
  const validate = useCallback((): z.output<S> | null => {
    const parsed = schema.safeParse(clean(values));
    if (parsed.success) {
      setErrors({});
      return parsed.data;
    }
    setErrors(issuesToErrors(parsed.error, m));
    return null;
  }, [schema, values, m]);

  /** Applique les erreurs de champ d'une réponse VALIDATION_ERROR du serveur. */
  const applyServerError = useCallback(
    (error: unknown): boolean => {
      if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
        const fields = serverFieldErrors(error, m);
        if (Object.keys(fields).length > 0) {
          setErrors(fields);
          return true;
        }
      }
      return false;
    },
    [m],
  );

  const reset = useCallback((next: Values) => {
    setValues(next);
    setErrors({});
  }, []);

  return { values, errors, set, validate, applyServerError, reset, hasErrors: Object.keys(errors).length > 0 };
}
