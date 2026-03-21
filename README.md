# Lag Not!

**Beat jet lag with a science-based personalized plan.**

Lag Not! generates a day-by-day jet lag reduction protocol based on peer-reviewed circadian biology research. Enter your origin, destination, and travel dates — get a tailored schedule covering light exposure, melatonin timing, fasting protocol, sleep shifting, exercise, and caffeine management.

**[Try it live →](https://jack.github.io/LagNot)** *(update with your actual GitHub Pages URL)*

---

## Features

- **Personalized schedule** — pre-departure, in-flight, and post-arrival recommendations
- **Circadian science** — phase response curves for light and melatonin, fasting protocol, sleep shifting
- **4,500+ airports** — searchable by IATA code, city name, or airport name
- **Return trip support** — generates recovery recommendations for both legs
- **Responsive** — works on desktop and mobile; installable as a PWA
- **Zero backend** — pure HTML/CSS/JS, hosted on GitHub Pages
- **Printable** — print or save as PDF from any browser

## Science behind the plan

| Lever | Mechanism |
|---|---|
| ☀️ Light exposure | Phase response curve — morning light advances clock (eastward); evening light delays it (westward) |
| 💊 Melatonin 0.5 mg | Physiological dose at destination bedtime shifts clock; higher OTC doses (5–10 mg) are not more effective |
| 🍽️ Fasting protocol | 12–16h fast ending at 7 AM destination time resets peripheral clocks (liver, gut) independently of brain clock |
| 🌙 Sleep shifting | 30–60 min per night before departure pre-adapts the clock; linear recovery schedule post-arrival |
| 🏃 Exercise | Morning exercise reinforces phase advance; tied to core body temperature rhythms |
| ☕ Caffeine | 10-hour cutoff before target bedtime based on 5–6h half-life; strategic use on arrival day |

**Key references:**
- Czeisler et al. — light and melatonin PRC (NEJM, 1989)
- Lewy et al. — 0.5 mg melatonin (Sleep Medicine Reviews, 2007)
- Sack et al. — jet lag clinical guidelines (Sleep, 2007)
- Fuller et al. — food restriction and circadian resetting (Science, 2008)
- Eastman & Burgess — pre-travel sleep shifting (Journal of Travel Medicine, 2009)

## Run locally

No build step required. Just serve the files statically:

```bash
# Python (built-in)
python3 -m http.server 8080

# Node (npx)
npx serve .
```

Then open `http://localhost:8080`.

## Rebuild airport data

The `data/airports.json` file is pre-built and committed. To regenerate it from the latest OurAirports data:

```bash
npm install
node scripts/build-airport-data.cjs
```

This downloads the latest `airports.csv` from [OurAirports](https://ourairports.com), filters to ~4,500 IATA-coded medium/large airports, resolves timezones via `geo-tz`, and writes `data/airports.json`.

## Project structure

```
LagNot/
├── index.html              # App shell
├── manifest.json           # PWA manifest
├── css/
│   ├── base.css            # Reset, custom properties, typography
│   ├── layout.css          # Page structure, responsive grid
│   ├── components.css      # All UI components
│   └── print.css           # Print / PDF styles
├── js/
│   ├── main.js             # Entry point, form handling
│   ├── airports.js         # Airport search
│   ├── schedule.js         # Schedule generator (orchestrator)
│   ├── circadian.js        # Circadian science engine (pure functions)
│   ├── suncalc-utils.js    # SunCalc wrapper
│   ├── render.js           # DOM rendering
│   ├── ui.js               # Autocomplete, modal, tabs, hash routing
│   └── tz.js               # Timezone utilities (Intl API)
├── data/
│   └── airports.json       # Pre-processed airport data (~172 KB gzipped)
├── scripts/
│   └── build-airport-data.js  # One-time data pipeline (Node.js)
└── .github/workflows/
    └── pages.yml           # Auto-deploy to GitHub Pages on push to main
```

## License

MIT
