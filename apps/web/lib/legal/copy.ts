import { legalText } from './company';

/** Del 4.4 – under "Så räknas poängen" in "Samlad fastighetsrisk" (desktop and mobile). */
export const RISK_INDEX_DISCLAIMER =
  'Riskindex är FastighetsRadars egen modell för snabb prioritering och utgör ingen officiell myndighetsbedömning. Följ alltid officiella varningar från SMHI och Krisinformation.';

/** Footer of the acknowledgement PDF reports (Kvitteringar). `domain` is the site's host. */
export function pdfLegalFooter(domain: string): string {
  return `Genererad av FastighetsRadar (${legalText('companyName')}) · Informations- och beslutsstöd baserat på externa datakällor. Se ${domain}/villkor.`;
}
