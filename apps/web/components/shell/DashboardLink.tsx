'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, type ComponentProps } from 'react';
import { canReturnThroughHistory, completeDashboardArrival, recordDashboardDeparture, type ReturnTarget } from '@/lib/navigation/dashboard';
import { IconChevronLeft } from '../ui/icons';

export function DashboardLink({ href, ...props }: Omit<ComponentProps<typeof Link>, 'href' | 'onNavigate'> & { href: string }) {
  return <Link {...props} href={href} onNavigate={() => recordDashboardDeparture(href)} />;
}

export function DashboardArrival() {
  const path = usePathname();
  const search = useSearchParams().toString();
  useEffect(completeDashboardArrival, [path, search]);
  return null;
}

export function DashboardBackLink({ target, className, compact = false }: {
  target: ReturnTarget; className?: string; compact?: boolean;
}) {
  const router = useRouter();
  const label = `Tillbaka till ${target.label}`;
  return <Link href={target.href} replace className={className ?? 'fr-dashboard-back'} aria-label={label}
    onNavigate={(event) => {
      completeDashboardArrival();
      if (canReturnThroughHistory(target.href)) {
        event.preventDefault();
        router.back();
      }
    }}>
    <IconChevronLeft size={18} />
    <span>{compact ? target.label : label}</span>
  </Link>;
}
