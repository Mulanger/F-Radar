import type { Metadata } from 'next';
import { auth } from '@clerk/nextjs/server';
import { PricingPage } from '@/components/pricing/PricingPage';

const description =
  'Börja gratis på en fastighet eller prova Pro fritt i 14 dagar. Svensk företagsfaktura med 30 dagars betalningstid – inget företagskort krävs. Alla priser exkl. moms.';

export const metadata: Metadata = {
  title: 'Priser – FastighetsRadar',
  description,
  openGraph: {
    title: 'Priser – FastighetsRadar',
    description,
    type: 'website',
    locale: 'sv_SE',
    siteName: 'FastighetsRadar',
  },
};

/** Public pricing page. Signed-in visitors get dashboard shortcuts instead of sign-up CTAs. */
export default async function Priser() {
  const { userId } = await auth();
  return <PricingPage signedIn={Boolean(userId)} />;
}
