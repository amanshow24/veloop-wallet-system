const numberFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function formatAmount(amount) {
  return numberFormatter.format(amount);
}

export function formatDate(date) {
  if (!date) {
    return '—';
  }
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsedDate);
}
