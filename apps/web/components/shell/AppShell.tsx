'use client';

import type { Portfolio } from '@fastighetsradar/domain';
import { DashboardStateProvider, type DataMode } from '@/lib/state/dashboard-state';
import { C } from '@/lib/design/tokens';
import { PropertyEditorHost } from '../properties/PropertyEditorHost';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

/** Sidebar + header frame shared by both dashboard pages (stays mounted across navigation). */
export function AppShell({ mode, basePath, portfolio, children }: { mode: DataMode; basePath: string; portfolio: Portfolio; children: React.ReactNode }) {
  return (
    <DashboardStateProvider mode={mode} basePath={basePath} portfolio={portfolio}>
      <PropertyEditorHost>
        <div className="fr-shell" style={{ display: 'flex', minHeight: '100vh', background: C.page }}>
          <Sidebar />
          <main className="fr-main" style={{ flex: 1, minWidth: 0, padding: '18px 28px 48px', boxSizing: 'border-box' }}>
            <Header />
            {children}
          </main>
        </div>
      </PropertyEditorHost>
    </DashboardStateProvider>
  );
}
