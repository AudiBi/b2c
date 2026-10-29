import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { type ScopeType } from '@b2c/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { apiErrorMessage } from '../../forms/validation';
import { useI18n } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PageHead } from '../../components/ui/PageHead';
import { useAgencies, useCan, useWarehouses } from '../staff/queries';
import { adminKeys, useRoleNames, useUser } from './queries';
import { RoleScopePicker, statusTone } from './UsersPage';

export function UserDetailPage() {
  const { id = '' } = useParams();
  const { m, lang } = useI18n();
  const u = m.admin.users;
  const d = u.detail;
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const user = useUser(id);
  const warehouses = useWarehouses();
  const agencies = useAgencies();
  const canAssign = useCan('role:assign');
  const canDisable = useCan('user:disable');
  const [pick, setPick] = useState<{ roleCode: string; scopeType: ScopeType; scopeId: string }>({ roleCode: '', scopeType: 'COMPANY', scopeId: '' });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roleName = useRoleNames();
  const scopeLabel = (scopeType: string, scopeId: string | null) => {
    if (scopeType === 'COMPANY' || !scopeId) return u.scopes.COMPANY;
    if (scopeType === 'WAREHOUSE') return warehouses.data?.items.find((w) => w.id === scopeId)?.name ?? u.scopes.WAREHOUSE;
    if (scopeType === 'AGENCY') return agencies.data?.items.find((a) => a.id === scopeId)?.name ?? u.scopes.AGENCY;
    return u.scopes[scopeType as ScopeType] ?? scopeType;
  };

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: adminKeys.user(id) });
      await queryClient.invalidateQueries({ queryKey: adminKeys.usersAll });
      setNotice(success);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  if (user.isLoading) return <p role="status">{m.common.loading}</p>;
  if (user.isError || !user.data) return <Alert tone="danger" live>{m.common.errorLoad}</Alert>;
  const data = user.data;
  const self = me?.id === data.id;
  const isStaffAccount = data.kind !== 'CUSTOMER';

  return (
    <div className="stack">
      <Link to="/users" className="muted">← {d.back}</Link>
      <PageHead
        title={`${data.firstName} ${data.lastName}`}
        lead={data.email}
        actions={<span className={`badge${statusTone(data.status)}`}>{u.statuses[data.status]}</span>}
      />
      {notice ? <Alert tone="success" live>{notice}</Alert> : null}
      {error ? <Alert tone="danger" live>{error}</Alert> : null}

      <div className="grid grid-2">
        <section className="card" aria-labelledby="acct">
          <h2 id="acct">{d.accountTitle}</h2>
          <dl className="kv">
            <dt>{u.filterKind}</dt><dd>{u.kinds[data.kind]}</dd>
            <dt>{u.email}</dt><dd>{data.email}</dd>
            {data.phone ? (<><dt>{u.phone}</dt><dd>{data.phone}</dd></>) : null}
            <dt>{u.language}</dt><dd>{m.lang[data.locale]}</dd>
            <dt>{d.emailVerified}</dt><dd>{data.emailVerified ? d.yes : d.no}</dd>
            <dt>{d.created}</dt><dd>{formatDateTime(data.createdAt, lang)}</dd>
            <dt>{u.lastLogin}</dt><dd>{data.lastLoginAt ? formatDateTime(data.lastLoginAt, lang) : u.never}</dd>
          </dl>
        </section>

        {canDisable && !self ? (
          <section className="card" aria-labelledby="access">
            <h2 id="access">{d.dangerTitle}</h2>
            {data.status === 'DISABLED' ? (
              <Button disabled={busy} onClick={() => void run(() => api(`/v1/admin/users/${id}/enable`, { method: 'POST' }), u.enabledDone)}>{u.enable}</Button>
            ) : confirmDisable ? (
              <div className="stack">
                <Alert tone="warning">{u.disableAsk}</Alert>
                <div className="form-actions">
                  <Button variant="danger" disabled={busy} onClick={() => { setConfirmDisable(false); void run(() => api(`/v1/admin/users/${id}/disable`, { method: 'POST' }), u.disabledDone); }}>{d.confirm}</Button>
                  <Button variant="outline" onClick={() => setConfirmDisable(false)}>{d.cancel}</Button>
                </div>
              </div>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDisable(true)}>{u.disable}</Button>
            )}
          </section>
        ) : null}
      </div>

      <section className="card" aria-labelledby="roles-title">
        <div className="row-card" style={{ alignItems: 'center', marginBottom: 12 }}>
          <h2 id="roles-title" style={{ margin: 0 }}>{d.rolesTitle}</h2>
          {canAssign && isStaffAccount && !adding ? <Button size="sm" variant="outline" onClick={() => setAdding(true)}>{d.addRole}</Button> : null}
        </div>
        {data.roles.length === 0 ? <p className="muted">{d.noRoles}</p> : (
          <ul className="list-plain">
            {data.roles.map((assignment) => (
              <li key={assignment.userRoleId} className="card row-card" style={{ alignItems: 'center' }}>
                <div>
                  <strong>{roleName.get(assignment.roleCode) ?? assignment.roleCode}</strong>
                  <div className="muted" style={{ fontSize: '0.85rem' }}>{scopeLabel(assignment.scopeType, assignment.scopeId)}</div>
                </div>
                {canAssign && isStaffAccount ? (
                  removing === assignment.userRoleId ? (
                    <div className="form-actions">
                      <span className="muted">{d.removeAsk}</span>
                      <Button size="sm" variant="danger" disabled={busy} onClick={() => { setRemoving(null); void run(() => api(`/v1/admin/users/${id}/roles/${assignment.userRoleId}`, { method: 'DELETE' }), u.roleRemoved); }}>{d.confirm}</Button>
                      <Button size="sm" variant="outline" onClick={() => setRemoving(null)}>{d.cancel}</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setRemoving(assignment.userRoleId)}>{d.remove}</Button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {adding ? (
          <form
            className="form"
            style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}
            onSubmit={(event) => {
              event.preventDefault();
              if (!pick.roleCode) return;
              const body = { roleCode: pick.roleCode, scopeType: pick.scopeType, ...(pick.scopeId ? { scopeId: pick.scopeId } : {}) };
              void run(() => api(`/v1/admin/users/${id}/roles`, { method: 'POST', body }), u.roleAdded).then(() => {
                setAdding(false);
                setPick({ roleCode: '', scopeType: 'COMPANY', scopeId: '' });
              });
            }}
          >
            <h3>{d.addRole}</h3>
            <RoleScopePicker {...pick} onChange={setPick} />
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>{u.rules}</p>
            <div className="form-actions">
              <Button type="submit" disabled={busy || !pick.roleCode}>{d.add}</Button>
              <Button variant="outline" onClick={() => setAdding(false)}>{d.cancel}</Button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}
