'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { NOTIFICATION_CATEGORIES, type NotificationActivity, type NotificationDashboard, type NotificationRule, type NotificationRuleInput, type Portfolio } from '@fastighetsradar/domain';
import { sectionTarget } from '@/lib/navigation/dashboard';
import { useDashboard } from '@/lib/state/dashboard-state';
import { groupOptions } from '@/lib/view-models/groups';
import { DashboardBackLink } from '../shell/DashboardLink';
import { SmsManagement } from './SmsManagement';

/** A simulation scoped to the mounted demo, shared with the property group dialog. */
function createDemoSmsRules() {
  const recipient = { id: 'demo-recipient', maskedPhone: 'Demomottagare', consent: true, verificationStatus: 'pending' as const, verificationExpiresAt: null };
  let rules: NotificationRule[] = [];
  let activity: NotificationActivity[] = [];
  let sequence = 0;

  function dashboard(portfolio: Portfolio): NotificationDashboard {
    return {
      rules,
      activity,
      properties: portfolio.properties.map(({ property: { id, name, groupIds } }) => ({ id, name, groupIds })),
      groups: groupOptions(portfolio).filter((g) => g.id !== 'all').map((g) => ({ id: g.id, name: g.label, propertyCount: g.count })),
      recipients: [recipient],
      usage: { simulated: activity.length, parts: activity.reduce((n, a) => n + a.parts, 0), estimatedCostSek: null,
        realCostSek: 0, dailyLimit: 20, monthlyLimit: 100, globalMonthlyCapSek: 0, pricePerPartSek: null, retentionDays: 30 },
      canManage: true,
      mode: 'simulated',
      categories: NOTIFICATION_CATEGORIES,
    };
  }

  function request(portfolio: Portfolio, path: string, method = 'GET', body?: unknown): unknown {
    if (!path && method === 'GET') return dashboard(portfolio);
    const match = /^\/rules(?:\/([^/]+))?(?:\/(preview|test))?$/.exec(path);
    if (!match) throw new Error('Åtgärden finns inte i demon.');
    const [, id, action] = match;
    const rule = id ? rules.find((r) => r.id === id) : undefined;
    if (id && !rule) throw new Error('Regeln finns inte längre.');

    if (action && rule) {
      const properties = portfolio.properties.filter(({ property: p }) => rule.scope === 'all_future'
        || (rule.scope === 'group' ? !!rule.groupId && p.groupIds.includes(rule.groupId) : rule.propertyIds.includes(p.id)));
      const propertyCount = properties.length;
      const names = (rule.groupProperties ? properties : properties.slice(0, 1)).map(({ property }) => property.name);
      if (action === 'preview') {
        const summary = names.length > 1 ? `${names[0]} och ${names.length - 1} till` : names[0];
        return { message: summary ? `FastighetsRadar Demo: ${summary}. Exempel för regeln ”${rule.name}”.`
          : 'FastighetsRadar Demo: Regeln omfattar inga fastigheter.', parts: summary ? 1 : 0, estimatedCostSek: null, eligible: !!summary, propertyCount };
      }
      const scenario = (body as { scenario?: string } | undefined)?.scenario ?? 'success';
      const status = !names.length ? 'not_eligible' : scenario === 'success' ? 'simulated' : scenario === 'timeout' ? 'unknown' : 'simulated_failure';
      activity = [{ id: `demo-activity-${++sequence}`, status, ruleName: rule.name, propertyNames: names,
        createdAt: new Date().toISOString(), maskedPhone: recipient.maskedPhone, parts: names.length ? 1 : 0,
        estimatedCostSek: null, isTest: true, verificationRequired: true, detail: null }, ...activity].slice(0, 50);
      return { generated: 1, propertyCount };
    }
    if (method === 'DELETE') {
      rules = rules.filter((r) => r.id !== id);
      return null;
    }

    const input = { ...rule, ...(body as NotificationRuleInput) };
    if (!input.name.trim()) throw new Error('Skriv ett namn på regeln.');
    if (!input.recipientIds.length) throw new Error('Välj en mottagare.');
    if (input.scope === 'selected' && !input.propertyIds.length) throw new Error('Välj minst en fastighet.');
    if (input.scope === 'group' && !portfolio.groups.some((g) => g.id === input.groupId)) throw new Error('Välj en fastighetsgrupp.');
    const time = new Date().toISOString();
    const saved = { ...input, id: rule?.id ?? `demo-rule-${++sequence}`, createdAt: rule?.createdAt ?? time, updatedAt: time };
    rules = rule ? rules.map((r) => r.id === saved.id ? saved : r) : [...rules, saved];
    return { id: saved.id };
  }

  return { dashboard, request, rules: () => rules };
}

const DemoSmsRulesContext = createContext<ReturnType<typeof createDemoSmsRules> | null>(null);
export const useDemoSmsRules = () => useContext(DemoSmsRulesContext);

export function DemoSmsRulesProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createDemoSmsRules);
  return <DemoSmsRulesContext.Provider value={store}>{children}</DemoSmsRulesContext.Provider>;
}

export function DemoSmsManagement() {
  const { basePath, portfolio } = useDashboard();
  const store = useDemoSmsRules()!;
  const request = useCallback(async <T,>(path: string, method?: string, body?: unknown): Promise<T> =>
    store.request(portfolio, path, method, body) as T, [store, portfolio]);
  return <SmsManagement demo initial={store.dashboard(portfolio)} request={request} propertiesHref={`${basePath}/properties`}
    back={<DashboardBackLink target={sectionTarget(basePath, 'profile')} className="fr-dashboard-back fr-profile-back" />} />;
}
