import { useState } from 'react';
import { ROLE_DEFINITIONS } from '@b2c/shared';
import { format, useI18n } from '../../i18n';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Fields';
import { Icon } from '../../components/ui/Icon';
import { PageHead } from '../../components/ui/PageHead';
import { useRoles } from './queries';

/** Catalogue en lecture seule des rôles et de leurs droits (les rôles sont définis dans le code, pas modifiables). */
export function RolesPage() {
  const { m } = useI18n();
  const r = m.admin.roles;
  const roles = useRoles();
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const scopes = new Map(ROLE_DEFINITIONS.map((d) => [d.code as string, d.allowedScopes]));
  const items = roles.data ?? [];

  return (
    <>
      <PageHead title={r.title} lead={r.lead} />
      {roles.isLoading ? <p role="status">{m.common.loading}</p> : null}
      {roles.isError ? <Alert tone="danger" live>{m.common.errorLoad}</Alert> : null}
      {!roles.isLoading && !roles.isError && items.length === 0 ? <div className="empty"><Icon name="key" /><p>{r.empty}</p></div> : null}
      <ul className="list-plain">
        {items.map((role) => {
          const expanded = open === role.code;
          const visible = filter ? role.permissions.filter((p) => p.includes(filter.trim().toLowerCase())) : role.permissions;
          return (
            <li key={role.code} className="card">
              <div className="row-card" style={{ alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ marginBottom: 2 }}>{role.name}</h2>
                  <p className="muted" style={{ margin: 0 }}>{role.description}</p>
                  <div className="chip-row" style={{ marginTop: 8 }}>
                    <span className="badge badge-info">{format(r.permissionsCount, { count: role.permissions.length })}</span>
                    {(scopes.get(role.code) ?? []).map((s) => <span key={s} className="badge">{m.admin.users.scopes[s]}</span>)}
                    {role.isSystem ? <span className="badge">{r.system}</span> : null}
                  </div>
                </div>
                <Button size="sm" variant="outline" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : role.code)}>
                  {expanded ? r.hidePermissions : r.showPermissions}
                </Button>
              </div>
              {expanded ? (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                  <div style={{ maxWidth: 320, marginBottom: 12 }}>
                    <TextField name={`filter-${role.code}`} label={r.search} value={filter} onChange={setFilter} />
                  </div>
                  <div className="perm-grid">
                    {visible.map((p) => <code key={p}>{p}</code>)}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
