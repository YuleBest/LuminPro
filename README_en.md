<div align="center">

# LuminPro

[中文简体](https://github.com/YuleBest/LuminPro/blob/main/README.md) 丨 **English**

Break past the Android foreground brightness cap and push your screen to its hardware peak — anytime  
_Powered by KernelSU WebUI + Go Event-Driven Architecture_

</div>

## Overview

LuminPro monitors the system brightness sysfs node via a Go-native resident daemon (`luminpro`). Whenever the current brightness exceeds a configured threshold, it smoothly ramps the display up to the hardware maximum — ideal for outdoor readability. The daemon owns listening, decision-making, ramping and state files in a single process, and the full KernelSU WebUI lets you tune every parameter without a reboot.

## V2.3 Core Features

- **Zero-Overhead Event Listener (luminpro)**  
  No polling loops, no background spin. The Go daemon (`luminpro`) watches the brightness node with raw inotify, responds only when the file actually changes, and includes a 300ms debounce plus event draining. It self-heals: a lost watch is rebuilt automatically and stale locks are reclaimed.

- **KernelSU WebUI Configuration**  
  Adjust all settings visually inside the module's settings page. Changes take effect **immediately** — no reboot required:
  - `Foreground Max Brightness` — UI brightness threshold that triggers a boost
  - `Peak Max Brightness` — hardware brightness value to ramp up to
  - `Transition Steps` — number of steps for smooth ramping (default: 50)
  - `Sleep Hours` — time range to suppress boosts (e.g. `2200-0700`)
  - `Log Level` — control log verbosity (off / error / warn / info)
  - `Brightness / Max-Brightness node paths` — custom sysfs paths for non-standard devices
  - `inotify Event Types` — which events the daemon should watch

- **Smooth Step Transition**  
  Millisecond-level 50-step interpolation prevents jarring brightness jumps. The step count is configurable.

- **Smart Skip Logic**  
  The module automatically skips boosting when:
  - System adaptive brightness is active
  - HDR content is detected on screen (configurable)
  - The foreground app is on the blacklist
  - The current time falls within the configured sleep range

- **App Blacklist**  
  Manage a package / Activity blacklist directly in the WebUI "Apps" tab. Search by package name, pick specific activities using the built-in Activity scanner, and the module stays hands-off whenever a blacklisted app is in the foreground.

- **Instant Peak Boost (boost.sh)**  
  Trigger a one-shot peak brightness via the manager's Action button or `action.sh`. A second tap restores the original brightness.

- **Live Status & Log Dashboard**  
  The WebUI status page shows real-time brightness, the daemon PID, and service state. The log page supports level filtering (`INFO` / `WARN` / `ERROR`) and lets you copy or export logs to `/sdcard` with one tap.

## Configuration Reference

| Key                 | Description                             | Default                    |
| ------------------- | --------------------------------------- | -------------------------- |
| `ui_max_bri`        | Foreground brightness trigger threshold | `0` (requires calibration) |
| `max_bri`           | Target peak brightness value            | `0` (requires calibration) |
| `steps_num`         | Ramp transition steps                   | `50`                       |
| `sleep_time`        | Sleep range, format `HHMM-HHMM`         | empty (disabled)           |
| `auto_bri_sleep`    | Skip when adaptive brightness is on     | `1` (enabled)              |
| `display_hdr_sleep` | Skip during HDR playback                | `0` (disabled)             |
| `log_level`         | Log verbosity (off/error/warn/info)     | `info`                     |
| `log_max_size`      | Log file size cap (KB)                  | `512`                      |
| `now_bri_file`      | Current brightness sysfs node path      | standard panel0 path       |
| `max_bri_file`      | Max brightness sysfs node path          | standard panel0 path       |
| `blacklist_apps`    | Blacklisted packages / activities       | `[]`                       |
| `inotify_events`    | inotify event mask                      | `c`                        |

## Installation

1. Flash the module ZIP in any KernelSU-compatible manager that supports WebUI.
2. Follow the volume-key calibration wizard during installation. Press Volume Up to inherit an existing configuration and skip recalibration.
3. Reboot to activate.
4. Open the module settings page in your manager to adjust parameters. All changes are applied instantly on save.

## Warnings

> ⚠️ **OLED Burn-in & Thermal Warning**  
> Sustained peak brightness significantly accelerates OLED panel aging and burn-in, and substantially increases device heat output and power draw. Use responsibly and ensure all values stay within your hardware's safe operating range.

- Double-check that configured brightness values do not exceed your device's hardware limits.
- If issues occur, export the runtime log from the WebUI and include it when reporting to the community.
