# Department Entry Link V35.27

- Added standalone `department-entry/` Vite app for Pharma / Medical / Consumer.
- Added shared `public.department_dispatch_entries` table with RLS, 16:30 Asia/Dubai cutoff trigger, tomorrow-or-later validation, pallet sum validation and Realtime publication.
- Bulk Organizer now reads department entries for the selected target date and updates through Supabase Realtime.
- Medical entries feed the Pharma division; Consumer entries feed Consumer.
- Added big/small pallet fields to department entries and vehicle capacity editor in Bulk Organizer.
- Fixed the Add Another Invoice batch layout so each additional invoice uses the same clean field grid instead of the compressed overlapping row.
