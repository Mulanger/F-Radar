import type { ReactNode } from 'react';
import { AuthShell } from '@/components/auth/AuthShell';

/** /sign-in and /sign-up share one frame so the 3D scene survives switching between them. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
