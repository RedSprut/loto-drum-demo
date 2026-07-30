# Loto Drum — standalone 3D physics demo

A self-contained, real-time **physics-driven** lottery machine: a professional
**spherical gravity-mix drum** on a horizontal axis, stirred by a real internal
rotor, with the winning ball travelling a fully visible path (throat → tube →
chute → accumulator rack). Every ball is an independent rigid body; the winner
is decided only when a ball physically drops out of the drum. **Nothing here
touches the main app** — no shared code, no build step, no changes to
`index.html`, Capacitor, Supabase or the commercial system.

## Run it

It needs to be served over HTTP (ES modules + WASM don't run from `file://`):

```bash
# from the repo root
python3 -m http.server 8080
# then open:
#   http://localhost:8080/demo-drum/
```

On the deployed GitHub Pages site it lives at **`/demo-drum/`**.

Requirements: a WebGL2 browser (all modern desktop + mobile browsers). Three.js
and Rapier's WASM are **self-hosted** under `vendor/` via an import map — no CDN,
no install, no build step.

## Controls

The machine is the hero. In normal mode the UI is just the **Начать розыгрыш**
button (bottom centre), the results row (top centre, one labelled group per pool)
and a compact settings gear (bottom right: **game profile**, quality, reset).

Query flags:
- **`?profile=mainOnly|oneBonus|twoBonus`** — pick the starting game profile.
- **`?debug=1`** — show FPS / ball-count / state / **mixing-activity** meters.
- **`?debugPhysics=1`** — render the rotor's pusher colliders as wireframes.
- **`?q=low|medium|high|ultra`** — pin a quality tier.

## Game profiles (data-driven)

Nothing about the draw is hard-coded — a `GameProfile` (see `src/games.js`)
drives the loaded ball count, number ranges, how many main results, bonus balls
(and their colour), rack slots, the draw sequence and the results UI. Three
example profiles ship:
- **mainOnly** — 6 of 40, no bonus.
- **oneBonus** — 6 of 45 + 1 bonus drawn from the *same* pool (red), separate slot.
- **twoBonus** — 5 of 50 + 2 "stars" from a *separate* 1–12 pool: the drum is
  cleared and reloaded with the bonus set (a visible RELOAD beat) before drawing.

Switch profiles live from the settings gear; the sim stops, disposes all bodies
and meshes, rebuilds the rack + results UI and returns to IDLE.

## Mixing (the rotor really stirs)

The rotor is a light mechanism — a thin shaft carrying a helix of 6 thin arms,
each tipped with a small soft capsule pusher that reaches to within ~0.14 units
of the inner wall *for its own X-slice*, so the pushers dip into the ball bed at
the bottom and physically lift/circulate the balls. Balls never sleep while a
draw runs. Measured over a 40-ball bed: ~100% of balls change position within a
couple of seconds and average activity stays ~76–100% (a stall warning prints if
it ever drops below 55%). During capture the rotor stops and a gentle *uniform*
funnel lets a ball settle into the throat — it never targets a winner.

## How the draw stays fair

* Initial ball state is seeded from **crypto entropy** (`crypto.getRandomValues`).
* Balls are stirred **only** by the real, physical rotor blades (kinematic
  colliders) — no keyframes, no scripted paths, no fake collisions.
* The winner of each pick is **whichever ball physically drops through the throat
  first** once the gate is armed — see `src/sim/draw.js`. The code never selects
  a ball and never pre-rolls a sequence. After capture the winner is switched to
  a kinematic body and glided along one continuous curve so its whole journey is
  on-screen and never teleports.

## Architecture

```
index.html          import map + canvas + HUD host, boots src/main.js
styles.css          premium dark UI, safe-area aware, responsive
src/
  config.js         all physical/visual tunables in one place
  main.js           orchestrator + fixed-order sim/render loop + screenshot harness
  engine/
    physics.js      Rapier world + body/collider helpers (CCD, kinematic multi-collider)
    renderer.js     Three.js: PBR, IBL, shadows, ACES tone map, gentle bloom
    quality.js      device probe + adaptive quality (auto up/down-scale)
  scene/
    drum.js         transparent sphere chamber + metal frame + throat/gate + trimesh wall
    rotor.js        horizontal shaft + hub + curved acrylic blades (kinematic mixer)
    balls.js        rigid-body balls + PBR spheres + multi-medallion number textures
    exit.js         capture cup + lift tube + front chute + physical accumulator rack
    studio.js       backdrop arc, light strips, semi-reflective floor, pedestal
  sim/
    draw.js         fair draw state machine (physical capture + kinematic exit path)
  ui/
    director.js     finite-state camera bound to draw stages, aspect-aware framing
    hud.js          Russian UI: primary button, results row, settings, debug meters
  util/
    prng.js         crypto seed + value-noise helpers
    numbers.js      canvas multi-medallion number-ball textures
    stats.js        rolling FPS / frame timing
```

## Draw stages

`IDLE → MIXING → ARMING → CAPTURING → TRANSIT → DISPLAY → (loop) → COMPLETE`

The rotor spins fast during `MIXING`, slows while the gate is `ARMING`/`CAPTURING`,
and keeps the remaining balls churning between picks. The camera director maps
each stage to a pre-designed shot (hero / mixing / outlet / display) and damps
between them — the machine is never lost off-screen.

## Screenshot harness

`?shot=<idle|mixing|capture|tube|chute|display|complete>` runs the simulation
deterministically to that stage, snaps the camera, renders one frame and halts —
used to capture verification stills in headless Chrome. (`headless=new` doesn't
composite the WebGL canvas into `--screenshot`, so the harness blits the rendered
frame into a DOM `<img>`, which is captured.)
