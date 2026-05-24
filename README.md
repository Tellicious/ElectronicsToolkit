# Electronics Toolkit

A small, fully static Progressive Web App (PWA) hub of compact electronics utilities. It's optimized for iOS "Add to Home Screen" installs and contains several small tools (e.g., resistor colour-code decoder, converters, calculators).

## Quick start — run locally

This project is fully static. Serve the project root over HTTP and open http://localhost:8000 in your browser. Example commands:

```bash
# Python 3 built-in server
python3 -m http.server 8000
```

Notes:
- Service worker registration likewise requires HTTPS or `localhost`.

## Install on iOS

1. Host the site on HTTPS (or run on `localhost` during development).
2. Open the URL in Safari on your iOS device.
3. Tap **Share → Add to Home Screen**.

Behavior on iOS:
- The app launches full-screen and is usable offline once the service worker has cached the shell.
- Note: iOS has some PWA limitations (background execution, limited cache quota). Camera access and getUserMedia work only in Safari/standalone contexts that support it.

## Deploy to GitHub Pages

1. Push changes to the `main` branch.
2. The workflow at `.github/workflows/deploy.yml` will publish the site via GitHub Actions.
3. In your repository settings: **Settings → Pages → Build and deployment → Source: GitHub Actions** to enable Pages deployment.

## Project layout

```
index.html                      # Hub / app launcher (links to each sub-app)
manifest.json                   # PWA manifest (name, icons, display)
sw.js                           # Service worker (precache shell, runtime caching)
assets/
    ├─ app.js                   # Shared helpers, settings, and SW registration
    ├─ icons/                   # App and Apple-touch icons (multiple sizes)
    └─ styles.css               # Global tokens, variables, and hub styles
apps/
    ├─ awg-converter/           # AWG ↔ mm wire gauge converter
    │  ├─ index.html            # AWG converter UI
    │  └─ awg-converter.js      # Conversion logic and helpers
    ├─ battery-life/            # Battery life / runtime estimator
    │  ├─ index.html            # Battery estimator UI
    │  └─ battery-life.js       # Calculation logic for runtime estimates
    ├─ capacitor/               # Capacitor unit conversions / reactance
    │  ├─ index.html            # Capacitor tool UI
    │  └─ capacitor.js          # Unit conversions and reactance formulas
    ├─ led-resistor/            # LED resistor value helper
    │  ├─ index.html            # LED helper UI
    │  └─ led-resistor.js       # Compute resistor from Vf and desired current
    ├─ number-converter/        # Number/base and unit converter
    │  ├─ index.html            # Converter UI
    │  ├─ number-converter.css  # Converter styles
    │  └─ number-converter.js   # Parsing and conversion logic
    ├─ op-amp-gain/             # Op-amp gain / configuration helper
    │  ├─ index.html            # Op-amp configuration UI
    │  └─ op-amp-gain.js        # Gain calculations and resistor suggestions
    ├─ resistor/                # Resistor colour-code decoder
    │  ├─ index.html            # Resistor picker + camera UI
    │  ├─ resistor.css          # Resistor sub-app styles
    │  ├─ resistor.js           # Picker, SVG render, value engine
    │  ├─ cv.js                 # Pure-JS computer-vision pipeline
    │  └─ camera.js             # Capture flow and result UI
    ├─ series-parallel/         # Series / parallel resistor combos
    │  ├─ index.html            # Series/parallel UI
    │  └─ series-parallel.js    # Equivalent resistance calculations
    ├─ settings/                # App-wide settings and preferences
    │  └─ index.html            # Settings UI (toggle defaults, units)
    ├─ smd-resistor/            # SMD resistor code lookup
    │  ├─ index.html            # SMD lookup UI
    │  └─ smd-resistor.js       # Decode SMD markings to values
    └─ voltage-divider/         # Voltage divider calculator
        ├─ index.html           # Voltage divider UI
        └─ voltage-divider.js   # Output voltage and resistor suggestions
```

