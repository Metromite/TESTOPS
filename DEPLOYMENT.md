# DispatchOPS Cloudflare deployment

## Build root
Set the Cloudflare Pages / Workers build root to `frontend`.

## Install
This release includes `frontend/package-lock.json` so Cloudflare can use its normal `npm ci` / `npm clean-install` dependency step.

## Build command
`npm run build`

## Output directory
`dist`

## Important
Do not use the old root-level placeholder `package-lock.json`; this release intentionally keeps the lockfile beside `frontend/package.json`, which is the configured build root.
