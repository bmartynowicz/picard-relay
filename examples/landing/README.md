# Picard setup cockpit

A first visit to Picard, using the actual console's 3D insignia,
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

## Interactive guide candidate

**Guides** and **Try the workflow** open a local Request → Review → Saved answer
lesson. The fixed sample and answer are labeled as practice; no provider call,
key, browser storage or relay connection is used. The answer stays available
when a panel closes or another view opens, until the visitor explicitly starts
again or reloads. **Text guide** opens the existing quickstart alongside it.

This lesson does not enable a public AI endpoint. A real public trial needs a
separate owner-approved, server-enforced allowance and public-only result scope;
the private owner workspace and exact-request approval remain protected.

## Reuse and scope

- `build-assets.mjs` derives CSS, insignia and SVG star planes from the current
  exported `CONSOLE_HTML`. It does not copy its API or authentication scripts.
- The curvature calculation follows the same quadratic curve as the product.
- Only landing behavior and setup content are new. Generated `console.css` and
  `console-parts.json` are rebuilt after upstream console changes.
- The loopback preview server serves seven exact public asset paths and GET/HEAD
  only, with no directory browsing, relay endpoints or external connections.
- Actual server setup still uses the existing reviewed installer and the user's
  own Oracle/hosting account. This page does not provision cloud resources.
- Embedding this welcome mode in a future signed runtime remains separate work.
  Publishing the static site does not update a working relay.

## Public V1 on GitHub Pages

The public site uses GitHub Pages for this public repository, separate from any
relay VM. It needs no running server, provider key, dependency installation or
paid service. The dedicated `gh-pages` branch contains only built public assets;
the repository's source, docs, runtime and private operator files are excluded.

Build an empty output directory from the merged source, passing its exact SHA:

```sh
npm run test:landing
npm run build:landing -- dist/landing FULL_MERGED_SOURCE_SHA
```

The builder composes the existing mark/starfield, makes assets relative for
`/picard-relay/`, uses `.js` for the small navigation module, removes the local
preview label, and adds static CSP/referrer policies. `build.json` records the
source SHA and SHA-256 of every public payload. It refuses nonempty output.

`social-preview.png` is a 1280×640 capture of the public welcome cockpit,
not an owner workspace. The canonical, Open Graph and large-image card metadata
use the public Pages address. The image is only referenced in metadata; normal
visits do not download it. Keep it below 1 MB for GitHub's repository preview,
upload the same file in the repository's Social preview setting, and verify the
published image and metadata after rebuilding. No tracking or external assets
are added.

Publish only that directory to the dedicated Pages branch and configure Pages
to serve its root. `.nojekyll` preserves the built files. Verify the HTTPS page,
all asset types/hashes, setup panels, reduced motion and entry into an existing
relay after each publication. A source merge does not itself update the site.
