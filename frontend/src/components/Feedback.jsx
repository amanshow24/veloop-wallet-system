export function Alert({ children, variant = 'error', className = '' }) {
  if (!children) {
    return null;
  }
  return (
    <div
      className={`alert alert-${variant} ${className}`.trim()}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="state-card" role="status" aria-live="polite">
      <span className="spinner" />
      <p>{label}</p>
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty-state">
      <span className="empty-state-mark" aria-hidden="true">—</span>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
    </div>
  );
}
