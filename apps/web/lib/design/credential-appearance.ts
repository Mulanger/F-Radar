/** Styles scoped to the public sign-in and sign-up surfaces. Clerk owns the flow and fields. */
export const credentialAppearance = {
  elements: {
    rootBox: { display: 'block', width: '100%', minWidth: 0 },
    cardBox: { width: '100%', maxWidth: 'none', border: '0', boxShadow: 'none', borderRadius: 0, background: 'transparent' },
    card: { width: '100%', maxWidth: 'none', padding: 0, border: '0', boxShadow: 'none', borderRadius: 0, background: 'transparent' },
    header: { alignItems: 'flex-start', textAlign: 'left', gap: '10px' },
    headerTitle: { fontSize: 'var(--credential-title-size)', fontWeight: 550, letterSpacing: '-.045em', lineHeight: 1.06 },
    headerSubtitle: { fontSize: 14, lineHeight: 1.5, color: '#53616a' },
    footer: { background: 'transparent' },
    footerAction: { paddingTop: '16px', gap: '4px' },
    footerActionText: { color: '#53616a' },
    footerActionLink: { color: '#244c5e', fontWeight: 600, '&:hover': { textDecoration: 'underline' } },
    formFieldLabel: { fontSize: 14, fontWeight: 550 },
    formFieldInput: { minHeight: 50, borderRadius: 14, paddingInline: 14, fontSize: 16, borderColor: '#c6d0d4', '&:focus-visible': { outline: '2px solid #397589', outlineOffset: '1px' } },
    formButtonPrimary: { minHeight: 50, borderRadius: 26, background: '#14171a', fontSize: 15, fontWeight: 550, boxShadow: 'none' },
    formFieldErrorText: { fontSize: 13 },
  },
} as const;
