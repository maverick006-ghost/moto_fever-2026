# Motorcycle Simulator

A non-commercial, browser-based motorcycle road-sim prototype built with Vite,
vanilla JavaScript ES modules, and Three.js. The current phase adds a custom
fixed-step riding model and a flat handling pad; it is a tuning prototype, not
a validated real-world vehicle simulation.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Create a production build with:

```sh
npm run build
```

The source model must be present at `public/assets/models/bmw_s1000_rr.glb`.
The generated meshopt-compressed LOD is at
`public/assets/models/bmw_s1000_rr_lod.glb`; regenerate it after changing the
source model with `npm run generate:lod`.

## Riding controls

- **W**: throttle
- **S**: rear brake
- **Space**: front brake
- **A / D**: steer
- **Shift**: upshift
- **Ctrl**: downshift
- **R**: reset upright at the start line
- **F3**: toggle renderer statistics
- **F4**: toggle physics debug telemetry and measured handling/performance figures
- **M**: mute or unmute engine audio
- **Camera**: use the on-screen button to switch between chase and cockpit views;
  scroll in chase view to adjust distance
- **Gamepad**: left stick steers; configured analog triggers/buttons control
  throttle, front/rear brake, and shifts. Steering has a configurable dead zone.

The physics loop runs at 60 Hz with render interpolation. It includes a
counter-steering roll response, tyre-limited cornering and braking, load
transfer, ABS slip limiting, engine braking, a shift cut, and a 300 km/h
electronic speed limiter. The handling metrics displayed with F4 are model
measurements, not certified real-world BMW performance data.

Engine audio is synthesized with Web Audio after the first user interaction.
Use **Settings** to adjust volume; when a recording is added, set its URL in
`src/config/audio.js` and the loop player will use it in place of the synth.
With no loop configured, the inline-four synthesis remains active.

Parameters are grouped in `src/config/`: `bike.js`, `suspension.js`, `tyres.js`,
`simulation.js`, `controls.js`, `track.js`, `measurement.js`, and `audio.js`.
Road tire tuning is provided; dirt and gravel surfaces are placeholders. The
test pad is a flat road with a start line and cones. The high-detail model is
used within 3.4 m of the active camera;
the reduced model is used farther away.

## Model attribution and license

BMW S1000 RR model by VTX: <https://sketchfab.com/VTX_car>  
Source: <https://sketchfab.com/3d-models/bmw-s1000-rr-1873aed292d6465694119bd81860a0c2>  
License: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)

The simplified LOD is an adaptation of the source model and retains the same
license. This project and its assets are for non-commercial use; redistribution
of adapted model assets must follow the license terms, including attribution and
ShareAlike. See [CREDITS.md](./CREDITS.md).

This project is not affiliated with or endorsed by BMW. BMW marks and product
identity appear only as present in the credited source model. Do not use the
project or model for commercial purposes.
