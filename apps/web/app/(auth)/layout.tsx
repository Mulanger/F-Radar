import type { ReactNode } from 'react';
import { AuthShell } from '@/components/auth/AuthShell';

/** /sign-in, /sign-up and /onboarding share one frame so the 3D scene survives moving between them. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
