import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { clerkAppearance } from '@/lib/design/clerk-appearance';
import 'leaflet/dist/leaflet.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'FastighetsRadar',
  description: 'Adressbaserad bevakning av svensk offentlig data för fastighetsportföljer.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <ClerkProvider
          appearance={clerkAppearance}
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          signInFallbackRedirectUrl="/overview"
          signUpFallbackRedirectUrl="/onboarding"
          afterSignOutUrl="/sign-in"
          taskUrls={{ 'choose-organization': '/onboarding' }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
