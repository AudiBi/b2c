import type { Tx } from '../database/db.service';

/** Clé du réglage du taux gourdes/dollar (affichage indicatif seulement). */
export const FX_KEY = 'fx.htg_per_usd';

/** Taux courant (gourdes pour 1 dollar) ou null s'il n'est pas réglé. Aucune conversion comptable n'en découle. */
export async function readFxRate(tx: Tx, companyId: string): Promise<number | null> {
  const setting = await tx.companySetting.findUnique({ where: { companyId_key: { companyId, key: FX_KEY } } });
  const current = (setting?.value as { current?: { htgPerUsd?: number } | null } | undefined)?.current;
  return typeof current?.htgPerUsd === 'number' ? current.htgPerUsd : null;
}

/** Équivalent en gourdes d'un montant en dollars, arrondi au centime, ou null (autre devise ou taux absent). */
export function htgEquivalent(amount: string | null, currency: string, rate: number | null): string | null {
  if (rate === null || currency !== 'USD' || amount === null) return null;
  return (Math.round(Number(amount) * rate * 100) / 100).toFixed(2);
}
