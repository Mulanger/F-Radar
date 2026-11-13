# Implementation progress

The authoritative progress log is [`/IMPLEMENTATION_PROGRESS.md`](../IMPLEMENTATION_PROGRESS.md)
at the repository root.

| Phase | Owner | Status | Blockers |
|---|---|---|---|
| 0 – Repo/design inventory | Agent 1 | Done | – |
| 1 – Project infrastructure | Agent 1 + 2 | Done – PostgreSQL 16 + PostGIS 3.4 on the f-radar pod, migrations verified | Redis/BullMQ not provisioned (not needed yet) |
| 2 – Auth, organisations, properties | Agent 2 | Done on a Clerk **development** instance; deployed to https://f-radar.fr-2.instapods.app | Production Clerk instance (clerk.f-radar.se) needs DNS + domain on the pod |
| 2.5 – Geoapify maps & stabilization | Agent 2.5 | Done – Geoapify `positron` tiles live, regression verified, ready for Phase 3 | Tile referer restriction not enforced by provider (monitor usage) |
| 3 – Geo engine, public data & monitoring | Agent 3 | Done – 9 providers collected centrally, PostGIS matching, live SSE dashboard on f-radar | smhi_oceanography not implemented; SGU observed stations partial |
| 4 – SMS rules and simulated delivery | Agent 4 | Done — application 1cd74ae deployed to f-radar; 132 regression + 21 DB + 9 live tests pass | Real sending deliberately locked; future verification channel/account activation separate |

## Prognosfält och kommande dygn (2026-11-13)

SMHI-serier sparas som v2; v1 läses med null för nya fält. Informativa trösklar och fem rullande dygn dokumenteras i ADR 0004. Riskindex v1 och SMS-regler är oförändrade.

## MET Norway nowcast (2026-11-13)

Fixture och identifierat live-rökprov godkända lokalt: `npm run test:live -- -t "MET Norway nowcast"` (1 passed). CC BY 4.0; Data från MET Norway, bearbetad av FastighetsRadar. Villkor: https://api.met.no/doc/TermsOfService. Kontaktwebbadress bekräftad av ägaren: https://f-radar.se. Flaggan är false som standard, ingen produktionsaktivering. Cache och 304 verifieras i enhetstester; databasverifiering görs i slutsteget.
