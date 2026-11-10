import { useState } from 'react';

function PasswordField({
  label,
  name,
  autoComplete,
  value,
  onChange,
  placeholder,
  required = false,
  minLength,
  maxLength,
  hint,
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="field">
      <span>{label}</span>
      <span className="password-input-wrap">
        <input
          className="password-control-input"
          type={visible ? 'text' : 'password'}
          name={name}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
        />
        <button
          className="password-visibility-toggle"
          type="button"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {visible ? (
              <>
                <path d="M3 3l18 18" />
                <path d="M10.6 10.6a2 2 0 002.8 2.8" />
                <path d="M9.9 5.2A10.8 10.8 0 0112 5c5.5 0 9 7 9 7a15.7 15.7 0 01-3 3.8" />
                <path d="M6.2 6.2C4.1 7.6 3 12 3 12s3.5 7 9 7a10.7 10.7 0 004.1-.8" />
              </>
            ) : (
              <>
                <path d="M2.5 12s3.3-7 9.5-7 9.5 7 9.5 7-3.3 7-9.5 7-9.5-7-9.5-7z" />
                <circle cx="12" cy="12" r="2.5" />
              </>
            )}
          </svg>
        </button>
      </span>
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

export default PasswordField;
