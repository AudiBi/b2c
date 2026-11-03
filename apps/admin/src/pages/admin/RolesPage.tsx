import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ROLE_DEFINITIONS } from '@b2c/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { apiErrorMessage } from '../../forms/validation';
import { format, useI18n } from '../../i18n';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Fields';
import { Icon } from '../../components/ui/Icon';
import { PageHead } from '../../components/ui/PageHead';
import { useCan } from '../staff/queries';
import { RoleEditor } from './RoleEditor';
import { adminKeys, useRoles, type RoleItem } from './queries';

/**
 * Rôles et droits : les 12 rôles système (définis dans le code, en lecture seule) et les rôles PERSONNALISÉS de l'entreprise
 * (création, modification des droits, suppression), réservés à qui détient « role:manage ».
 */
export function RolesPage() {
  const { m } = useI18n();
  const r = m.admin.roles;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManage = useCan('role:manage') && user?.kind === 'STAFF';
  const roles = useRoles();
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<RoleItem | 'new' | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scopes = new Map(ROLE_DEFINITIONS.map((d) => [d.code as string, d.allowedScopes]));
  // Les rôles système sont définis dans le code : si le serveur n'en renvoie aucun (entreprise sans lignes de rôles), on affiche le catalogue partagé
  const audience = user?.kind === 'PLATFORM' ? 'PLATFORM' : 'STAFF';
  const fallback: RoleItem[] = ROLE_DEFINITIONS.filter((d) => audience === 'PLATFORM' || d.audience !== 'PLATFORM').map((d) => ({ code: d.code as string, name: d.name, description: d.description, isSystem: true, permissions: [...d.permissions].sort() }));
  const items = roles.data && roles.data.length > 0 ? roles.data : roles.isLoading || roles.isError ? [] : fallback;
  const custom = items.filter((x) => x.custom);
  const system = items.filter((x) => !x.custom);

  async function remove(role: RoleItem) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/v1/admin/roles/${role.code}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: adminKeys.roles });
      setNotice(r.editor.deleted);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
      setAsking(null);
    }
  }

  const card = (role: RoleItem) => {
    const expanded = open === role.code;
    const visible = filter ? role.permissions.filter((p) => p.includes(filter.trim().toLowerCase())) : role.permissions;
    const allowed = role.allowedScopes ?? scopes.get(role.code) ?? [];
    return (
      <li key={role.code} className="card">
        <div className="row-card" style={{ alignItems: 'center' }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ marginBottom: 2, fontSize: '1.05rem' }}>{role.name}</h3>
            {role.description ? <p className="muted" style={{ margin: 0 }}>{role.description}</p> : null}
            <div className="chip-row" style={{ marginTop: 8 }}>
              <span className="badge badge-info">{format(r.permissionsCount, { count: role.permissions.length })}</span>
              {allowed.map((s) => <span key={s} className="badge">{m.admin.users.scopes[s]}</span>)}
              {role.custom ? <span className="badge badge-warning">{r.custom}</span> : <span className="badge">{r.system}</span>}
              {role.holders !== undefined ? <span className="badge">{format(r.holders, { count: role.holders })}</span> : null}
            </div>
          </div>
          <div className="form-actions">
            {role.custom && canManage ? (
              asking === role.code ? (
                <>
                  <span className="muted">{r.editor.deleteAsk}</span>
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove(role)}>{r.editor.confirm}</Button>
                  <Button size="sm" variant="outline" onClick={() => setAsking(null)}>{m.common.cancel}</Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => setEditing(role)}>{m.common.edit}</Button>
                  <Button size="sm" variant="danger" onClick={() => setAsking(role.code)}>{m.common.delete}</Button>
                </>
              )
            ) : null}
            <Button size="sm" variant="outline" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : role.code)}>
              {expanded ? r.hidePermissions : r.showPermissions}
            </Button>
          </div>
        </div>
        {expanded ? (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <div style={{ maxWidth: 320, marginBottom: 12 }}>
              <TextField name={`filter-${role.code}`} label={r.search} value={filter} onChange={setFilter} />
            </div>
            <div className="perm-grid">
              {visible.map((p) => <code key={p} className="perm">{p}</code>)}
            </div>
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <>
      <PageHead
        title={r.title}
        lead={r.lead}
        actions={canManage ? <Button onClick={() => setEditing('new')}><Icon name="plus" width={16} height={16} /> {r.editor.create}</Button> : undefined}
      />
      {user?.kind === 'PLATFORM' ? <Alert tone="info">{r.platformNote}</Alert> : null}
      {notice ? <Alert tone="success" live>{notice}</Alert> : null}
      {error ? <Alert tone="danger" live>{error}</Alert> : null}
      {roles.isLoading ? <p role="status">{m.common.loading}</p> : null}
      {roles.isError ? <Alert tone="danger" live>{m.common.errorLoad}</Alert> : null}
      {!roles.isLoading && !roles.isError && items.length === 0 ? <div className="empty"><Icon name="key" /><p>{r.empty}</p></div> : null}

      {user?.kind === 'STAFF' && !roles.isLoading ? (
        <section aria-labelledby="custom-roles" className="stack">
          <h2 id="custom-roles">{r.customTitle}</h2>
          {custom.length === 0 ? <p className="muted">{canManage ? r.customEmptyManage : r.customEmpty}</p> : <ul className="list-plain">{custom.map(card)}</ul>}
        </section>
      ) : null}

      {system.length > 0 ? (
        <section aria-labelledby="system-roles" className="stack" style={{ marginTop: 24 }}>
          <h2 id="system-roles">{r.systemTitle}</h2>
          <ul className="list-plain">{system.map(card)}</ul>
        </section>
      ) : null}

      {editing ? (
        <RoleEditor
          role={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
          }}
        />
      ) : null}
    </>
  );
}
