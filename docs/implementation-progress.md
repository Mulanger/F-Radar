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
