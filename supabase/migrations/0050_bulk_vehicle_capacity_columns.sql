-- Bulk Organizer: authoritative vehicle capacity fields
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS capacity_tons numeric DEFAULT 0;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS pallet_capacity integer DEFAULT 0;
NOTIFY pgrst, 'reload schema';
