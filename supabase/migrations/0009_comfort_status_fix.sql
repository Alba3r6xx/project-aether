-- Migration 0009: Update comfort_status constraint to match firmware
--
-- The firmware uses GOOD/FAIR/POOR/HAZARD (CO2 ppm based), not the old
-- OPTIMAL/FAIR/POOR (0-100 percentage based). This updates the CHECK
-- constraint so the bridge and Edge Function can insert the correct values.

ALTER TABLE sensor_readings
  DROP CONSTRAINT IF EXISTS sensor_readings_comfort_status_check;

ALTER TABLE sensor_readings
  ADD CONSTRAINT sensor_readings_comfort_status_check
  CHECK (comfort_status IN ('GOOD', 'FAIR', 'POOR', 'HAZARD'));

-- Also update the alerts table if it has a similar constraint
ALTER TABLE alerts
  DROP CONSTRAINT IF EXISTS alerts_severity_check;

ALTER TABLE alerts
  ADD CONSTRAINT alerts_severity_check
  CHECK (severity IN ('GOOD', 'FAIR', 'POOR', 'HAZARD', 'INFO', 'WARNING', 'CRITICAL'));
