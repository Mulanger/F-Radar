const dateTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeZone: 'Europe/Stockholm' });

export const acknowledgementTime = (value: string) => dateTime.format(new Date(value));
export const acknowledgementDay = (value: string) => dateOnly.format(new Date(value));
export const importedText = 'Äldre kvittering. Händelseuppgifterna hämtades vid importen.';

export const severityLabel = (level: string) => ({
  critical: 'Kritisk', warning: 'Varning', monitor: 'Bevakning', info: 'Information',
}[level] ?? 'Ej bedömd');
