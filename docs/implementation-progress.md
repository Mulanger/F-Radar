# Implementation progress

The authoritative progress log is [`/IMPLEMENTATION_PROGRESS.md`](../IMPLEMENTATION_PROGRESS.md)
at the repository root.

| Phase | Owner | Status | Blockers |
|---|---|---|---|
| 0 – Repo/design inventory | Agent 1 | Done | – |
| 1 – Project infrastructure | Agent 1 + 2 | Done – PostgreSQL 16 + PostGIS 3.4 on the f-radar pod, migrations verified | Redis/BullMQ not provisioned (not needed yet) |
| 2 – Auth, organisations, properties | Agent 2 | Done on a Clerk **development** instance; deployed to https://f-radar.fr-2.instapods.app | Production Clerk instance (clerk.f-radar.se) needs DNS + domain on the pod |
| 3 – Geo engine & data model | – | Partly (PostGIS, point storage, distance queries) | – |
| 4+ – Public data sources | – | Not started (Geoapify done; Trafikverket key present, disabled) | – |
