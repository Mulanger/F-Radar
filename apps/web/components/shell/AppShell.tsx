'use client';

import type { DataMode } from '@fastighetsradar/config';
import type { Portfolio } from '@fastighetsradar/domain';
import { DashboardStateProvider } from '@/lib/state/dashboard-state';
import { C } from '@/lib/design/tokens';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

/** Sidebar + header frame shared by both dashboard pages (stays mounted across navigation). */
export function AppShell({ mode, portfolio, children }: { mode: DataMode; portfolio: Portfolio; children: React.ReactNode }) {
  return (
    <DashboardStateProvider mode={mode} portfolio={portfolio}>
      <div style={{ display: 'flex', minHeight: '100vh', background: C.page }}>
        <Sidebar />
        <main style={{ flex: 1, minWidth: 0, padding: '18px 28px 48px', boxSizing: 'border-box' }}>
          <Header />
          {children}
        </main>
      </div>
    </DashboardStateProvider>
  );
}
