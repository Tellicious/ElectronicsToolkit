# Electronics Toolkit

A fully static Progressive Web App (PWA) hub for compact electronics utilities. It is designed for easy local hosting, offline-capable operation via a service worker, and mobile-friendly installs on iOS and other devices.

## Quick start — run locally

This project is fully static. Serve the project root over HTTP and open http://localhost:8000 in your browser. Example:

```bash
python3 -m http.server 8000
```

Notes:
- Service worker registration requires HTTPS or `localhost`.
- No build step is required; this repo is ready to serve as-is.

## Install on iOS

1. Host the site on HTTPS, or run locally on `localhost` during development.
2. Open the URL in Safari.
3. Tap **Share → Add to Home Screen**.

Behavior on iOS:
- The app launches full-screen and remains usable offline once the service worker caches the shell.
- iOS PWAs still have platform limitations such as background execution and cache quota.
- Camera access and `getUserMedia` work only in Safari/standalone contexts that support them.

## Deploy to GitHub Pages

1. Push changes to the `main` branch.
2. The workflow at `.github/workflows/deploy.yml` publishes the site via GitHub Actions.
3. In repository settings: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Available apps

The following tools are included in the hub, sorted alphabetically by app name:

- **AWG converter** (`awg-converter`) — converts between American Wire Gauge and metric wire diameters.
- **Battery life estimator** (`battery-life`) — estimates runtime based on battery capacity and device current draw.
- **Capacitor calculator** (`capacitor`) — converts capacitor units and computes reactance.
- **GPS logger / navigator** (`gps`) — logs location, speed, altitude, and heading with a map interface.
- **LED resistor helper** (`led-resistor`) — computes the series resistor needed for an LED based on supply voltage, Vf, and current.
- **Motion sensor utility** (`motion`) — displays accelerometer/motion sensor data for device movement monitoring.
- **Microphone meter** (`mic`) — sound level meter and spectrum analyzer using audio capture and FFT.
- **Number converter** (`number-converter`) — converts numbers between bases.
- **Op-amp gain helper** (`op-amp-gain`) — calculates amplifier gain for inverting and non-inverting op-amps.
- **Resistor colour-code decoder** (`resistor`) — decodes resistor bands.
- **Series/parallel calculator** (`series-parallel`) — computes equivalent resistance for resistor and capacitor networks.
- **SMD resistor lookup** (`smd-resistor`) — decodes surface-mount resistor markings to resistance values.
- **Time-signal generator** (`time-signal`) — generates audio time-signal waveforms for watch synchronization.
- **Tuner** (`tuner`) — chromatic tuner with harmonic pitch detection.
- **Voltage divider calculator** (`voltage-divider`) — computes output voltage for voltage divider designs.

## Project layout

```
index.html                          # Hub / app launcher with links to each sub-app
manifest.json                       # PWA manifest (app metadata, icons, display)
sw.js                               # Service worker (precache shell, runtime caching)
assets/
    ├─ app.js                       # Shared helpers, settings, and SW registration
    ├─ icons/                       # App and Apple-touch icons
    ├─ styles.css                   # Global tokens, variables, and hub styles
    ├─ sensorkit/                   # Shared charting, DSP, and UI components
    │  ├─ chart.js                  # Time-series chart with pan/zoom
    │  ├─ controls.js               # Play/stop/reset control bar component
    │  ├─ csv.js                    # CSV logger for data export
    │  ├─ fft.js                    # FFT with windowing and frequency weighting
    │  ├─ format.js                 # Formatting helpers (duration, numbers)
    │  ├─ kpi.js                    # Key performance indicator grid display
    │  ├─ liveplot.js               # Real-time waveform and spectrum plotter
    │  ├─ multiplot.js              # Multi-series plotting helper
    │  ├─ segmented.js              # Segmented control / tab UI helper
    │  └─ sensorkit.css             # Shared chart and control styles
    └─ vendor/
        └─ leaflet/                 # Leaflet mapping library (for GPS)
            ├─ leaflet.css
            ├─ leaflet.js
            └─ images/
apps/
    ├─ awg-converter/               # AWG ↔ mm wire gauge converter
    │  ├─ index.html                # AWG converter UI
    │  └─ awg-converter.js          # Conversion logic and helpers
    ├─ battery-life/                # Battery life / runtime estimator
    │  ├─ index.html                # Battery estimator UI
    │  └─ battery-life.js           # Runtime estimate calculations
    ├─ capacitor/                   # Capacitor unit conversions and reactance
    │  ├─ index.html                # Capacitor tool UI
    │  └─ capacitor.js              # Unit conversions and reactance formulas
    ├─ gps/                         # GPS data logger and navigator
    │  ├─ index.html                # GPS UI
    │  ├─ gps.css                   # GPS-specific styles
    │  └─ gps.js                    # Location tracking, speed, altitude, heading
    ├─ led-resistor/                # LED resistor value helper
    │  ├─ index.html                # LED helper UI
    │  └─ led-resistor.js           # Compute resistor from Vf and desired current
    ├─ motion/                      # Motion sensor / accelerometer utility
    │  ├─ index.html                # Motion sensor UI
    │  ├─ motion.css                # Motion UI styles
    │  └─ motion.js                 # Motion sensor capture and display
    ├─ mic/                         # Sound level meter and spectrum analyzer
    │  ├─ index.html                # Microphone meter UI
    │  ├─ mic.css                   # Mic-specific styles
    │  └─ mic.js                    # Audio capture, FFT, weighting, logging
    ├─ number-converter/            # Number/base and unit converter
    │  ├─ index.html                # Converter UI
    │  ├─ number-converter.css      # Converter styles
    │  └─ number-converter.js       # Parsing and conversion logic
    ├─ op-amp-gain/                 # Op-amp gain / configuration helper
    │  ├─ index.html                # Op-amp configuration UI
    │  └─ op-amp-gain.js            # Gain calculations and resistor suggestions
    ├─ resistor/                    # Resistor colour-code decoder
    │  ├─ index.html                # Resistor picker
    │  ├─ resistor.css              # Resistor sub-app styles
    │  ├─ resistor.js               # Picker, SVG render, value engine
    ├─ series-parallel/             # Series / parallel resistor combos
    │  ├─ index.html                # Series/parallel UI
    │  └─ series-parallel.js        # Equivalent resistance calculations
    ├─ settings/                    # App-wide settings and preferences
    │  └─ index.html                # Settings UI (toggle defaults, units)
    ├─ smd-resistor/                # SMD resistor code lookup
    │  ├─ index.html                # SMD lookup UI
    │  └─ smd-resistor.js           # Decode SMD markings to values
    ├─ time-signal/                 # Time-signal generator for watch synchronization
    │  ├─ index.html                # Time-signal generator UI
    │  ├─ time-signal.js            # Wave calculation logic
    │  ├─ time-signal-worklet.js    # Audio output worklet
    │  └─ time-signal.css           # Time-signal specific formatting
    ├─ tuner/                       # Chromatic tuner (FFT + HPS pitch detection)
    │  ├─ index.html                # Tuner UI
    │  ├─ tuner.js                  # Audio capture, FFT + HPS, note/cents mapping
    │  └─ tuner.css                 # Tuner-specific styles
    └─ voltage-divider/             # Voltage divider calculator
       ├─ index.html               # Voltage divider UI
       └─ voltage-divider.js       # Output voltage and resistor suggestions
```

