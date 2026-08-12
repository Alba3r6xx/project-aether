-- Migration 0009: Update comfort_status constraint to match firmware
--
-- The firmware uses GOOD/FAIR/POOR/HAZARD (CO2 ppm based), not the old
-- OPTIMAL/FAIR/POOR (0-100 percentage based). This updates the CHECK
-- constraint so the bridge and Edge Function can insert the correct values.

-- Step 1: Drop the old constraint
ALTER TABLE sensor_readings
  DROP CONSTRAINT IF EXISTS sensor_readings_comfort_status_check;

-- Step 2: Map old values to new ones (OPTIMAL -> GOOD)
UPDATE sensor_readings SET comfort_status = 'GOOD' WHERE comfort_status = 'OPTIMAL';

-- Step 3: Add the new constraint
ALTER TABLE sensor_readings
  ADD CONSTRAINT sensor_readings_comfort_status_check
  CHECK (comfort_status IN ('GOOD', 'FAIR', 'POOR', 'HAZARD'));
