import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { createStaffSchema, LOCALES, ROLE_DEFINITIONS, type ScopeType } from '@b2c/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { apiErrorMessage } from '../../forms/validation';
import { useZodForm } from '../../forms/useZodForm';
import { format, useI18n } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { FormMessage, SelectField, TextField } from '../../components/ui/Fields';
import { Icon } from '../../components/ui/Icon';
import { PageHead } from '../../components/ui/PageHead';
import { useAgencies, useCan, useWarehouses } from '../staff/queries';
import { adminKeys, useRoleNames, useRoles, useUsers, type UserItem } from './queries';

export const statusTone = (status: UserItem['status']) => (status === 'ACTIVE' ? ' badge-success' : status === 'PENDING' ? ' badge-warning' : ' badge-danger');

/** Formulaire commun de choix d'un rôle et de sa portée (invitation et ajout de rôle). */
export function RoleScopePicker({
  roleCode, scopeType, scopeId, onChange, errors,
}: {
  roleCode: string;
  scopeType: ScopeType;
  scopeId: string;
  onChange(next: { roleCode: string; scopeType: ScopeType; scopeId: string }): void;
  errors?: { roleCode?: string; scopeId?: string };
}) {
  const { m } = useI18n();
  const u = m.admin.users;
  const { user } = useAuth();
  const roleName = useRoleNames();
  const warehouses = useWarehouses();
  const agencies = useAgencies();
  // Les rôles proposés viennent du catalogue partagé (ils ne dépendent donc pas des lignes de la base) : le personnel d'une entreprise
  // reçoit des rôles « personnel », l'équipe plateforme des rôles « plateforme ». Le serveur reste l'autorité (anti-escalade, portée).
  const definitions = new Map(ROLE_DEFINITIONS.map((r) => [r.code as string, r]));
  const audience = user?.kind === 'PLATFORM' ? 'PLATFORM' : 'STAFF';
  const roles = useRoles();
  const customRoles = (roles.data ?? []).filter((r) => r.custom);
  const options = [
    ...ROLE_DEFINITIONS.filter((r) => r.audience === audience).map((r) => ({ code: r.code as string, name: roleName.get(r.code) ?? r.name })),
    ...(audience === 'STAFF' ? customRoles.map((r) => ({ code: r.code, name: `${r.name} (${m.admin.roles.custom.toLowerCase()})` })) : []),
  ];
  const customScopes = new Map(customRoles.map((r) => [r.code, (r.allowedScopes ?? ['COMPANY']) as readonly ScopeType[]]));
  const allowed = (customScopes.get(roleCode) ?? definitions.get(roleCode)?.allowedScopes ?? ['COMPANY']) as readonly ScopeType[];
  const targets = scopeType === 'WAREHOUSE' ? (warehouses.data?.items ?? []).map((w) => ({ value: w.id, label: `${w.name} (${w.reference})` })) : scopeType === 'AGENCY' ? (agencies.data?.items ?? []).map((a) => ({ value: a.id, label: a.name })) : [];

  return (
    <>
      <SelectField
        name="roleCode"
        label={u.role}
        value={roleCode}
        error={errors?.roleCode}
        onChange={(value) => {
          const next = (customScopes.get(value) ?? definitions.get(value)?.allowedScopes ?? ['COMPANY']) as readonly ScopeType[];
          onChange({ roleCode: value, scopeType: next[0], scopeId: '' });
        }}
        options={[{ value: '', label: u.selectTarget }, ...options.map((r) => ({ value: r.code, label: r.name }))]}
      />
      {roleCode ? (
        <SelectField
          name="scopeType"
          label={u.scope}
          value={scopeType}
          onChange={(value) => onChange({ roleCode, scopeType: value as ScopeType, scopeId: '' })}
          options={allowed.map((s) => ({ value: s, label: u.scopes[s] }))}
        />
      ) : null}
      {scopeType === 'WAREHOUSE' || scopeType === 'AGENCY' ? (
        <SelectField name="scopeId" label={u.scopeTarget} value={scopeId} error={errors?.scopeId} onChange={(value) => onChange({ roleCode, scopeType, scopeId: value })} options={[{ value: '', label: u.selectTarget }, ...targets]} />
      ) : null}
    </>
  );
}

function InviteDialog({ onClose }: { onClose(): void }) {
  const { m } = useI18n();
  const u = m.admin.users;
  const queryClient = useQueryClient();
  const form = useZodForm(createStaffSchema, { email: '', firstName: '', lastName: '', phone: '', locale: 'fr' });
  const [pick, setPick] = useState<{ roleCode: string; scopeType: ScopeType; scopeId: string }>({ roleCode: '', scopeType: 'COMPANY', scopeId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const roleEntry = { roleCode: pick.roleCode, scopeType: pick.scopeType, ...(pick.scopeId ? { scopeId: pick.scopeId } : {}) };
    // Le rôle fait partie du corps : on le place dans les valeurs avant la validation partagée
    form.set('roles', pick.roleCode ? [roleEntry] : undefined);
    const data = createStaffSchema.safeParse({ ...Object.fromEntries(Object.entries(form.values).map(([k, v]) => [k, typeof v === 'string' && v.trim() === '' ? undefined : v])), roles: pick.roleCode ? [roleEntry] : undefined });
    if (!data.success) {
      form.validate();
      setError(m.common.fixErrors);
      return;
    }
    setBusy(true);
    try {
      await api('/v1/admin/users', { method: 'POST', body: data.data });
      await queryClient.invalidateQueries({ queryKey: adminKeys.usersAll });
      setDone(format(u.invited, { email: data.data.email }));
    } catch (e) {
      if (!form.applyServerError(e)) setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={u.invite} onClose={onClose}>
      {done ? (
        <>
          <Alert tone="success" live>{done}</Alert>
          <div className="form-actions"><Button onClick={onClose}>{m.common.close}</Button></div>
        </>
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          <p className="muted" style={{ margin: 0 }}>{u.inviteLead}</p>
          {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
          <div className="form-grid form-grid-2">
            <TextField name="firstName" label={u.firstName} value={String(form.values.firstName)} onChange={(v) => form.set('firstName', v)} error={form.errors.firstName} autoComplete="off" />
            <TextField name="lastName" label={u.lastName} value={String(form.values.lastName)} onChange={(v) => form.set('lastName', v)} error={form.errors.lastName} autoComplete="off" />
          </div>
          <TextField name="email" type="email" label={u.email} value={String(form.values.email)} onChange={(v) => form.set('email', v)} error={form.errors.email} autoComplete="off" inputMode="email" />
          <div className="form-grid form-grid-2">
            <TextField name="phone" label={u.phone} optional value={String(form.values.phone)} onChange={(v) => form.set('phone', v)} error={form.errors.phone} inputMode="tel" />
            <SelectField name="locale" label={u.language} value={String(form.values.locale)} onChange={(v) => form.set('locale', v)} options={LOCALES.map((l) => ({ value: l, label: m.lang[l] }))} />
          </div>
          <RoleScopePicker {...pick} onChange={setPick} errors={{ roleCode: form.errors.roles, scopeId: form.errors.scopeId }} />
          <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>{u.rules}</p>
          <div className="form-actions">
            <Button type="submit" disabled={busy}>{busy ? m.common.saving : u.send}</Button>
            <Button variant="outline" onClick={onClose}>{m.common.cancel}</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function UsersPage() {
  const { m, lang } = useI18n();
  const u = m.admin.users;
  const canInvite = useCan('user:create');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [applied, setApplied] = useState({ q: '', kind: '', status: '' });
  const [invite, setInvite] = useState(false);
  const users = useUsers(applied);
  const roleName = useRoleNames();
  const items = users.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHead
        title={u.title}
        lead={u.lead}
        actions={canInvite ? <Button onClick={() => setInvite(true)}><Icon name="plus" width={16} height={16} /> {u.invite}</Button> : undefined}
      />
      <form className="toolbar" role="search" aria-label={u.title} onSubmit={(event) => { event.preventDefault(); setApplied({ q: q.trim(), kind, status }); }}>
        <div style={{ flex: '1 1 260px' }}><TextField name="q" label={u.search} value={q} onChange={setQ} /></div>
        <SelectField name="kind" label={u.filterKind} value={kind} onChange={setKind} options={[{ value: '', label: u.all }, { value: 'STAFF', label: u.kinds.STAFF }, { value: 'CUSTOMER', label: u.kinds.CUSTOMER }]} />
        <SelectField name="status" label={u.filterStatus} value={status} onChange={setStatus} options={[{ value: '', label: u.all }, { value: 'ACTIVE', label: u.statuses.ACTIVE }, { value: 'PENDING', label: u.statuses.PENDING }, { value: 'DISABLED', label: u.statuses.DISABLED }]} />
        <Button type="submit" variant="outline">{u.searchBtn}</Button>
      </form>

      {users.isLoading ? <p role="status">{m.common.loading}</p> : null}
      {users.isError ? <Alert tone="danger" live>{m.common.errorLoad}</Alert> : null}
      {!users.isLoading && !users.isError && items.length === 0 ? (
        <div className="empty"><Icon name="users" /><p>{u.empty}</p></div>
      ) : null}
      {items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{u.name}</th>
                <th scope="col">{u.roles}</th>
                <th scope="col">{u.filterStatus}</th>
                <th scope="col">{u.lastLogin}</th>
                <th scope="col"><span className="sr-only">{u.open}</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.firstName} {item.lastName}</strong>
                    <div className="muted" style={{ fontSize: '0.85rem' }}>{item.email}</div>
                  </td>
                  <td>
                    <div className="chip-row">
                      {item.roles.length === 0 ? <span className="muted">—</span> : item.roles.map((r) => <span key={r.userRoleId} className="badge badge-info">{roleName.get(r.roleCode) ?? r.roleCode}</span>)}
                    </div>
                  </td>
                  <td><span className={`badge${statusTone(item.status)}`}>{u.statuses[item.status]}</span></td>
                  <td className="muted">{item.lastLoginAt ? formatDateTime(item.lastLoginAt, lang) : u.never}</td>
                  <td className="num"><Link className="btn btn-outline btn-sm" to={`/users/${item.id}`} aria-label={`${u.open} : ${item.firstName} ${item.lastName}`}>{u.open}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {users.hasNextPage ? (
        <div className="form-actions" style={{ marginTop: 16 }}>
          <Button variant="outline" disabled={users.isFetchingNextPage} onClick={() => void users.fetchNextPage()}>{u.loadMore}</Button>
        </div>
      ) : null}
      {invite ? <InviteDialog onClose={() => setInvite(false)} /> : null}
    </>
  );
}
