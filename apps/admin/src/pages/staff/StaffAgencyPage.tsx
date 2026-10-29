import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { apiErrorMessage } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { localizedPath } from '../../routes';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormMessage, SelectField } from '../../components/ui/Fields';
import { StatusBadge } from '../../components/PackageParts';
import { ScanBox } from './ScanBox';
import { staffKeys, useAgencies, useAgencyPackages, type StaffPackage } from './queries';

type Outcome = 'RECEIVED' | 'ALREADY_RECEIVED';

/** Réception en agence par lecture de codes, puis passage « prêt pour retrait ». */
export function StaffAgencyPage() {
  const { m, lang } = useI18n();
  const a = m.staff.agency;
  const queryClient = useQueryClient();
  const agencies = useAgencies();
  const [selected, setSelected] = useState('');
  const list = agencies.data?.items ?? [];
  const agencyId = selected || list[0]?.id || '';
  const inventory = useAgencyPackages(agencyId);
  const [last, setLast] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: staffKeys.agencyPackages(agencyId) });

  async function scan(code: string) {
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ outcome: Outcome; package: StaffPackage }>(`/v1/admin/agencies/${agencyId}/receive`, { method: 'POST', body: { code } });
      setLast(`${res.package.trackingNumberDisplay} : ${a.outcomes[res.outcome]}`);
      await refresh();
    } catch (e) {
      setLast(null);
      setError(`${code} : ${apiErrorMessage(e, m)}`);
    }
  }

  async function ready(packageId: string) {
    setError(null);
    setNotice(null);
    try {
      await api(`/v1/admin/agencies/${agencyId}/packages/${packageId}/ready-for-pickup`, { method: 'POST' });
      setNotice(a.readyDone);
      await refresh();
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  return (
    <>
      <h1 style={{ fontSize: '1.9rem' }}>{a.title}</h1>
      <p className="lead">{a.lead}</p>
      {agencies.isPending ? <p role="status">{m.common.loading}</p> : null}
      {agencies.data && list.length === 0 ? <Alert tone="info">{m.staff.common.noAgency}</Alert> : null}
      {list.length > 0 ? (
        <>
          {list.length > 1 ? (
            <div className="card form">
              <SelectField name="agency" label={m.staff.common.selectAgency} value={agencyId} onChange={setSelected} options={list.map((x) => ({ value: x.id, label: `${x.name} (${x.city})` }))} />
            </div>
          ) : (
            <p><strong>{list[0].name}</strong> ({list[0].city})</p>
          )}
          <ScanBox name="agencyCode" label={a.code} submitLabel={a.submit} onScan={scan} />
          <div aria-live="polite">
            {last ? <p data-testid="agency-scan-result"><strong>{last}</strong></p> : null}
            {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
            {notice ? <FormMessage tone="success">{notice}</FormMessage> : null}
          </div>
          {inventory.data ? (
            <>
              {inventory.data.expected > 0 ? <Alert tone="info">{format(a.expected, { n: inventory.data.expected })}</Alert> : null}
              <h2 style={{ fontSize: '1.2rem' }}>{a.present}</h2>
              {inventory.data.items.length === 0 ? <p className="muted">{a.empty}</p> : null}
              <ul className="list-plain" data-testid="agency-packages">
                {inventory.data.items.map((p) => (
                  <li key={p.id} className="card">
                    <div className="row-card">
                      <div>
                        <strong className="mono">{p.trackingNumberDisplay}</strong> <StatusBadge status={p.status} />
                        <p className="muted" style={{ margin: '4px 0 0' }}>{p.customer ? `${p.customer.name ?? ''} (${p.customer.customerCode})` : ''}</p>
                      </div>
                      <div className="form-actions">
                        <Link className="btn btn-outline btn-sm" to={localizedPath(lang, `/packages/${p.id}`)}>{m.staff.common.open}</Link>
                        {p.status === 'RECEIVED_AT_AGENCY' ? (
                          <Button size="sm" onClick={() => ready(p.id)} aria-label={`${a.ready} : ${p.trackingNumberDisplay}`}>{a.ready}</Button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
