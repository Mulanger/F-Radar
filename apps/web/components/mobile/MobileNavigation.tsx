'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useDashboard } from '@/lib/state/dashboard-state';
import { IconDashboard, IconBuilding, IconBell, IconUser } from '../ui/icons';
import { useAndroidNavigation } from '@/lib/design/use-mobile-dashboard';

export function MobileNavigation() {
  const pathname = usePathname();
  const via = useSearchParams().get('via');
  const android = useAndroidNavigation();
  const { basePath, unseenAlarmCount } = useDashboard();
  const isHistory = pathname === `${basePath}/acknowledgements`;
  const isProperty = pathname?.startsWith(`${basePath}/properties/`);
  const isSms = !basePath && pathname === '/sms-rules';
  const profilePath = `${basePath}/profile`;
  const tabs = [
    { href: `${basePath}/overview`, label: 'Översikt', icon: <IconDashboard size={22} />, active: pathname === `${basePath}/overview` },
    { href: `${basePath}/properties`, label: 'Fastigheter', icon: <IconBuilding size={22} />, active: pathname === `${basePath}/properties`, section: isProperty || (isSms && via === 'property') },
    { href: `${basePath}/alerts`, label: 'Larm', icon: <IconBell size={22} />, active: pathname === `${basePath}/alerts`, badge: unseenAlarmCount, section: isHistory && via !== 'profile' },
    { href: profilePath, label: 'Profil', icon: <IconUser size={22} />, active: pathname === profilePath, section: (isHistory && via === 'profile') || (isSms && via !== 'property') || (!basePath && pathname === '/settings') },
  ];
  return <nav className={`fr-mobile-nav${android ? ' fr-mobile-nav--android' : ''}`} aria-label="Mobilnavigation">
    {tabs.map(t => <Link key={t.href} href={t.href} className="fr-mobile-nav-item" aria-current={t.active ? 'page' : t.section ? 'location' : undefined}><span className="fr-mobile-nav-icon">{t.icon}</span><span>{t.label}</span>{!!t.badge && <span className="fr-mobile-nav-badge" aria-label={`${t.badge} olästa larm`}>{t.badge}</span>}</Link>)}
  </nav>;
}
