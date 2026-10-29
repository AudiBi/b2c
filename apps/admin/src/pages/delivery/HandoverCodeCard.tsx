import { useState } from 'react';
import { api } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormMessage } from '../../components/ui/Fields';

/** Code de remise du client : montré une seule fois (le serveur n'en garde que l'empreinte). */
export function HandoverCodeCard({ packageId }: { packageId: string }) {
  const { m, lang } = useI18n();
  const c = m.delivery.customer.code;
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setError(null);
    setBusy(true);
    try {
      setCode(await api<{ code: string; expiresAt: string }>(`/v1/me/packages/${packageId}/handover-code`, { method: 'POST' }));
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" data-testid="handover-card">
      <h2 style={{ fontSize: '1.1rem' }}>{c.title}</h2>
      <p>{c.lead}</p>
      {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
      {code ? (
        <Alert tone="success" title={c.shown}>
          <span className="mono" style={{ fontSize: '1.6rem', letterSpacing: '0.2em' }} data-testid="handover-code">
            {code.code}
          </span>
          <br />
          <span className="muted">{format(c.expires, { date: formatDateTime(code.expiresAt, lang) })}</span>
        </Alert>
      ) : null}
      <p className="muted">{c.warning}</p>
      <Button variant={code ? 'outline' : 'primary'} onClick={generate} disabled={busy}>
        {code ? c.regenerate : c.generate}
      </Button>
    </div>
  );
}
