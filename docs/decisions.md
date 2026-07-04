# Architecture decisions & divergences log

Mirrors `tangram_docs/Tangram_Learning_Notes.md`, minus interview framing. Grows per slice.

## Slice 1

- **.NET 10** used instead of the originally planned .NET 8 LTS, per explicit
  direction to use the latest version. No functional impact — same ASP.NET Core /
  EF Core / SignalR APIs used throughout.
- **Theme scope narrowed to Terracotta only.** The design brief called for 5
  candidate themes; the actual Claude Design export only had Terracotta's exact
  token values finalized. Rather than guess at colors for Sandstone/Moss/Amber/Clay
  Rose, the token architecture (CSS custom properties → Tailwind `@theme`, keyed by
  `[data-theme][data-mode]`) was built to support more themes as a drop-in later,
  but only Terracotta (light + dark) is populated now.
- **Card creation is reachable via both REST and the SignalR hub**, sharing one
  `ICardOperationService` that does the actual seq-assign/persist/log/broadcast
  pipeline. The frontend only calls the REST endpoint and relies on the hub's
  group broadcast (which includes the creator's own tab) to update state — this
  keeps "who applied it locally vs. who's reconciling a broadcast" a non-issue
  for Slice 1, since there's no optimistic UI yet (that's Slice 2).
- **PostgreSQL and the .NET SDK were not present on this machine** and were
  installed as part of this slice (PostgreSQL 17 native install, .NET 10 SDK via
  winget) rather than using Docker, since Docker Desktop wasn't running locally.
