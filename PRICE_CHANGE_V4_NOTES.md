# DispatchOPS Price Change V4

- Added Price Change / Repricing page to the DispatchOPS admin navigation.
- Added Excel download and Excel import for price-change item lists.
- Added driver assignment UI, customer/location control, item/price management and submission table.
- Driver portal is configured to use the Secondary Supabase project (`vyqyrcqrdsyrxywglqbh`) so new Price Change data does not consume the Primary database.
- Driver portal submission rules: customer name + location + pharmacist required; pharmacy/place photo required; either at least one positive item quantity OR explicit No Stock; server timestamp remains authoritative.
- Added NO_STOCK support to the Primary database and full driver submission validation.
- Added the same Price Change schema and driver portal authentication foundation to Secondary.
- Secondary evidence upload Edge Function is deployed as `dispatchops-price-change-upload`.
- Location Extension source is separately updated to avoid guessing a branch from customer name alone when the cloud has multiple canonical areas.

Native Tauri EXE was not rebuilt in this environment; this ZIP is the latest source package for building/installing the desktop app.
