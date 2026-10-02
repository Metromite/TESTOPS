# V35.42 — LOGI driver schema compatibility

Fixed the LOGI failure:
`column driver_daily_divisions.driver_id does not exist`

The live Primary database now has a nullable `driver_id` UUID compatibility column on `public.driver_daily_divisions`, backfilled where `person_code/driver_code` matches Fleet `drivers.code/driver_code`, plus a trigger for future inserts/updates.

The LOGI Edge Function source also documents and normalizes the legacy mapping: `driver_daily_divisions.person_code` is the canonical identifier, while `driver_id` is accepted as a compatibility alias.
