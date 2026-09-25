-- Vehicle pallet capacity model v2
-- Store ONLY the vehicle capacity in BIG-pallet-equivalent units.
-- 1 big pallet = 1.0 capacity unit.
-- 1 small pallet = 2/3 capacity unit (1 big = 1.5 small).

-- Preserve the previous BIG capacity as the canonical pallet_capacity value.
UPDATE public.vehicles
SET pallet_capacity = COALESCE(big_pallet_capacity, pallet_capacity);

-- The split vehicle-capacity fields are obsolete in the new model.
ALTER TABLE public.vehicles DROP COLUMN IF EXISTS big_pallet_capacity;
ALTER TABLE public.vehicles DROP COLUMN IF EXISTS small_pallet_capacity;

NOTIFY pgrst, 'reload schema';
