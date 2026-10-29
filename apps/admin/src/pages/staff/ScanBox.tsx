import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Fields';

interface Props {
  name: string;
  label: string;
  hint?: string;
  submitLabel: string;
  disabled?: boolean;
  /** Reçoit le code saisi ou lu. Le champ est vidé et reprend le focus après chaque envoi : lecteur de codes-barres en rafale. */
  onScan(code: string): Promise<void>;
}

/**
 * Champ de lecture : un lecteur de codes-barres « tape » le code puis Entrée, ce qui envoie le formulaire.
 * Un envoi à la fois : tant que le précédent n'est pas terminé, les lectures suivantes attendent.
 */
export function ScanBox({ name, label, hint, submitLabel, disabled, onScan }: Props) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const code = value.trim();
    if (!code || busy) return;
    setBusy(true);
    try {
      await onScan(code);
    } finally {
      setValue('');
      setBusy(false);
      // Le champ reprend le focus pour la lecture suivante
      setTimeout(() => wrapper.current?.querySelector('input')?.focus(), 0);
    }
  }

  return (
    <form onSubmit={submit} className="form card" noValidate>
      <div ref={wrapper}>
        <TextField name={name} label={label} hint={hint} value={value} onChange={setValue} autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus disabled={disabled} />
      </div>
      <div className="form-actions">
        <Button type="submit" disabled={busy || disabled || value.trim() === ''}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
