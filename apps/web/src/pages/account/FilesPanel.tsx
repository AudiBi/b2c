import { useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ALLOWED_FILE_TYPES, MAX_FILE_BYTES } from '@b2c/shared';
import { api, apiUpload } from '../../api/client';
import { config } from '../../config';
import { apiErrorMessage } from '../../forms/validation';
import { useI18n } from '../../i18n';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { accountKeys, useFiles } from './queries';

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`);

interface Props {
  ownerType: 'PREALERT' | 'PACKAGE';
  ownerId: string;
  kind: 'INVOICE' | 'PHOTO' | 'DOCUMENT';
  title: string;
  /** Le client peut ajouter et retirer des fichiers (facture d'une préalerte encore ouverte). */
  editable: boolean;
  emptyText: string;
}

/** Liste des pièces jointes d'un objet, avec dépôt et retrait si le propriétaire peut encore les modifier. */
export function FilesPanel({ ownerType, ownerId, kind, title, editable, emptyText }: Props) {
  const { m } = useI18n();
  const i = m.account.prealerts.invoice;
  const queryClient = useQueryClient();
  const files = useFiles(ownerType, ownerId);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: accountKeys.files(ownerType, ownerId) });

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setNotice(null);
    setError(null);
    if (file.size > MAX_FILE_BYTES) {
      setError(i.tooBig);
      return;
    }
    if (!(ALLOWED_FILE_TYPES as readonly string[]).includes(file.type)) {
      setError(m.auth.errors.UNSUPPORTED_FILE);
      return;
    }
    setBusy(true);
    try {
      await apiUpload(`/v1/files?${new URLSearchParams({ ownerType, ownerId, kind, filename: file.name }).toString()}`, file);
      await refresh();
      setNotice(i.uploaded);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    setError(null);
    try {
      const link = await api<{ url: string }>(`/v1/files/${id}/link`);
      window.open(`${config.apiBase}${link.url}`, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  async function remove(id: string) {
    setNotice(null);
    setError(null);
    try {
      await api(`/v1/files/${id}`, { method: 'DELETE' });
      await refresh();
      setNotice(i.removed);
    } catch (e) {
      setError(apiErrorMessage(e, m));
    }
  }

  return (
    <section aria-label={title} className="files-panel">
      <h3 style={{ fontSize: '1rem' }}>{title}</h3>
      {files.isPending ? <p role="status">{m.common.loading}</p> : null}
      {files.isError ? <Alert tone="warning">{m.common.errorLoad}</Alert> : null}
      {files.data && files.data.items.length === 0 ? <p className="muted">{emptyText}</p> : null}
      <ul className="list-plain" style={{ gap: 6 }}>
        {files.data?.items.map((file) => (
          <li key={file.id} className="row-card">
            <span>
              {file.name} <span className="muted">({formatSize(file.size)})</span>
            </span>
            <span className="form-actions">
              <Button variant="outline" size="sm" onClick={() => open(file.id)} aria-label={`${i.open} : ${file.name}`}>
                {i.open}
              </Button>
              {editable ? (
                <Button variant="ghost" size="sm" onClick={() => remove(file.id)} aria-label={`${i.remove} : ${file.name}`}>
                  {i.remove}
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {editable ? (
        <>
          <input ref={input} type="file" hidden accept={ALLOWED_FILE_TYPES.join(',')} onChange={pick} aria-label={title} data-testid={`file-input-${ownerType.toLowerCase()}`} />
          <p>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? i.uploading : i.choose}
            </Button>{' '}
            <span className="muted">{i.hint}</span>
          </p>
        </>
      ) : null}
      <div aria-live="polite">
        {notice ? <p className="muted">{notice}</p> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </section>
  );
}
