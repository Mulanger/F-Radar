# Future 46elks activation — separate approval and reviewed release required

This is a future checklist, not authorization. Phase 4 must remain simulated with zero real spend.

1. Owner opens the 46elks account independently and approves the intended pricing/account currency,
   credits/payment method and sender ID. Do not purchase or activate anything automatically.
2. Complete source licensing/alert-reuse and privacy/consent/processor policy reviews documented in
   `notifications.md`. Agree incident handling, deletion/export and retention including backups.
3. Implement/approve an actual phone-possession verification transport. Keep fake verification out of
   production. Decide whether server-verified matching Clerk evidence can satisfy product policy.
4. Add server-only provider credentials through approved secret management. Keep `SMS_ENABLED=false`,
   `SMS_PROVIDER=simulated`, `SMS_DRY_RUN=true`, approval false and all real budgets zero initially.
5. With separate approval, exercise `FortySixElksSmsProvider` in **provider dry-run only**, using valid
   credentials; validate reported parts, estimated cost, currency, sender and Unicode behavior. Mock
   contract tests do not replace this account-backed verification. Do not send an OTP during this step.
6. Configure a ≥32-character random callback credential. Future callback URL may use HTTPS Basic Auth
   (`elks` plus credential). Verify ingress authentication, form validation, duplicate/out-of-order
   callbacks and operator reconciliation for unknown/contradictory outcomes. Never log credential URLs.
7. In a reviewed activation release, remove the explicit `phase4_live_lock`, add an explicitly selected
   real worker transport, connect authenticated callbacks, and enforce all live checks immediately
   before the request: production selection, both credentials, owner approval, verified current phone
   evidence, consent, enabled rule, current source eligibility, quotas and atomic budget reservation.
8. Wire actual provider costs into the existing durable accounting and provider-ID reconciliation.
   Keep accepted/timeouts/unknown reservations until reconciled. Never auto-retry uncertain sends.
   Verify global daily/monthly and organization monthly real allowances against the real ledger;
   fail closed on missing accounting or unknown price. Simulator reservations are not a live billing ledger.
9. Set reviewed positive limits and per-part estimate only with owner approval. Require explicit
   `SMS_PROVIDER=46elks`, `SMS_ENABLED=true`, `SMS_DRY_RUN=false`,
   `SMS_LIVE_SENDING_APPROVED=true`, positive global monthly/daily budgets and org monthly allowance.
   Credentials alone must remain insufficient. Add the staged allowlist gate before first paid tests.
10. Run account-backed dry-run, integration, tenant, callback, restart, budget and unknown-outcome tests.
    Obtain explicit approval for a narrowly bounded first real send to a verified opted-in recipient.
11. Update the deployment script's forced simulation policy only in that approved activation release.
    Keep the existing `f-radar` pod/plan; custom DNS and Clerk Production remain separate projects.
12. Record actual outcome/cost, retain rollback, watch meaningful errors, and restore disabled flags if
    any verification/accounting/callback check fails. Disabling must stop new claims immediately.
