# Picard setup cockpit concept

A local-only first visit to Picard, using the actual console's 3D insignia,
starfield, navigation materials, curved HUD and translucent reading panels.
Setup replaces operational instruments until the visitor has a relay of their own.

With Node.js 24, run from the repository root:

```sh
node examples/landing/build-assets.mjs
npm run preview:landing
```

Open the printed loopback address. Stop with Ctrl+C. No dependencies, provider
key, external font, tracking, AI call or cloud resource is needed.

**Server → Install → Connect** opens the real fresh-host setup instructions in
HUD panels. Product navigation explains the existing working areas. Examples
are labeled and there are no invented live jobs, CPU readings or earned ranks.
Selecting a setup step is navigation, never proof that installation succeeded.

**Enter my relay** validates a plain HTTPS origin and navigates directly to its
Overview. It sends no key, password, setup progress or authentication state.
Owner setup/sign-in happens on that relay. No cross-origin probes or automatic
installation occur. HTTP, embedded credentials, paths, queries and fragments
are rejected. Existing relay updates remain separate from fresh installation.

Panels expand/retract from their source control, switch in sequence, and close
with the source control, Close, Escape, or a click in space. Stars and motion
have separate controls. The short insignia arrival never blocks input. Reduced
motion uses the static state; without JavaScript the setup guide remains available.

## Reuse and scope

- `build-assets.mjs` derives CSS, insignia and SVG star planes from the current
  exported `CONSOLE_HTML`. It does not copy its API or authentication scripts.
- The curvature calculation follows the same quadratic curve as the product.
- Only landing behavior and setup content are new. Generated `console.css` and
  `console-parts.json` are rebuilt after upstream console changes.
- The loopback preview server serves six exact public asset paths and GET/HEAD
  only, with no directory browsing, relay endpoints or external connections.
- This is a reviewable onboarding concept, not a hosted site or finished cloud
  provisioning service. Actual server setup still uses the existing reviewed
  installer and the user's own Oracle/hosting account.
- Public URL/hosting and whether to embed this welcome mode in a future signed
  runtime remain decisions for Brian. No production site or working relay changes.
