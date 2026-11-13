import type { Metadata } from 'next';
import { auth } from '@clerk/nextjs/server';
import { LandingPage } from '@/components/landing/LandingPage';

const description =
  'FastighetsRadar samlar varningar, väder, vatten, luftkvalitet och händelser från svenska myndigheter för varje adress i din portfölj – och skickar SMS när det spelar roll.';

export const metadata: Metadata = {
  title: 'FastighetsRadar – allt som påverkar dina fastigheter, på ett ställe',
  description,
  openGraph: {
    title: 'FastighetsRadar',
    description,
    type: 'website',
    locale: 'sv_SE',
    siteName: 'FastighetsRadar',
  },
};

/** Public start page. Signed-in visitors see shortcuts to the dashboard instead of sign-up CTAs. */
export default async function Home() {
  const { userId } = await auth();
  return <LandingPage signedIn={Boolean(userId)} />;
}
