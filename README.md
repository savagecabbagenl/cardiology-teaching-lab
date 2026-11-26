# Cardiology Teaching Lab

Free, interactive cardiology teaching tools for the ward, the classroom and your phone.

**Live site:** https://savagecabbagenl.github.io/cardiology-teaching-lab/

| Tool | Path |
| --- | --- |
| Right Heart Cath Simulator | `rhc-simulator/` |
| ECG Basics (course for medical students) | `ecg-basics/` |
| ECG Rhythm Lab | `ecg-simulator/` |
| PV Loop Simulator | `pv-loop-simulator/` |
| Heart Sounds Simulator | `heart-sounds/` |
| Ticker Talks (20 case-based CCU sessions) | `ticker-talks/` |

Everything is plain static HTML with no build step. The site is served by GitHub Pages from the `main` branch root. `sw.js` and `manifest.webmanifest` let people add it to their home screen and use it offline; bump `VERSION` in `sw.js` when adding new pages.

`pipeline/` holds the Python scripts used to author Ticker Talks. It is excluded from the public site (see `_config.yml`) and reads the API key from the `ANTHROPIC_API_KEY` environment variable, so no key is stored here.

`ecg-basics/ecg-engine.js` is generated from the ECG Rhythm Lab's engine: after changing the engine in `ecg-simulator/index.html`, run `tools/sync-ecg-engine.sh` so both tools stay in step. `tools/` is excluded from the site.

For education only, not for clinical decision-making.
