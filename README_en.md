<div align="center">

# Lumin Pro

[中文简体](https://github.com/YuleBest/LuminPro/blob/main/README.md)  丨  English

Enable your Android device to display content at boosted brightness anytime

</div>

## Module Introduction
This module aims to allow your Android device to utilize boosted brightness for screen content display at any time. Regardless of the current brightness level, the module will automatically elevate screen brightness to its maximum state when configured conditions are met, ensuring clear visibility in all scenarios.

## Features
- **Customizable Brightness Parameters**
Configure via `CONFIG.prop`:
- `custom_thr_bri`: Custom threshold brightness (optional, defaults to measured `FDBRI`). Triggers brightness boost when current brightness matches this value.
- `custom_max_bri`: Custom maximum brightness (optional, defaults to measured `MAXBRI`). Ensures optimal screen clarity.

- **Smooth Brightness Transition**
Two brightness boost modes:
- **Mode 1**: Instant boost from threshold to maximum brightness for urgent scenarios.
- **Mode 2**: Step-by-step brightness increase for smoother visual transitions.

- **Dynamic Parameter Updates**
Configuration reloads automatically before each loop cycle. Real-time parameter adjustments take effect without rebooting.

- **Sleep Time Rules**
Configure `sleep_start` and `sleep_stop` to disable automatic brightness adjustments during specified nighttime/quiet hours.

- **Logging & Management**
Detailed operation logs with automatic archiving. Maintains log size limits and manages archive files for efficient troubleshooting.

## Workflow
1. **Initialization**
   - Load custom/default parameters (e.g., `FDBRI`, `MAXBRI`).
   - Initialize log files and module descriptors.

2. **Configuration Update (`CONFIG_UPDATE`)**
   - Reload `CONFIG.prop` before each cycle.
   - Validate parameters; revert to defaults if invalid.
   - Adjust critical parameters (`boost_wait_time`, `flash_wait_time`, `bri_update_mode`).

3. **Brightness Adjustment Algorithm**
   - Compare current brightness with threshold.
   - Apply direct/stepwise boost based on configuration.

4. **Brightness Check (`BRI_CHECK`)**
   - Detect if current brightness falls below threshold.
   - Honor sleep time rules before boosting.

5. **Main Loop**
   - Wait `boost_wait_time` after startup, then periodically check brightness.
   - Execute brightness boost when conditions are met (outside sleep hours).

6. **Log Management (`log_cleaner`)**
   - Archive logs exceeding 100,000 bytes.
   - Retain up to 5 archived logs; auto-delete oldest files.

## Configuration
Edit `CONFIG.prop` in the module directory:

- `custom_thr_bri`: Brightness threshold for triggering boost.
- `custom_max_bri`: Target maximum brightness.
- `boost_wait_time`: Delay (seconds) before initial brightness check.
- `flash_wait_time`: Interval (seconds) between brightness checks.
- `bri_update_mode`: `1` (instant boost) or `2` (stepwise boost).
- `step_num`: Number of steps for Mode 2.
- `sleep_start`/`sleep_stop`: Quiet hours in 24h format (e.g., `23-7`).

## Installation
1. Install the module.
2. Reboot device to activate.
3. Edit `CONFIG.prop` as needed – changes apply automatically in the next cycle.

## Notes
- Ensure parameter values are reasonable to avoid abnormal screen behavior.
- Check `service.log` for troubleshooting or run `feedback.sh` for support.