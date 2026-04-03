<div align="center">

# LuminPro

[中文简体](https://github.com/YuleBest/LuminPro/blob/main/README.md)  丨  English

Enable your Android device to display content at boosted brightness anytime
*Based on KernelSU WebUI + Event-Driven Architecture*

</div>

## Module Introduction
This module allows your Android device to constantly utilize boosted brightness for screen content display. When manually adjusting brightness over a designated threshold limit, the module automatically and smoothly elevates the screen brightness parameter to its maximum hardware-driven state, ensuring clear readability even in strong outdoor daylight.

## V2.1 Core Features

- **Zero Drain Background Monitoring (inotifyd)**  
  Say goodbye to infinite loops and heavy active polling overhead. LuminPro natively utilizes an event-driven `inotifyd` listener to respond *only* when the brightness sysfs node alters, fundamentally preserving your device's overall battery life.

- **Modernized KernelSU WebUI**  
  No more manual text editing in generic config files! Simply tap the module settings inside your KernelSU manager to seamlessly adjust options directly in a tailored Dark Mode interface:
  - `Foreground Max Brightness`: The original UI threshold dragging point that initiates the brightness boost.
  - `Peak Maximum Brightness`: The extreme and ultimate targeted hardware brightness your screen will soar to.

- **Smooth Step Transitions**  
  Abrupt, rigid jumps in brightness ruin visual coherence. LuminPro operates via an embedded millisecond-level, 50-step computation curve that scales backlight inputs naturally and sequentially.

- **Sleep & Quiet Hours**  
  You do not need a blinding torch in bed. Tweak quiet night hours (e.g., `1900-0600`) locally via the WebUI. During your configured timeframe, the module enters a silent hibernation ensuring your retinas and sleep remain undisturbed.

- **Live Status & Direct Logs Dashboard**  
  Capture crucial runtime performance status at a glance. Attain realtime active backlight parameters, executing daemon service PIDs, and direct service logs dynamically straight from the integrated UI.

## Operations Workflow
1. **Initial Calibration Setup**  
   - Employs minimal physical volume-key prompts during ZIP installation to read and memorize your device’s specific maximum limitations. Users upgrading smoothly bypass calibration logic if previous files are preserved.
2. **Event Tracking Mode**  
   - Submits a background `inotifyd` observer attaching safely without looping variables toward the standard Android illumination logic path. 
3. **Debounce Optimization Engine**  
   - Interacting with display slider changes will safely debounce over sub-second timers, avoiding computational race-conditions. It acknowledges exactly where your sliding ends prior to activating iterative hardware boosts.

## Quick Installation Instructions
1. Flash the packaged module ZIP directly through any framework manager backing WebUI specification features.
2. Walk through standard volume physical key verification presses (you may easily skip recalibrations extending old module environments by just pressing Volume+).
3. Soft reboot to engage operations.
4. If parameters or constraints require tweaking, manipulate values across the internal interface view. All operations are **persisted instantly**.

## Vital Precautions
- **OLED Burn-in & Escalated Thermal Warning**: Persistently overriding and enforcing intensive display peak loads aggressively drives heat emissions up. Doing so vastly skyrockets irreversible UI ghosting & OLED burn-in permanent issues respectively.
- Verify entered tuning numbers remain securely governed matching acceptable values on your manufacturer's specific screen limit boundaries to avert hardware blackout glitches.
- Acknowledge inherent hazards prior to extended utilization. If irregular phenomena transpire, inspect native system output records over the built-in front-end log pane.