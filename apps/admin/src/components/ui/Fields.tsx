import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { Alert } from './Alert';

interface BaseProps {
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
}

function FieldShell({ id, label, error, hint, optional, children }: BaseProps & { id: string; children: ReactNode }) {
  const { m } = useI18n();
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {optional ? <span className="optional"> ({m.common.optional})</span> : null}
      </label>
      {children}
      {hint ? (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, error?: string, hint?: string) =>
  [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

interface TextFieldProps extends BaseProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'id'> {
  name: string;
  value: string;
  onChange(value: string): void;
}

export function TextField({ label, error, hint, optional, name, value, onChange, type = 'text', ...rest }: TextFieldProps) {
  const id = `${useId()}-${name}`;
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} optional={optional}>
      <input
        id={id}
        name={name}
        type={type}
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-required={optional ? undefined : true}
        aria-describedby={describedBy(id, error, hint)}
        {...rest}
      />
    </FieldShell>
  );
}

export function PasswordField(props: Omit<TextFieldProps, 'type'>) {
  const { m } = useI18n();
  const [shown, setShown] = useState(false);
  const { label, error, hint, optional, name, value, onChange, ...rest } = props;
  const id = `${useId()}-${name}`;
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} optional={optional}>
      <div className="input-with-button">
        <input
          id={id}
          name={name}
          type={shown ? 'text' : 'password'}
          className="input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-required={optional ? undefined : true}
          aria-describedby={describedBy(id, error, hint)}
          autoCapitalize="none"
          spellCheck={false}
          {...rest}
        />
        <button type="button" className="btn btn-outline btn-sm" aria-pressed={shown} onClick={() => setShown((s) => !s)}>
          {shown ? m.auth.fields.hidePassword : m.auth.fields.showPassword}
        </button>
      </div>
    </FieldShell>
  );
}

export function TextAreaField({ label, error, hint, optional, name, value, onChange }: BaseProps & { name: string; value: string; onChange(value: string): void }) {
  const id = `${useId()}-${name}`;
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} optional={optional}>
      <textarea
        id={id}
        name={name}
        className="textarea"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
      />
    </FieldShell>
  );
}

export function SelectField({ label, error, hint, optional, name, value, onChange, options }: BaseProps & { name: string; value: string; onChange(value: string): void; options: { value: string; label: string }[] }) {
  const id = `${useId()}-${name}`;
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} optional={optional}>
      <select
        id={id}
        name={name}
        className="select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function CheckField({ name, checked, onChange, error, children }: { name: string; checked: boolean; onChange(checked: boolean): void; error?: string; children: ReactNode }) {
  const id = `${useId()}-${name}`;
  return (
    <div className="field">
      <div className="check">
        <input
          id={id}
          name={name}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <label htmlFor={id}>{children}</label>
      </div>
      {error ? (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function RadioGroupField({ legend, name, value, onChange, options, error }: { legend: string; name: string; value: string; onChange(value: string): void; options: { value: string; label: string }[]; error?: string }) {
  const id = useId();
  return (
    <fieldset className="field" aria-describedby={error ? `${id}-error` : undefined} style={{ border: 0, padding: 0, margin: 0 }}>
      <legend>{legend}</legend>
      <div className="radio-group">
        {options.map((option) => (
          <label key={option.value}>
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
      {error ? (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}

/** Résumé d'erreur ou de confirmation : reçoit le focus à son apparition pour être annoncé et vu. */
export function FormMessage({ tone, children }: { tone: 'danger' | 'success' | 'info'; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} style={{ outline: 'none' }}>
      <Alert tone={tone} live>
        {children}
      </Alert>
    </div>
  );
}
