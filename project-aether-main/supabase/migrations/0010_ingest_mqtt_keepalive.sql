-- ---------------------------------------------------------------------------
-- 0010: Cron job to keep the ingest-mqtt Edge Function alive
--
-- PROBLEM: Supabase Edge Functions have a wall-clock execution limit.
-- The ingest-mqtt function connects to the MQTT broker and subscribes to
-- aether/+/telemetry, but Supabase kills the function instance after the
-- timeout. The MQTT subscription dies and no readings are ingested.
--
-- SOLUTION: Schedule a pg_cron job that calls the ingest-mqtt Edge Function
-- every 2 minutes. Each invocation reconnects to the broker and stays alive
-- for the duration of the function's execution window, so readings are
-- continuously ingested.
-- ---------------------------------------------------------------------------

-- Remove existing job if it was created in a previous run, then insert.
delete from cron.job where jobname = 'ingest-mqtt-keepalive';

insert into cron.job (jobname, schedule, command)
values (
  'ingest-mqtt-keepalive',
  '*/2 * * * *',
  $$
    select net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/ingest-mqtt',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
