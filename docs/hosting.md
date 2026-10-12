# Hosting

GitHub Pages serves `public/r/` as the site root at `https://shadcn.bje.co`, so each style's
`registry.json` and `<item>.json` sit at `/<style>/`, with the style's showcase page as its
`index.html` (`https://shadcn.bje.co/vega/`). The root serves an index page with a card linking to
each style's showcase (`ab/site.tsx`).

The CI `deploy` job publishes on every push to `main`, once `build`, `vitest`, `types`, `biome` and
`ab` pass. It deploys the `build` job's `public/r/` artifact, then fetches each style's
`registry.json` and `/<style>/` from the site, then `/`, and fails unless every style serves a
non-empty `bje` registry and a showcase page for that style, and the root serves the index page.

Outside this repository:

- **DNS:** Cloudflare `CNAME` `shadcn` to `bje-settings.github.io`, DNS only (not proxied), so
  GitHub can issue and renew the certificate.
- **Domain verification:** `bje.co` is verified for the `bje-settings` org (a TXT record in
  Cloudflare), which prevents subdomain takeover.
- **Pages settings**, applied with the API:

  ```bash
  gh api -X POST repos/bje-settings/shadcn/pages -f build_type=workflow             # publish from Actions
  gh api -X PUT repos/bje-settings/shadcn/pages -f cname=shadcn.bje.co -F public=true # custom domain, public site
  gh api -X PUT repos/bje-settings/shadcn/pages -F https_enforced=true               # once the certificate is issued
  ```
