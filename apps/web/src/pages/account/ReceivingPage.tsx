import { useState } from 'react';
import { useI18n } from '../../i18n';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { countryName } from '../LocationsPage';
import { useReceiving } from './queries';

function CopyButton({ text, label }: { text: string; label: string }) {
  const { m } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* presse-papiers indisponible : le texte reste sélectionnable */
        }
      }}
    >
      {copied ? m.common.copied : m.common.copy}
    </Button>
  );
}

export function ReceivingPage() {
  const { m, lang } = useI18n();
  const r = m.account.receiving;
  const query = useReceiving();

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{r.title}</h1>
      <p className="lead">{r.lead}</p>
      {query.isPending ? <p role="status">{m.common.loading}</p> : null}
      {query.isError ? <Alert tone="danger">{m.common.errorLoad}</Alert> : null}
      {query.data ? (
        <>
          <p>
            {r.codeLabel} : <span className="code-badge">{query.data.customerCode}</span>
          </p>
          <Alert tone="warning">{r.warning}</Alert>
          {query.data.warehouses.length === 0 ? <Alert tone="info">{r.empty}</Alert> : null}
          {query.data.warehouses.map((warehouse) => (
            <section key={warehouse.id} className="card" aria-labelledby={`wh-${warehouse.id}`}>
              <h2 id={`wh-${warehouse.id}`} style={{ fontSize: '1.2rem' }}>
                {warehouse.name} <span className="muted">· {warehouse.city}, {countryName(warehouse.country, lang)}</span>
              </h2>
              <div className="grid grid-2">
                {warehouse.addresses.map((address) => {
                  const text = address.lines.join('\n');
                  const heading = `${warehouse.name} (${r.modes[address.mode]})`;
                  return (
                    <div key={address.mode} data-testid={`receiving-${address.mode}`}>
                      <h3>{r.modes[address.mode]}</h3>
                      <address className="address-block">{text}</address>
                      <p style={{ marginTop: 8 }}>
                        <CopyButton text={text} label={`${r.copyAddress} : ${heading}`} />
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      ) : null}
    </>
  );
}
