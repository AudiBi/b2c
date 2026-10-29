import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CUSTOM_ROLE_PERMISSIONS, CUSTOM_ROLE_SCOPES, PERMISSIONS, createCustomRoleSchema, updateCustomRoleSchema, type PermissionCode } from '@b2c/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { apiErrorMessage } from '../../forms/validation';
import { useI18n } from '../../i18n';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { FormMessage, SelectField, TextAreaField, TextField } from '../../components/ui/Fields';
import { adminKeys, type RoleItem } from './queries';

/** Groupes de droits : le préfixe du droit (« package:read » → « package »). */
const groupOf = (code: string) => code.split(':')[0];

/**
 * Création ou modification d'un rôle personnalisé. Les droits que la personne ne détient pas elle-même sont affichés mais
 * non cochables (anti-escalade) : le serveur le contrôle de toute façon.
 */
export function RoleEditor({ role, onClose, onSaved }: { role?: RoleItem; onClose(): void; onSaved(message: string): void }) {
  const { m } = useI18n();
  const r = m.admin.roles;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [scopeType, setScopeType] = useState<(typeof CUSTOM_ROLE_SCOPES)[number]>((role?.allowedScopes?.[0] as (typeof CUSTOM_ROLE_SCOPES)[number]) ?? 'COMPANY');
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [filter, setFilter] = useState('');
  const [errors, setErrors] = useState<{ name?: string; permissions?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mine = new Set(user?.permissions ?? []);
  const groups = useMemo(() => {
    const map = new Map<string, PermissionCode[]>();
    for (const code of CUSTOM_ROLE_PERMISSIONS) {
      if (filter && !code.includes(filter.trim().toLowerCase()) && !PERMISSIONS[code].toLowerCase().includes(filter.trim().toLowerCase())) continue;
      const list = map.get(groupOf(code)) ?? [];
      list.push(code);
      map.set(groupOf(code), list);
    }
    return [...map.entries()];
  }, [filter]);

  const toggle = (code: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(code);
      else next.delete(code);
      return next;
    });
  const setGroup = (codes: PermissionCode[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const code of codes) if (mine.has(code)) (on ? next.add(code) : next.delete(code));
      return next;
    });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const permissions = [...selected].sort();
    const body = role
      ? { name: name.trim(), description: description.trim() === '' ? null : description.trim(), permissions }
      : { name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), scopeType, permissions };
    const parsed = (role ? updateCustomRoleSchema : createCustomRoleSchema).safeParse(body);
    if (!parsed.success) {
      const next: { name?: string; permissions?: string } = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'name') next.name = m.validation.required;
        if (issue.path[0] === 'permissions') next.permissions = r.editor.permissionsRequired;
      }
      setErrors(next);
      setError(m.common.fixErrors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (role) await api(`/v1/admin/roles/${role.code}`, { method: 'PATCH', body: parsed.data });
      else await api('/v1/admin/roles', { method: 'POST', body: parsed.data });
      await queryClient.invalidateQueries({ queryKey: adminKeys.roles });
      onSaved(role ? r.editor.updated : r.editor.created);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={role ? r.editor.editTitle : r.editor.createTitle} onClose={onClose} wide>
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted" style={{ margin: 0 }}>{r.editor.lead}</p>
        {error ? <FormMessage tone="danger">{error}</FormMessage> : null}
        <div className="form-grid form-grid-2">
          <TextField name="roleName" label={r.editor.name} value={name} onChange={setName} error={errors.name} maxLength={60} autoComplete="off" />
          <SelectField
            name="roleScope"
            label={r.editor.scope}
            hint={role ? r.editor.scopeFixed : r.editor.scopeHint}
            value={scopeType}
            onChange={(value) => !role && setScopeType(value as (typeof CUSTOM_ROLE_SCOPES)[number])}
            options={CUSTOM_ROLE_SCOPES.map((s) => ({ value: s, label: m.admin.users.scopes[s] }))}
          />
        </div>
        <TextAreaField name="roleDescription" label={r.editor.description} optional value={description} onChange={setDescription} />

        <fieldset className="perm-editor" aria-describedby={errors.permissions ? 'perm-error' : undefined}>
          <legend>{r.editor.permissions} <span className="muted">({selected.size})</span></legend>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: '0.85rem' }}>{r.editor.permissionsHint}</p>
          {errors.permissions ? <span className="field-error" id="perm-error">{errors.permissions}</span> : null}
          <div style={{ maxWidth: 320, margin: '8px 0 12px' }}>
            <TextField name="permFilter" label={r.search} value={filter} onChange={setFilter} />
          </div>
          <div className="perm-groups">
            {groups.map(([group, codes]) => {
              const allowed = codes.filter((c) => mine.has(c));
              const allOn = allowed.length > 0 && allowed.every((c) => selected.has(c));
              return (
                <section key={group} className="perm-group" aria-label={r.groups[group as keyof typeof r.groups] ?? group}>
                  <div className="perm-group-head">
                    <h3>{r.groups[group as keyof typeof r.groups] ?? group}</h3>
                    {allowed.length > 0 ? (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGroup(codes, !allOn)}>
                        {allOn ? r.editor.clearGroup : r.editor.selectGroup}
                      </button>
                    ) : null}
                  </div>
                  {codes.map((code) => {
                    const locked = !mine.has(code);
                    return (
                      <label key={code} className={`perm-item${locked ? ' locked' : ''}`}>
                        <input type="checkbox" checked={selected.has(code)} disabled={locked && !selected.has(code)} onChange={(event) => toggle(code, event.target.checked)} />
                        <span>
                          <span className="perm-desc">{PERMISSIONS[code]}</span>
                          <code className="perm">{code}</code>
                          {locked ? <span className="muted"> · {r.editor.notHeld}</span> : null}
                        </span>
                      </label>
                    );
                  })}
                </section>
              );
            })}
          </div>
        </fieldset>
        <div className="form-actions">
          <Button type="submit" disabled={busy}>{busy ? m.common.saving : role ? m.common.save : r.editor.create}</Button>
          <Button variant="outline" onClick={onClose}>{m.common.cancel}</Button>
        </div>
      </form>
    </Dialog>
  );
}
