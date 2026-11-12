/**
 * Clerk component theming mapped to the approved FastighetsRadar design tokens
 * (ink #14171A, page #F3F4F2, Geist, rounded 14–26 px surfaces, soft shadows).
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: '#14171A',
    colorText: '#14171A',
    colorTextSecondary: '#6B737B',
    colorBackground: '#FFFFFF',
    colorInputBackground: '#FFFFFF',
    colorInputText: '#14171A',
    colorDanger: 'oklch(0.57 0.19 27)',
    colorSuccess: 'oklch(0.55 0.12 155)',
    colorNeutral: '#14171A',
    fontFamily: "var(--font-geist-sans), 'Geist', system-ui, sans-serif",
    borderRadius: '14px',
    fontSize: '14px',
  },
  elements: {
    cardBox: { boxShadow: '0 1px 2px rgba(20,23,26,0.03),0 24px 60px -24px rgba(20,23,26,0.25)', borderRadius: 26, border: '1px solid rgba(20,23,26,0.05)' },
    card: { borderRadius: 26 },
    formButtonPrimary: { background: '#14171A', borderRadius: 22, height: 44, fontWeight: 500, boxShadow: 'none' },
    socialButtonsBlockButton: { borderRadius: 14 },
    formFieldInput: { borderRadius: 14, height: 44 },
    organizationSwitcherTrigger: { borderRadius: 22, padding: '6px 12px' },
    userButtonAvatarBox: { width: 36, height: 36 },
  },
} as const;
