import { useQuery } from '@tanstack/react-query';
import { getFxRate } from '../api/public';
import { useI18n } from '../i18n';
import { formatMoney } from '../lib/format';

/** Équivalent indicatif en gourdes d'un montant en dollars (taux de l'entreprise) ; rien si le taux n'est pas réglé ou si la devise n'est pas le dollar. */
export function HtgHint({ amount, currency }: { amount: string | number; currency: string }) {
  const { m, lang } = useI18n();
  const rate = useQuery({ queryKey: ['public', 'fx-rate'], queryFn: ({ signal }) => getFxRate(signal), staleTime: 300_000, retry: false });
  const fx = rate.data?.htgPerUsd ?? null;
  if (fx === null || currency !== 'USD') return null;
  return (
    <small className="muted" data-testid="htg-hint">
      {' '}
      ≈ {formatMoney(Number(amount) * fx, 'HTG', lang)} ({m.common.indicative})
    </small>
  );
}
