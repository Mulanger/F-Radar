'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDashboard } from '@/lib/state/dashboard-state';
import { IconDashboard, IconBuilding, IconBell, IconSliders } from '../ui/icons';
import { useAndroidNavigation } from '@/lib/design/use-mobile-dashboard';

export function MobileNavigation({ onSettings }: { onSettings: () => void }) {
  const pathname = usePathname();
  const android = useAndroidNavigation();
  const { basePath, portfolio } = useDashboard();
  const alerts = portfolio.properties.reduce((n, s) => n + s.activeAlertCount, 0);
  const tabs = [
    { href: `${basePath}/overview`, label: 'Översikt', icon: <IconDashboard size={22} />, active: pathname === `${basePath}/overview` },
    { href: `${basePath}/properties`, label: 'Fastigheter', icon: <IconBuilding size={22} />, active: pathname?.startsWith(`${basePath}/properties`) },
    { href: `${basePath}/alerts`, label: 'Larm', icon: <IconBell size={22} />, active: pathname === `${basePath}/alerts`, badge: alerts },
  ];
  return <nav className={`fr-mobile-nav${android ? ' fr-mobile-nav--android' : ''}`} aria-label="Mobilnavigation">
    {tabs.map(t => <Link key={t.href} href={t.href} className="fr-mobile-nav-item" aria-current={t.active ? 'page' : undefined}><span className="fr-mobile-nav-icon">{t.icon}</span><span>{t.label}</span>{!!t.badge && <span className="fr-mobile-nav-badge" aria-label={`${t.badge} aktiva larm`}>{t.badge}</span>}</Link>)}
    <button className="fr-mobile-nav-item" onClick={onSettings} aria-label="Öppna inställningar och meny"><span className="fr-mobile-nav-icon"><IconSliders size={22} /></span><span>Inställningar</span></button>
  </nav>;
}
