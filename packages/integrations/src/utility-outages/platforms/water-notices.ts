/** Only a notice heading classifies boiling; general advice and historical body text do not. */
export function waterNoticeHeading(title: string) {
  if (/bevattningsförbud|spara (?:på )?vatt(?:en|net)/i.test(title)) return 'water_restriction' as const;
  return /^(?:(?:hävd|upphävd)\s+)?kokningsrekommendation(?:en)?\b/i.test(title.trim()) ? 'boil_water' as const : null;
}
export const boilingEndedHeading = (title: string) => /^(?:hävd|upphävd)\s+kokningsrekommendation|^kokningsrekommendation(?:en)?\s+(?:är\s+)?(?:hävd|upphävd|har upphört)/i.test(title.trim());
