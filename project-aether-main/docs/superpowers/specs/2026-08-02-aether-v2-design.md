# Aether v2 — Multi-Tenant Product Design

Date: 2026-08-02

## Purpose

Turn Project Aether from a single-owner demo into a product multiple customers can buy,
set up themselves, and control from their own dashboard. Three capabilities are missing
today and this design adds them: trustworthy air-quality numbers, a device that is
pleasant and safe to live with, and two-way communication between dashboard and device.

## Current state

The system is strictly one-way:

```
ESP32 -> HiveMQ -> ingest-mqtt -> Supabase -> Realtime -> Dashboard
```

Verified gaps in the existing code:

- Firmware never calls `mqttClient.subscribe()` or `setCallback()` — no downlink exists.
- No `Preferences`/NVS/EEPROM usage — nothing survives a reboot except compiled constants.
- WiFi credentials are hardcoded in `secrets.h`; changing network requires reflashing.
- No `configTime`/NTP — the device does not know the wall-clock time.
- No GPIO output code at all; GPIO23 is free and conflicts with nothing.
- `nodes` is already org-scoped with RLS, but holds only metadata (name, room, floor).
- No per-device settings table exists.
- `alert_rules` exists in the database but has no dashboard UI whatsoever.

## Hardware correction

The MQ-135 heater runs at 5V while the ESP32 ADC tolerates 3.3V. A 2x10kΩ divider now
sits between AOUT and GPIO34, so the ADC sees half the real output. The divider also
loads the sensor in parallel with the board's own load resistor:

- `V_AOUT = MQ135_DIVIDER_RATIO * V_ADC` (ratio = 2.0)
- `RL_eff = RL_onboard || (R1 + R2)` = `10k || 20k` = 6.67kΩ
- `Rs = (VCC - V_AOUT) * RL_eff / V_AOUT`

Temperature/humidity compensation and R0 auto-calibration from v1 are retained. All
constants are named `#define`s so the divider can be re-specced without touching logic.

## Components

### Firmware: config store

A single `DeviceConfig` struct persisted to NVS via `Preferences`. Fields: CO2 warn and
hazard thresholds, buzzer enabled, quiet-hours start/end, timezone offset, display page
dwell time, and up to three WiFi credential pairs. Every field is range-validated on load
and on downlink before being applied; invalid values fall back to the compiled default
rather than propagating.

### Firmware: WiFi provisioning

On boot the device tries each saved network in order for 20 seconds total. If none
connect it starts SoftAP `Aether-Setup-<id>` with a `DNSServer` catch-all and a
`WebServer` serving a network picker. Submitting credentials writes them to NVS and
reboots. The portal self-terminates after 5 minutes and retries normal boot, so a router
outage cannot strand a deployed device in setup mode. Uses only ESP32 core libraries
(`WebServer.h`, `DNSServer.h`) — no third-party dependency to install.

Dashboard-managed networks are additive backups for an already-online device. First-time
setup and post-move recovery must use the portal, because an offline device cannot receive
a downlink.

### Firmware: time

`configTime()` against `pool.ntp.org` with the offset taken from config. The header clock
renders `--:--` until the first successful sync so a failed sync never shows a wrong time.

### Firmware: buzzer

GPIO23 driven with LEDC PWM tone, which drives passive buzzers correctly and active ones
acceptably. A non-blocking pattern player advances off `millis()` so the task watchdog is
never starved. Patterns: boot confirm (two short), warning chirp (one, rate-limited to
once a minute), hazard (urgent repeating triple). Quiet hours suppress warnings only —
hazard always sounds. If config is unreadable the buzzer defaults to **enabled**, because
a silently muted alarm is the dangerous failure mode.

### Firmware: MQTT downlink

Subscribes to `aether/<node_id>/config`. On message: parse, validate, apply, persist,
then publish the full effective config to `aether/<node_id>/state` so the dashboard shows
confirmed device state rather than assumed state. Malformed payloads are logged and
dropped without partial application.

### Supabase: device_settings

One row per node, `org_id`-scoped, mirroring the firmware config fields. RLS: members of
the owning org may read; only owner/admin may write; no client may write to other orgs.
Added to the `supabase_realtime` publication so the dashboard reflects state changes live.

### Supabase: publish-config

Edge Function that reads a node's `device_settings`, verifies the caller belongs to the
owning org, and publishes the config JSON to `aether/<node_id>/config`. This is the only
component permitted to publish downlink, keeping the "one writer" principle intact.

### Dashboard

Per-device settings page: thresholds, buzzer toggle, quiet hours, timezone, backup WiFi
entry, with a device switcher for multi-node customers. An alert-rules editor, since rules
are currently unreachable from the UI. Both write to Supabase and then invoke
`publish-config` for the settings that the device needs to know about.

## Data flow

```
uplink    ESP32 -> aether/<id>/telemetry -> ingest-mqtt -> sensor_readings -> Realtime -> UI
state     ESP32 -> aether/<id>/state     -> ingest-mqtt -> device_settings.reported
downlink  UI -> device_settings -> publish-config -> aether/<id>/config -> ESP32 -> NVS
```

## Error handling

- Config validation at both ends; out-of-range values rejected, never clamped silently.
- Buzzer fails safe to on.
- Captive portal times out rather than persisting.
- NTP failure shows placeholder, never a wrong clock.
- Downlink parse failure logs and drops; device keeps last known good config.

## Testing

- Unit-test the ppm conversion against known ADC/temp/humidity triples.
- Unit-test config validation rejects out-of-range values on both firmware and server.
- Manually verify: portal appears with no saved network; downlink threshold change is
  reflected on the OLED within one publish cycle and survives a power cycle.

## Out of scope

Certified life-safety alarming. The MQ-135 is an approximate resistive sensor; absolute
ppm accuracy requires an NDIR sensor such as the SCD41. This design improves honesty of
the numbers, not their certification.
