ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS round_trip_distance_km numeric(8,2) NOT NULL DEFAULT 0
  CHECK (round_trip_distance_km >= 0 AND round_trip_distance_km <= 1000);

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS travel_cost_rate_yen_per_km numeric(8,2) NOT NULL DEFAULT 20
  CHECK (travel_cost_rate_yen_per_km >= 0 AND travel_cost_rate_yen_per_km <= 10000);
