/**
 * Orchestrator: boots physics + rendering, assembles the spherical gravity-mix
 * machine, wires the HUD + camera director, loads a game profile, and runs the
 * fixed-order sim/render loop.
 *
 * Loop order matters: draw logic (kinematic winner + anti-stall forces + wake)
 * and the rotor both act BEFORE the physics step; meshes sync AFTER it.
 *   draw.update → rotor.update → physics.step → balls.sync → director → render
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { GAME_PROFILES, DEFAULT_PROFILE, assertValidProfiles, assertRegistryConsistency, validateProfile, poolSize, totalDrawnOf } from './games.js';
import { FrameStats } from './util/stats.js';
import { QualityManager } from './engine/quality.js';
import { RenderEngine } from './engine/renderer.js';
import { initRapier, PhysicsWorld } from './engine/physics.js';
import { buildStudio } from './scene/studio.js';
import { StudioBranding } from './scene/branding.js';
import { Drum } from './scene/drum.js';
import { Rotor } from './scene/rotor.js';
import { Balls } from './scene/balls.js';
import { Exit } from './scene/exit.js';
import { DrawController, State, getActiveForcePolicy } from './sim/draw.js';
import { CameraDirector } from './ui/director.js';
import { HUD } from './ui/hud.js';

const params = new URLSearchParams(location.search);
const boot = document.getElementById('boot');
const fail = (msg) => { if (boot && !boot.dataset.done) { boot.textContent = msg; boot.classList.add('error'); } };
window.addEventListener('error', (e) => fail('Error: ' + (e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => fail('Rejection: ' + (e.reason?.message || e.reason)));

async function main() {
  const canvas = document.getElementById('stage');
  const debug = params.get('debug') === '1';
  const debugPhysics = params.get('debugPhysics') === '1';

  // Startup schema validation: refuse to run with a mis-configured lottery rule
  // (wrong range/counts, drawing more than exist, rack/queue mismatch, …), and
  // assert the drum's public game set equals the canonical registry exactly.
  assertValidProfiles();
  assertRegistryConsistency();

  try { await initRapier(); }
  catch (e) { fail('Failed to initialise physics engine.'); throw e; }

  const quality = new QualityManager();
  const qParam = params.get('q');
  if (qParam && quality.presets[qParam]) quality.lock(qParam);

  let engine;
  try { engine = new RenderEngine(canvas, quality.preset); }
  catch (e) { fail('WebGL2 is required for this demo.'); throw e; }

  const physics = new PhysicsWorld();

  // ── Scene ──
  buildStudio(engine.scene);
  const branding = new StudioBranding(engine.scene);
  const drum = new Drum(engine.scene, physics);
  const rotor = new Rotor(engine.scene, physics, { debug: debugPhysics });
  const balls = new Balls(engine.scene, physics, quality.preset.ballSeg);
  const exit = new Exit(engine.scene);

  const director = new CameraDirector(engine.camera);
  const stats = new FrameStats();
  const focus = new THREE.Vector3();

  let hud;
  const draw = new DrawController({ balls, drum, rotor, exit, camera: engine.camera }, {
    onLayout: (profile) => { hud?.buildLayout(profile); director.setRackBounds(exit.rackBox()); branding.setGame(profile); },
    onState: (s, w) => hud?.setPhase(s, w),
    onDraw: (value, poolId, results) => { hud?.setResults(results); hud?.setPhase(draw.state, value); },
    onDone: () => { setTimeout(() => hud?.sortResults(true), 350); }, // pause, then sort ascending
  });
  draw._debug = debug; // RESULT_REVEAL diagnostics in the headless harness

  const profileKey = GAME_PROFILES[params.get('profile')] ? params.get('profile') : DEFAULT_PROFILE;

  hud = new HUD(document.getElementById('hud'), {
    onStart: () => { draw.start(); hud.setResults(draw.resultsByPool); }, // clear the old row
    onReset: () => draw.reset(),
    onQuality: (v) => { if (v === 'auto') quality.unlock(); else quality.lock(v); },
    onProfile: (key) => { if (GAME_PROFILES[key]) draw.loadProfile(GAME_PROFILES[key]); },
  }, { debug, profileKey });

  draw.loadProfile(GAME_PROFILES[profileKey]);

  quality.onChange((preset) => engine.applyPreset(preset));
  const onResize = () => { engine.resize(); branding.setLayout((engine.camera.aspect || 1.6) < 1.05); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
  window.visualViewport?.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('scroll', onResize);
  onResize();
  if (boot) { boot.dataset.done = '1'; boot.classList.add('hidden'); }

  // headless=new doesn't composite the WebGL canvas into --screenshot, so blit
  // the rendered frame into a DOM <img> (which IS captured) for the harness.
  function blitToDOM() {
    const el = engine.renderer.domElement;
    const r = el.getBoundingClientRect(); // exact canvas box (top-left, minus the reserved band)
    const img = document.createElement('img');
    img.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:1;`;
    img.onload = () => { document.body.dataset.shotReady = '1'; };
    img.src = el.toDataURL('image/png');
    document.body.appendChild(img);
  }

  function stepSim(dt) {
    balls.resetForces(); // clear last frame's forces so stale mixing forces can't linger
    draw.update(dt);     // kinematic targets + forces BEFORE the step
    if (getActiveForcePolicy(draw.state).wall) balls.applyWall(); // drum wall only while balls can reach it
    rotor.update(dt);
    physics.step(dt);
    balls.clampSpeeds();
    balls.updateTrackers(dt); // per-ball motion history for the anti-stall system
    balls.sync();
    balls.updateFacing(dt, engine.camera); // turn parked winners' numbers to camera (deterministic, in-step)
    // Winner MESH speeds (finite-difference), so the draw controller can gate the
    // reveal on the ball having genuinely stopped — no residual roll or spin —
    // before the top-UI number is allowed to appear (BALL_EXIT completion).
    if (draw.winner && (draw.state === State.TRANSIT || draw.state === State.DISPLAY)) {
      const w = draw.winner;
      focus.copy(w.mesh.position);
      if (w._lp) {
        w._linSpeed = w.mesh.position.distanceTo(w._lp) / dt;
        const d = Math.min(1, Math.abs(w.mesh.quaternion.dot(w._lq)));
        w._angSpeed = (2 * Math.acos(d)) / dt;
      }
      (w._lp ||= new THREE.Vector3()).copy(w.mesh.position);
      (w._lq ||= new THREE.Quaternion()).copy(w.mesh.quaternion);
    } else {
      focus.set(0, 0, 0);
    }
  }

  if (params.get('shot')) { runShotHarness(params.get('shot')); return; }

  // ── Normal interactive loop (fixed-step physics, decoupled from FPS) ──
  const FIXED = 1 / 60;
  let acc = 0, hudTick = 0;
  function frame() {
    const dt = stats.tick();
    acc += dt;
    let steps = 0;
    while (acc >= FIXED && steps < 5) { stepSim(FIXED); acc -= FIXED; steps++; }
    director.update(dt, draw.state, focus);
    quality.sample(stats.fps, dt);
    engine.render();
    hudTick += dt;
    if (hudTick > 0.1) { hudTick = 0; hud.setMeters(stats.fps, balls.inDrumCount(), draw.state, draw.mixActivity); hud.setCounts(balls.allPoolCounts()); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function runShotHarness(shot) {
    const dt = 1 / 60;

    // Mixing proof: hold in MIXING and measure real 3D activity + per-axis travel.
    if (shot === 'mix' || shot === 'metrics') {
      const sec = parseFloat(params.get('sec') || (shot === 'metrics' ? '15' : '4'));
      CONFIG.draw.mixSeconds = 1e9; // stay in MIXING for the test
      draw.start();
      let i = 0;
      while (draw.state !== State.MIXING && i < 900) { stepSim(dt); i++; }
      const p0 = balls.items.map((it) => { const t = it.body.translation(); return { x: t.x, y: t.y, z: t.z }; });
      const steps = Math.max(1, Math.round(sec / dt));
      for (let k = 0; k < steps; k++) {
        stepSim(dt);
        if (shot === 'metrics' && k % Math.round(3 / dt) === 0) {
          const m = balls.metrics();
          console.log(`METRIC t=${(k * dt).toFixed(0)}s moving=${(m.movingRatio * 100).toFixed(0)}% ang=${m.avgAngSpeed.toFixed(1)} coherent=${m.coherent.toFixed(2)} near=${(m.nearWallRatio * 100).toFixed(0)}% top=${(m.topRatio * 100).toFixed(0)}% bot=${(m.bottomRatio * 100).toFixed(0)}%`);
        }
      }
      const D = CONFIG.ball.radius * 2;
      let mvX = 0, mvY = 0, mvZ = 0, spun = 0;
      balls.items.forEach((it, idx) => {
        const t = it.body.translation(), w = it.body.angvel();
        if (Math.abs(t.x - p0[idx].x) > 3 * D) mvX++;
        if (Math.abs(t.y - p0[idx].y) > 3 * D) mvY++;
        if (Math.abs(t.z - p0[idx].z) > 2 * D) mvZ++;
        if (Math.hypot(w.x, w.y, w.z) > 0.5) spun++;
      });
      const n = balls.items.length;
      const m = balls.metrics();
      console.log(`MIXTEST sec=${sec} balls=${n} movedX≥3d=${(mvX / n * 100).toFixed(0)}% movedY≥3d=${(mvY / n * 100).toFixed(0)}% movedZ≥2d=${(mvZ / n * 100).toFixed(0)}% spinning=${(spun / n * 100).toFixed(0)}%`);
      console.log(`METRICS moving=${(m.movingRatio * 100).toFixed(0)}% avgLin=${m.avgLinSpeed.toFixed(2)} avgAng=${m.avgAngSpeed.toFixed(2)} varX=${m.varX.toFixed(2)} varY=${m.varY.toFixed(2)} varZ=${m.varZ.toFixed(2)} nearWall=${(m.nearWallRatio * 100).toFixed(0)}% top=${(m.topRatio * 100).toFixed(0)}% bottom=${(m.bottomRatio * 100).toFixed(0)}% coherent=${m.coherent.toFixed(2)}`);
      director.update(1, draw.state, focus); director.snap();
      requestAnimationFrame(() => { engine.render(); engine.render(); blitToDOM(); });
      return;
    }

    // Fairness audit (READ-ONLY): run many independent FIRST-ball draws and
    // measure the distribution of the first number out. Nothing about the model
    // is changed — each trial only gets a fresh crypto initial layout. Reports
    // chi-square vs uniform + whether winners are biased by where they started
    // (initial height / initial proximity to the exit throat).
    if (shot === 'fairtest') {
      const N = parseInt(params.get('n') || '2000', 10);
      const budgetMs = parseFloat(params.get('budget') || '540000');
      const EX = 0, EY = exit.captureY, EZ = 0; // throat/exit reference point
      const t0 = performance.now();
      const freq = new Map();
      let done = 0, sumHpct = 0, sumEpct = 0, sumSteps = 0, noCapture = 0;
      for (let d = 0; d < N; d++) {
        if (performance.now() - t0 > budgetMs) break;
        draw.loadProfile(GAME_PROFILES[profileKey]); // fresh balls
        draw.start();
        // Snapshot each ball's INITIAL height + distance to the exit.
        const snap = balls.items.map((it) => {
          const p = it.body.translation();
          return { id: it.id, y: p.y, dExit: Math.hypot(p.x - EX, p.y - EY, p.z - EZ) };
        });
        let steps = 0, cap = null;
        while (steps < 2500) { stepSim(dt); steps++; if (draw.winner) { cap = draw.winner; break; } }
        if (!cap) { noCapture++; continue; }
        freq.set(cap.value, (freq.get(cap.value) || 0) + 1);
        const nb = snap.length - 1;
        const ws = snap.find((s) => s.id === cap.id);
        sumHpct += snap.filter((s) => s.y < ws.y).length / nb;      // 0=started lowest, 1=highest
        sumEpct += snap.filter((s) => s.dExit < ws.dExit).length / nb; // 0=started nearest exit
        sumSteps += steps; done++;
      }
      const pool = draw.profile.mainPool;
      const K = pool.max - pool.min + 1;
      const exp = done / K;
      let chi = 0, maxdev = 0; const rows = [];
      for (let n = pool.min; n <= pool.max; n++) {
        const o = freq.get(n) || 0; rows.push(o);
        chi += (o - exp) ** 2 / exp; maxdev = Math.max(maxdev, Math.abs(o - exp) / exp);
      }
      console.log(`FAIRTEST profile=${profileKey} N=${done} noCapture=${noCapture} K=${K} exp=${exp.toFixed(2)} chiSquare=${chi.toFixed(1)} df=${K - 1} maxRelDev=${(maxdev * 100).toFixed(1)}% avgWinnerHeightPct=${(sumHpct / done).toFixed(3)} avgWinnerExitProximityPct=${(sumEpct / done).toFixed(3)} avgCaptureSteps=${(sumSteps / done).toFixed(0)}`);
      console.log(`FAIRFREQ min=${pool.min} counts=${JSON.stringify(rows)}`);
      return;
    }

    // Game-rule audit: structural schema assertions + N complete draws proving the
    // physical balls, counts, ranges, conservation and UP-TO-DATE UI all match the
    // canonical profile (e.g. Norsk Lotto = 34 balls, 7 main + 1 tilleggstall from
    // the same pool, 26 left, nothing > 34, additional ≠ main, UI == physical rack).
    if (shot === 'ruletest') {
      const profile = GAME_PROFILES[profileKey];
      const N = parseInt(params.get('n') || '100', 10);
      const struct = validateProfile(profile);
      const mainPool = profile.mainPool;
      const mainSize = poolSize(mainPool), mainDraw = mainPool.drawCount, totalDraw = totalDrawnOf(profile);
      const sameMainDraws = profile.bonusPools.filter((b) => b.strategy === 'same-main-pool').reduce((a, b) => a + b.drawCount, 0);
      const lastPid = profile.drawOrder[profile.drawOrder.length - 1];
      const lastPool = profile.bonusPools.find((b) => b.id === lastPid);
      const expectInside = (lastPool && lastPool.strategy === 'separate-pool')
        ? poolSize(lastPool) - lastPool.drawCount : mainSize - (mainDraw + sameMainDraws);
      let pass = 0; const fails = [];
      for (let d = 0; d < N; d++) {
        const errs = [];
        draw.loadProfile(profile);
        const init = balls.items.filter((it) => !it.parked && !it.drawn).map((it) => it.value);
        if (init.length !== mainSize) errs.push(`initial ${init.length}≠${mainSize}`);
        if (new Set(init).size !== init.length) errs.push('initial dup#');
        if (init.some((v) => v < mainPool.min || v > mainPool.max)) errs.push('initial out-of-range');
        draw.start();
        let steps = 0, ok = false;
        for (; steps < 8000; steps++) {
          stepSim(dt);
          const parked = balls.items.filter((it) => it.parked).length;
          const pub = Object.values(draw.resultsByPool).reduce((a, arr) => a + arr.length, 0);
          if (parked >= totalDraw && pub >= totalDraw
            && (draw.state === State.STOPPING || draw.state === State.FINAL_SETTLING || draw.state === State.COMPLETE)) { ok = true; break; }
        }
        if (!ok) { fails.push(`#${d}: did not complete`); continue; }
        const parked = balls.items.filter((it) => it.parked);
        const inside = balls.items.filter((it) => !it.parked && !it.drawn);
        if (parked.length !== totalDraw) errs.push(`parked ${parked.length}≠${totalDraw}`);
        if (inside.length !== expectInside) errs.push(`inside ${inside.length}≠${expectInside}`);
        const ids = balls.items.map((it) => it.id);
        if (new Set(ids).size !== ids.length) errs.push('dup objIDs');
        // Per result group: UI numbers must equal the physical rack balls of that group.
        for (const g of profile.resultLayout.groups) {
          const ui = [...(draw.resultsByPool[g.pool] || [])].sort((a, b) => a - b);
          const phys = parked.filter((it) => it.resultPool === g.pool).map((it) => it.value).sort((a, b) => a - b);
          if (ui.length !== g.slotCount) errs.push(`${g.pool} ui ${ui.length}≠${g.slotCount}`);
          if (JSON.stringify(ui) !== JSON.stringify(phys)) errs.push(`${g.pool} UI≠rack ${JSON.stringify(ui)}/${JSON.stringify(phys)}`);
          if (new Set(phys).size !== phys.length) errs.push(`${g.pool} dup#`);
          if (phys.some((v) => v < mainPool.min || v > mainPool.max) && lastPid !== g.pool && !profile.bonusPools.find((b) => b.id === g.pool && b.strategy === 'separate-pool')) errs.push(`${g.pool} >range`);
        }
        // same-main-pool bonus number must NOT be one of the main numbers.
        for (const b of profile.bonusPools) if (b.strategy === 'same-main-pool') {
          const mainNums = new Set(draw.resultsByPool.main || []);
          if ((draw.resultsByPool[b.id] || []).some((v) => mainNums.has(v))) errs.push(`${b.id}∈main`);
        }
        try { balls.assertConservation(); } catch (ex) { errs.push('conservation:' + ex.message); }
        if (errs.length) fails.push(`#${d}: ${errs.join(',')}`); else pass++;
      }
      console.log(`RULETEST profile=${profileKey} runs=${N} structErrs=${JSON.stringify(struct)} mainSize=${mainSize} totalDraw=${totalDraw} expectInside=${expectInside} pass=${pass} fail=${fails.length}`);
      for (const f of fails.slice(0, 12)) console.log(`RULEFAIL ${f}`);
      return;
    }

    // Calm-start check: no draw started; after `sec` the machine must be at rest.
    if (shot === 'idlecheck') {
      const sec = parseFloat(params.get('sec') || '3');
      for (let i = 0; i < Math.round(sec / dt); i++) stepSim(dt);
      const a = balls.items.filter((it) => !it.drawn && !it.parked);
      let mv = 0, asleep = 0; for (const it of a) { const v = it.body.linvel(); if (Math.hypot(v.x, v.y, v.z) > 0.1) mv++; if (it.body.isSleeping()) asleep++; }
      const ss = balls.settleStatus();
      console.log(`IDLECHECK t=${sec}s state=${draw.state} rotorP=${rotor.speedPrimary.toFixed(3)} rotorS=${rotor.speedSecondary.toFixed(3)} movingBalls=${mv} suspended=${ss.suspended} asleep=${asleep}/${a.length} maxY=${ss.maxY.toFixed(2)}`);
      director.update(1, draw.state, focus); director.snap();
      requestAnimationFrame(() => { engine.render(); engine.render(); blitToDOM(); });
      return;
    }

    // Full-draw ball-count audit: logs the count trace + uniqueness + suspended.
    if (shot === 'counttest') {
      draw.start();
      let lastRack = -1;
      for (let i = 0; i < 30000; i++) {
        stepSim(dt);
        const rack = balls.items.filter((it) => it.parked).length;
        if (rack !== lastRack) {
          lastRack = rack;
          const cs = balls.allPoolCounts().map((c) => `${c.poolId}[in=${c.inside},tr=${c.transit},rack=${c.rack},rm=${c.removed},tot=${c.total},ok=${c.valid}]`).join(' ');
          console.log(`COUNT rack=${rack} state=${draw.state} ${cs}`);
        }
        if (draw.state === State.COMPLETE) break;
      }
      for (const c of balls.allPoolCounts()) {
        const u = balls.uniquenessReport(c.poolId);
        console.log(`FINAL ${c.poolId}: initial=${c.initial} inside=${c.inside} transit=${c.transit} rack=${c.rack} removed=${c.removed} total=${c.total} valid=${c.valid} unique=${u.unique} duplicates=${u.duplicates} missing=${u.missing}`);
      }
      const ss = balls.settleStatus();
      console.log(`SUSPENDED ballsSuspendedAboveBottom=${ss.suspended} maxY=${ss.maxY.toFixed(2)} allSettled=${ss.allSettled} results=${JSON.stringify(draw.resultsByPool)}`);
      // Verify the machine is truly stopped: wait 5 s in COMPLETE and re-measure.
      for (let i = 0; i < Math.round(5 / dt); i++) stepSim(dt);
      const a = balls.items.filter((it) => !it.drawn && !it.parked);
      let mv = 0, asleep = 0, kin = 0;
      for (const it of a) { const v = it.body.linvel(); if (Math.hypot(v.x, v.y, v.z) > 0.1) mv++; if (it.body.isSleeping()) asleep++; if (it.body.bodyType() !== physics.RAPIER.RigidBodyType.Dynamic) kin++; }
      const ss2 = balls.settleStatus();
      console.log(`AFTERCOMPLETE +5s state=${draw.state} rotorP=${rotor.speedPrimary.toFixed(3)} rotorS=${rotor.speedSecondary.toFixed(3)} movingBalls=${mv} suspended=${ss2.suspended} kinematicInDrum=${kin} asleep=${asleep}/${a.length} maxY=${ss2.maxY.toFixed(2)}`);
      balls.snapFacing(engine.camera); hud.sortResults(false);
      director.update(1, draw.state, focus); director.snap();
      requestAnimationFrame(() => { engine.render(); engine.render(); blitToDOM(); });
      return;
    }

    // Reveal-timing audit: the top-UI number for a ball must appear ONLY after
    // that ball is in-rack, settled and facing the camera — never during
    // mixing/capture/transit. Logs per-ball timestamps and flags any violation.
    if (shot === 'revealtest') {
      draw.start();
      const seen = [];       // {id, value, ts}
      let violations = 0;
      for (let i = 0; i < 30000; i++) {
        stepSim(dt);
        // Invariant: while a ball is mixing/captured/in transit its number must
        // NOT be in the published results yet.
        const w = draw.winner;
        if (w && !draw._revealed && (draw.state === State.TRANSIT || draw.state === State.CAPTURING)) {
          const pub = draw.resultsByPool[w.resultPool] || [];
          if (pub.includes(w.value)) { console.log(`VIOLATION early-reveal ball=${w.value} state=${draw.state}`); violations++; }
        }
        // Capture each reveal exactly once.
        if (w && draw._revealed && !seen.find((s) => s.id === w.id)) {
          seen.push({ id: w.id, value: w.value, ts: { ...w.ts }, lifecycle: w.lifecycle, facingDot: w.facingDot });
        }
        if (draw.state === State.COMPLETE) break;
      }
      for (const s of seen) {
        const t = s.ts;
        const ordered = t.capture < t.chute && t.chute < t.rack && t.rack <= t.settled
          && t.settled <= (t.facing ?? t.reveal) && (t.facing ?? t.reveal) <= t.reveal;
        if (!ordered || s.lifecycle !== 'in-rack') violations++;
        console.log(`REVEAL id=${s.id} n=${s.value} lifecycle=${s.lifecycle} facingDot=${(s.facingDot ?? 0).toFixed(3)} `
          + `capture=${t.capture?.toFixed(0)} chute=${t.chute?.toFixed(0)} rack=${t.rack?.toFixed(0)} `
          + `settled=${t.settled?.toFixed(0)} facing=${t.facing?.toFixed(0)} reveal=${t.reveal?.toFixed(0)} ordered=${ordered}`);
      }
      console.log(`REVEALTEST reveals=${seen.length} violations=${violations} results=${JSON.stringify(draw.resultsByPool)}`);
      balls.snapFacing(engine.camera); hud.sortResults(false);
      director.update(1, draw.state, focus); director.snap();
      requestAnimationFrame(() => { engine.render(); engine.render(); blitToDOM(); });
      return;
    }

    // Lightweight results-layout check (no physics): fill every group full.
    if (shot === 'uiresults') {
      const res = {};
      for (const id of Object.keys(draw.pools)) {
        const pool = draw.pools[id];
        res[id] = Array.from({ length: pool.drawCount }, (_, k) => pool.min + k);
      }
      draw.resultsByPool = res;
      hud.setResults(res);
      hud.setPhase(State.COMPLETE, res[draw.profile.mainPool.id]?.[0] ?? 1);
      director.update(1, State.IDLE, focus); director.snap();
      requestAnimationFrame(() => { engine.render(); engine.render(); blitToDOM(); });
      return;
    }

    const autostart = shot !== 'idle';
    if (autostart) draw.start();
    const reached = () => {
      switch (shot) {
        case 'idle': return draw.state === State.IDLE;
        case 'mixing': return draw.state === State.MIXING && draw.timer > 1.6;
        case 'capture': return draw.state === State.CAPTURING && draw.timer > 0.15;
        case 'tube': return draw.state === State.TRANSIT && draw._u > 0.3 && draw._u < 0.55;
        case 'chute': return draw.state === State.TRANSIT && draw._u > 0.78;
        case 'display': return draw.state === State.DISPLAY && Object.values(draw.resultsByPool).some((a) => a.length >= 1);
        case 'bonus': return draw.state === State.DISPLAY && (draw.resultsByPool.bonus?.length || draw.resultsByPool.stars?.length);
        case 'complete': case 'drawtest': return draw.state === State.COMPLETE;
        default: return true;
      }
    };
    const minSteps = shot === 'idle' ? 90 : 0;
    // Full-draw diagnostics: worst per-ball stuck times + that the rotor never stops.
    const track = shot === 'drawtest' || shot === 'complete';
    let mStill = 0, mTop = 0, mBot = 0, mWall = 0, rotorMin = 1e9, activeStates = 0;
    for (let i = 0; i < 22000; i++) {
      stepSim(dt);
      if (track && i % 5 === 0) {
        const s = balls.stuckStats();
        mStill = Math.max(mStill, s.stillMax); mTop = Math.max(mTop, s.topMax);
        mBot = Math.max(mBot, s.bottomMax); mWall = Math.max(mWall, s.wallMax);
        const st = draw.state;
        if (st === State.MIXING || st === State.CAPTURING || st === State.TRANSIT || st === State.DISPLAY) {
          rotorMin = Math.min(rotorMin, Math.abs(rotor.speedPrimary)); activeStates++;
        }
      }
      if (i >= minSteps && reached()) break;
    }
    if (track) { const ss = balls.settleStatus(); console.log(`DRAWTEST maxStill=${mStill.toFixed(2)}s maxTop=${mTop.toFixed(2)}s maxBottom=${mBot.toFixed(2)}s maxWall=${mWall.toFixed(2)}s rotorMinDuringDraw=${(rotorMin === 1e9 ? 0 : rotorMin).toFixed(2)}rad/s suspended=${ss.suspended} maxY=${ss.maxY.toFixed(2)}`); }
    console.log(`SHOT ${shot} state=${draw.state} results=${JSON.stringify(draw.resultsByPool)} inDrum=${balls.inDrumCount()}`);
    balls.snapFacing(engine.camera);
    if (track) hud.sortResults(); // show the final sorted result in the stills
    director.update(1, draw.state, focus); director.snap();
    requestAnimationFrame(() => { engine.render(); engine.render(); blitToDOM(); });
  }
}

main().catch((e) => { console.error('STACK ' + (e && e.stack ? e.stack : e)); fail('Demo failed to start — see console.'); });
