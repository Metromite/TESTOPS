# DispatchOPS V13.6.40 deployment note

Cloudflare Pages/Workers should use the `frontend` directory as the build root.

Build command: `npm run build`
Output directory: `dist`

This release intentionally does NOT include a package-lock.json because the previous generated lockfile was incomplete and caused `npm ci`/`npm clean-install` to fail with missing dependency entries.

With no lockfile, the Cloudflare npm environment should resolve dependencies from `frontend/package.json` using npm install behavior. Do not add a hand-written or partial package-lock.json.
