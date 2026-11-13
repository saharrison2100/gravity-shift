/* Gravity Shift — a one-touch gravity-flip runner.
   Pure Canvas 2D + Web Audio. No dependencies. */
(() => {
  "use strict";

  const W = 960, H = 540;
  const PROJECT = "gravity-shift";
  const SHIFT_MS = 420;      // gravity-shift transition, art bible section 4.3

  /* ---- Gravity Shift design tokens (mirrors docs/tokens.css) ---- */
  const C = {
    void: "#05070B", slate: "#0B1119", graphite: "#161E29", steel: "#2A3644",
    mist: "#8FA0B3", ivory: "#E8EFF7",
    gravity: "#22D3EE", gravityHi: "#A9F4FF",
    hazard: "#FFB13B", failure: "#FF4D4D", nullV: "#8B5CF6",
  };

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const stage = document.getElementById("stage");

  const el = {
    score: document.getElementById("scoreVal"),
    best: document.getElementById("bestVal"),
    combo: document.getElementById("combo"),
    titleScreen: document.getElementById("titleScreen"),
    pauseScreen: document.getElementById("pauseScreen"),
    overScreen: document.getElementById("overScreen"),
    titleBest: document.getElementById("titleBest"),
    finalScore: document.getElementById("finalScore"),
    finalDetail: document.getElementById("finalDetail"),
    newBest: document.getElementById("newBest"),
    playBtn: document.getElementById("playBtn"),
    resumeBtn: document.getElementById("resumeBtn"),
    quitBtn: document.getElementById("quitBtn"),
    againBtn: document.getElementById("againBtn"),
    mute: document.getElementById("mute"),
  };

  /* ---------------- storage ---------------- */
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(PROJECT + ":" + k); return v === null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(PROJECT + ":" + k, JSON.stringify(v)); } catch (e) {}
    },
  };

  let best = store.get("best", 0) || 0;
  let muted = store.get("muted", false) || false;

  /* ---------------- audio ---------------- */
  let actx = null;
  function audio() {
    if (muted) return null;
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { actx = new AC(); } catch (e) { return null; }
    }
    if (actx.state === "suspended" && actx.resume) actx.resume().catch(() => {});
    return actx;
  }
  function tone(opts) {
    const ac = audio();
    if (!ac) return;
    const { from = 440, to = from, dur = 0.12, type = "square", gain = 0.06, delay = 0 } = opts;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }
  const sfx = {
    flip() { tone({ from: 320, to: 620, dur: 0.09, type: "triangle", gain: 0.05 }); },
    land() { tone({ from: 150, to: 90, dur: 0.07, type: "sine", gain: 0.045 }); },
    shard(n) { tone({ from: 720 + n * 55, to: 1180 + n * 60, dur: 0.11, type: "sine", gain: 0.055 }); },
    die() {
      tone({ from: 220, to: 55, dur: 0.5, type: "sawtooth", gain: 0.09 });
      tone({ from: 110, to: 40, dur: 0.6, type: "square", gain: 0.05, delay: 0.03 });
    },
    start() { tone({ from: 380, to: 760, dur: 0.16, type: "triangle", gain: 0.05 }); },
  };

  /* ---------------- constants ---------------- */
  const GRAV = 2500;
  const PLAYER_W = 28, PLAYER_H = 28;
  const SCREEN_X = 300;          // where the player sits on screen
  const BASE_SPEED = 340;
  const MAX_SPEED = 790;
  const RAMP_SECONDS = 78;
  const SECTION_W = 380;
  const FLOOR_DEFAULT = 424;
  const CEIL_DEFAULT = 126;
  const MAX_SHIFT = 62;

  /* ---------------- state ---------------- */
  const G = {
    state: "title",       // title | play | paused | over
    t: 0,                 // run time (s)
    score: 0,
    shardScore: 0,
    shards: 0,
    combo: 0,
    dist: 0,
    speed: BASE_SPEED,
    shake: 0,
    flash: 0,
    sections: [],
    nextX: 0,
    player: { x: 0, y: 300, w: PLAYER_W, h: PLAYER_H, vy: 0, dir: 1, grounded: false, squash: 0, visAngle: 0, shift: 0 },
    particles: [],
    trail: [],
    lastSectionFloor: FLOOR_DEFAULT,
    lastSectionCeil: CEIL_DEFAULT,
    deadBy: "",
  };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  /* ---------------- level generation ---------------- */
  function makeSection(t) {
    const prevFloor = G.lastSectionFloor;
    const prevCeil = G.lastSectionCeil;
    const kinds = ["flat", "flat", "shards", "spikesFloor", "spikesCeil", "tight"];
    if (t > 0.14) kinds.push("gapFloor", "spikesFloor");
    if (t > 0.26) kinds.push("gapCeil", "stagger");
    if (t > 0.45) kinds.push("gapFloor", "tight", "stagger");
    if (t > 0.62) kinds.push("gauntlet", "gapCeil");
    const kind = pick(kinds);

    let floorY = prevFloor;
    let ceilY = prevCeil;
    let hasFloor = true;
    let hasCeil = true;
    const spikes = [];
    const coins = [];

    const nudge = () => rnd(-MAX_SHIFT, MAX_SHIFT);

    if (kind === "flat") {
      floorY = clamp(prevFloor + nudge() * 0.5, 340, 452);
      ceilY = clamp(prevCeil - nudge() * 0.5, 88, 210);
    } else if (kind === "tight") {
      floorY = clamp(prevFloor + rnd(-30, 50), 300, 452);
      ceilY = clamp(prevCeil + rnd(-50, 30), 96, 250);
      if (floorY - ceilY < 132) floorY = ceilY + 132;
    } else if (kind === "spikesFloor") {
      floorY = clamp(prevFloor + nudge() * 0.4, 350, 452);
      ceilY = prevCeil;
      const n = t > 0.5 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const sx = G.nextX + rnd(70, SECTION_W - 110);
        spikes.push({ x: sx, y: floorY, w: 34, h: 30, dir: -1 });
      }
    } else if (kind === "spikesCeil") {
      floorY = prevFloor;
      ceilY = clamp(prevCeil + nudge() * 0.4, 100, 200);
      const n = t > 0.5 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const sx = G.nextX + rnd(70, SECTION_W - 110);
        spikes.push({ x: sx, y: ceilY, w: 34, h: 30, dir: 1 });
      }
    } else if (kind === "gapFloor") {
      hasFloor = false;
      floorY = prevFloor;
      ceilY = clamp(prevCeil + rnd(-20, 26), 104, 210);
    } else if (kind === "gapCeil") {
      hasCeil = false;
      ceilY = prevCeil;
      floorY = clamp(prevFloor + rnd(-26, 20), 340, 452);
    } else if (kind === "stagger") {
      floorY = clamp(prevFloor + rnd(-MAX_SHIFT, MAX_SHIFT), 330, 452);
      ceilY = clamp(prevCeil + rnd(-MAX_SHIFT, MAX_SHIFT), 92, 220);
      if (floorY - ceilY < 120) ceilY = floorY - 120;
    } else if (kind === "gauntlet") {
      hasFloor = Math.random() > 0.5;
      hasCeil = Math.random() > 0.5;
      floorY = clamp(prevFloor + rnd(-34, 34), 340, 452);
      ceilY = clamp(prevCeil + rnd(-34, 34), 100, 210);
      const n = 2;
      for (let i = 0; i < n; i++) {
        const sx = G.nextX + rnd(60, SECTION_W - 90);
        const onFloor = Math.random() > 0.5;
        if (onFloor === hasFloor) spikes.push({ x: sx, y: floorY, w: 34, h: 30, dir: -1 });
        else if (hasCeil) spikes.push({ x: sx, y: ceilY, w: 34, h: 30, dir: 1 });
      }
    }

    floorY = clamp(floorY, 280, 460);
    ceilY = clamp(ceilY, 70, 260);
    if (floorY - ceilY < 110) floorY = Math.min(460, ceilY + 110);

    // shards
    const shardCount = kind === "shards" ? 3 : Math.random() < 0.55 ? 1 : 0;
    for (let i = 0; i < shardCount; i++) {
      const cx = G.nextX + (SECTION_W / (shardCount + 1)) * (i + 1);
      const lo = ceilY + 46, hi = floorY - 46;
      const cy = hi > lo ? rnd(lo, hi) : (ceilY + floorY) / 2;
      coins.push({ x: cx, y: cy, r: 11, got: false, miss: false, spin: rnd(0, 6.28) });
    }

    G.lastSectionFloor = floorY;
    G.lastSectionCeil = ceilY;

    return { x: G.nextX, w: SECTION_W, floorY, ceilY, hasFloor, hasCeil, spikes, coins };
  }

  function seedSections() {
    G.sections = [];
    G.nextX = -SECTION_W * 2;
    G.lastSectionFloor = FLOOR_DEFAULT;
    G.lastSectionCeil = CEIL_DEFAULT;
    for (let i = 0; i < 3; i++) {
      G.sections.push({
        x: G.nextX, w: SECTION_W, floorY: FLOOR_DEFAULT, ceilY: CEIL_DEFAULT,
        hasFloor: true, hasCeil: true, spikes: [], coins: [],
      });
      G.nextX += SECTION_W;
    }
  }

  function ensureSections(cameraX) {
    while (G.nextX < cameraX + W * 2) {
      const t = clamp(G.t / 80, 0, 1);
      G.sections.push(makeSection(t));
      G.nextX += SECTION_W;
    }
    // prune behind
    while (G.sections.length > 4 && G.sections[0].x + G.sections[0].w < cameraX - 400) {
      G.sections.shift();
    }
  }

  function sectionAt(x) {
    for (let i = G.sections.length - 1; i >= 0; i--) {
      const s = G.sections[i];
      if (x >= s.x && x < s.x + s.w) return s;
    }
    return G.sections[0] || null;
  }

  /* ---------------- particles ---------------- */
  function burst(x, y, n, color, power, spread) {
    for (let i = 0; i < n; i++) {
      const a = spread ? rnd(0, Math.PI * 2) : rnd(Math.PI, Math.PI * 2);
      const sp = rnd(power * 0.3, power);
      G.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rnd(0.25, 0.6), max: 0.6, r: rnd(1.5, 3.6), color,
      });
    }
  }

  /* ---------------- game flow ---------------- */
  function resetRun() {
    G.state = "play";
    G.t = 0; G.score = 0; G.shardScore = 0; G.shards = 0; G.combo = 0; G.dist = 0;
    G.speed = BASE_SPEED; G.shake = 0; G.flash = 0;
    G.particles = [];
    G.trail = [];
    seedSections();
    G.player.x = 0;
    G.player.y = FLOOR_DEFAULT - PLAYER_H;
    G.player.vy = 0;
    G.player.dir = 1;
    G.player.grounded = true;
    G.player.squash = 0;
    G.player.visAngle = 0;
    G.player.shift = 0;
    seedDust();
    G.deadBy = "";
    hideScreens();
    updateHud();
  }

  function startGame() {
    sfx.start();
    resetRun();
  }

  function die(reason) {
    if (G.state !== "play") return;
    G.state = "over";
    G.deadBy = reason;
    G.shake = 16;
    G.flash = 0.55;
    sfx.die();
    const px = SCREEN_X + PLAYER_W / 2;
    const py = G.player.y + PLAYER_H / 2;
    burst(px, py, 34, C.failure, 460, true);
    burst(px, py, 14, C.gravity, 300, true);

    const isBest = G.score > best;
    if (isBest) { best = Math.round(G.score); store.set("best", best); }
    el.finalScore.textContent = Math.round(G.score).toLocaleString();
    el.finalDetail.textContent = Math.floor(G.dist / 10).toLocaleString() + " m • " + G.shards + " shards";
    el.newBest.style.display = isBest ? "block" : "none";
    el.overScreen.querySelector(".foot").textContent = "Best " + best.toLocaleString();
    el.best.textContent = best.toLocaleString();
    setTimeout(() => {
      if (G.state === "over") el.overScreen.classList.add("show");
    }, 620);
  }

  function flip() {
    if (G.state !== "play") return;
    const p = G.player;
    p.dir = -p.dir;
    p.vy = p.dir * 190;
    p.grounded = false;
    p.squash = 1;
    p.shift = SHIFT_MS / 1000;
    sfx.flip();
    G.particles.push({
      x: SCREEN_X + PLAYER_W / 2, y: p.y + PLAYER_H / 2,
      vx: 0, vy: -p.dir * 40, life: 0.26, max: 0.26, r: 16, color: "rgba(34,211,238,0.55)",
    });
  }

  function hideScreens() {
    el.titleScreen.classList.remove("show");
    el.pauseScreen.classList.remove("show");
    el.overScreen.classList.remove("show");
  }

  function pauseGame() {
    if (G.state !== "play") return;
    G.state = "paused";
    el.pauseScreen.classList.add("show");
  }
  function resumeGame() {
    if (G.state !== "paused") return;
    G.state = "play";
    el.pauseScreen.classList.remove("show");
  }

  function updateHud() {
    el.score.textContent = Math.round(G.score).toLocaleString();
    el.best.textContent = best.toLocaleString();
    if (G.combo > 1) {
      el.combo.textContent = "x" + G.combo;
      el.combo.classList.add("on");
    } else {
      el.combo.classList.remove("on");
    }
  }

  /* ---------------- update ---------------- */
  function update(dt) {
    // particles always animate
    for (let i = G.particles.length - 1; i >= 0; i--) {
      const p = G.particles[i];
      p.life -= dt;
      if (p.life <= 0) { G.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 900 * dt;
      p.vx *= 0.985;
    }
    G.shake = Math.max(0, G.shake - dt * 42);
    G.flash = Math.max(0, G.flash - dt * 2.2);

    if (G.state !== "play") return;

    G.t += dt;
    G.speed = BASE_SPEED + (MAX_SPEED - BASE_SPEED) * clamp(G.t / RAMP_SECONDS, 0, 1);

    const p = G.player;
    p.squash = Math.max(0, p.squash - dt * 4.5);
    p.shift = Math.max(0, p.shift - dt);
    const targetAngle = p.dir > 0 ? 0 : 180;
    p.visAngle += (targetAngle - p.visAngle) * Math.min(1, dt * 16);
    updateDust(dt, p.dir);

    p.x += G.speed * dt;
    G.dist += G.speed * dt;
    ensureSections(p.x);

    // physics
    p.vy += GRAV * p.dir * dt;
    p.y += p.vy * dt;

    const sec = sectionAt(p.x);
    if (sec) {
      p.grounded = false;
      if (p.dir > 0) {
        if (sec.hasFloor && p.y + p.h >= sec.floorY) {
          if (!p.grounded && p.vy > 300) { G.shake = Math.min(6, p.vy / 260); sfx.land(); burst(SCREEN_X + p.w / 2, sec.floorY, 6, C.gravity, 160, false); }
          p.y = sec.floorY - p.h;
          p.vy = 0;
          p.grounded = true;
        }
        if (!sec.hasFloor && p.y > H + 70) return die("pit");
      } else {
        if (sec.hasCeil && p.y <= sec.ceilY) {
          if (!p.grounded && p.vy < -300) { G.shake = Math.min(6, -p.vy / 260); sfx.land(); burst(SCREEN_X + p.w / 2, sec.ceilY, 6, C.gravity, 160, false); }
          p.y = sec.ceilY;
          p.vy = 0;
          p.grounded = true;
        }
        if (!sec.hasCeil && p.y + p.h < -70) return die("sky");
      }

      // spikes
      const pr = { x: SCREEN_X + 4, y: p.y + 3, w: p.w - 8, h: p.h - 6 };
      for (const s of sec.spikes) {
        const sx = s.x - (p.x - SCREEN_X);
        if (sx > W || sx + s.w < 0) continue;
        const sr = { x: sx + 5, y: s.dir < 0 ? s.y - s.h + 6 : s.y, w: s.w - 10, h: s.h - 6 };
        if (pr.x < sr.x + sr.w && pr.x + pr.w > sr.x && pr.y < sr.y + sr.h && pr.y + pr.h > sr.y) {
          return die("spike");
        }
      }

      // shards
      for (const c of sec.coins) {
        if (c.miss) continue;
        const cx = c.x - (p.x - SCREEN_X);
        if (!c.got) {
          const dx = (SCREEN_X + p.w / 2) - cx;
          const dy = (p.y + p.h / 2) - c.y;
          if (dx * dx + dy * dy < (c.r + 20) * (c.r + 20)) {
            c.got = true;
            G.combo += 1;
            G.shards += 1;
            const gain = 25 * Math.max(1, G.combo);
            G.shardScore += gain;
            G.score = Math.floor(G.dist / 12) + G.shardScore;
            sfx.shard(Math.min(G.combo, 8));
            burst(cx, c.y, 10, C.gravityHi, 260, true);
          }
        } else if (cx + c.r < SCREEN_X - 40) {
          c.miss = true;
        }
      }
    }

    // ambient trail
    G.trail.push({ x: SCREEN_X + p.w / 2, y: p.y + p.h / 2 });
    if (G.trail.length > 16) G.trail.shift();

    // score = distance + shard value
    G.score = Math.floor(G.dist / 12) + G.shardScore;
    updateHud();
  }

  /* ---------------- render ---------------- */
  let bgOffset = 0;

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /* ---------------- FLUX rig (art bible section 2.1) ---------------- */
  const dust = [];
  function seedDust() {
    dust.length = 0;
    for (let i = 0; i < 46; i++) {
      dust.push({ x: rnd(0, W), y: rnd(0, H), r: rnd(0.7, 1.8), a: rnd(0.05, 0.18) });
    }
  }
  function updateDust(dt, dir) {
    const vy = 30 * dir;
    for (const d of dust) {
      d.y += vy * dt;
      if (d.y < -8) d.y = H + 8;
      if (d.y > H + 8) d.y = -8;
    }
  }

  function drawSurface(x, y, w, active) {
    ctx.save();
    if (active) {
      ctx.shadowColor = "rgba(34,211,238,0.9)"; ctx.shadowBlur = 20;
      ctx.strokeStyle = "rgba(34,211,238,1)"; ctx.lineWidth = 2.4;
    } else {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(34,211,238,0.40)"; ctx.lineWidth = 1.5;
    }
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();
    ctx.restore();
  }

  function drawSpike(spx, sp) {
    const tipY = sp.dir < 0 ? sp.y - sp.h : sp.y + sp.h;
    // flat hazard fill, no gradient, hard edge (art bible section 3.1)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(spx, sp.y);
    ctx.lineTo(spx + sp.w / 2, tipY);
    ctx.lineTo(spx + sp.w, sp.y);
    ctx.closePath();
    ctx.fillStyle = C.failure;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = "rgba(5,7,11,0.55)";
    ctx.lineWidth = 2;
    for (let i = -sp.h; i < sp.w + sp.h; i += 7) {
      ctx.beginPath();
      ctx.moveTo(spx + i, sp.y);
      ctx.lineTo(spx + i + sp.h, tipY);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.shadowColor = "rgba(255,77,77,0.85)"; ctx.shadowBlur = 14;
    ctx.strokeStyle = "rgba(255,120,120,0.9)"; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(spx, sp.y);
    ctx.lineTo(spx + sp.w / 2, tipY);
    ctx.lineTo(spx + sp.w, sp.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawShiftFx() {
    const p = G.player;
    if (p.shift <= 0) return;
    const k = 1 - p.shift / (SHIFT_MS / 1000);
    const cx = SCREEN_X + p.w / 2, cy = p.y + p.h / 2;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(169,244,255," + (0.55 * (1 - k)) + ")";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 24 + k * 30, -Math.PI * 0.78, Math.PI * 0.22);
    ctx.stroke();
    ctx.strokeStyle = "rgba(34,211,238," + (0.45 * (1 - k)) + ")";
    ctx.beginPath();
    ctx.arc(cx, cy, 8 + k * 44, 0, 6.2832);
    ctx.stroke();
    if (k < 0.1) {
      ctx.fillStyle = "rgba(255,255,255," + (1 - k / 0.1) * 0.45 + ")";
      ctx.beginPath(); ctx.arc(cx, cy, 18, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  }

  function drawFlux(cx, cy, w, h, angleDeg, phase, grounded, squash, shift, dir) {
    const s = h / 30;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleDeg * Math.PI / 180);
    ctx.scale(1 + squash * 0.20, 1 - squash * 0.16);

    if (shift > 0) {
      const k = 1 - shift / (SHIFT_MS / 1000);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, w * 1.6);
      halo.addColorStop(0, "rgba(34,211,238," + (0.30 * (1 - k)) + ")");
      halo.addColorStop(1, "rgba(34,211,238,0)");
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(0, 0, w * 1.6, 0, 6.2832); ctx.fill();
      ctx.restore();
    }

    /* backpack: the asymmetry anchor, four cyan vents */
    ctx.fillStyle = C.graphite;
    roundRect(-w * 0.60, -h * 0.11, w * 0.30, h * 0.30, 2 * s); ctx.fill();
    ctx.strokeStyle = C.steel; ctx.lineWidth = 1 * s;
    roundRect(-w * 0.60, -h * 0.11, w * 0.30, h * 0.30, 2 * s); ctx.stroke();
    ctx.fillStyle = "rgba(34,211,238,0.85)";
    for (let i = 0; i < 4; i++) ctx.fillRect(-w * 0.55, -h * 0.08 + i * (h * 0.07), w * 0.10, 1.2 * s);

    /* legs: graphite undersuit, ivory shin plate, amber grip sole */
    const hipY = h * 0.06, footBase = h * 0.46;
    for (let i = 0; i < 2; i++) {
      const ph = phase + i * Math.PI;
      const stride = grounded ? Math.sin(ph) * w * 0.42 : (i ? 2.4 : -2.4) * s;
      const lift = grounded ? Math.max(0, Math.sin(ph)) * h * 0.06 : h * 0.03;
      const hipX = (i ? 2.4 : -2.4) * s;
      const footX = hipX + stride;
      const footY = footBase - lift;
      ctx.lineCap = "round";
      ctx.strokeStyle = C.graphite; ctx.lineWidth = 3.2 * s;
      ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(footX, footY); ctx.stroke();
      ctx.strokeStyle = C.ivory; ctx.lineWidth = 1.8 * s;
      ctx.beginPath();
      ctx.moveTo((hipX + footX) / 2, (hipY + footY) / 2);
      ctx.lineTo(footX, footY - 1.5 * s);
      ctx.stroke();
      ctx.fillStyle = C.graphite;
      roundRect(footX - 3.2 * s, footY - 1.2 * s, 6.8 * s, 3.0 * s, 1.3 * s); ctx.fill();
      ctx.fillStyle = (grounded && squash > 0.15) ? "#FFD27A" : C.hazard;
      ctx.fillRect(footX - 3.0 * s, footY + 1.5 * s, 6.2 * s, 1.3 * s);
    }

    /* torso: broad shoulders tapering to a narrow waist */
    ctx.beginPath();
    ctx.moveTo(-w * 0.38, -h * 0.16);
    ctx.lineTo(w * 0.38, -h * 0.16);
    ctx.lineTo(w * 0.24, h * 0.12);
    ctx.lineTo(-w * 0.24, h * 0.12);
    ctx.closePath();
    ctx.fillStyle = C.graphite; ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-w * 0.34, -h * 0.15);
    ctx.lineTo(w * 0.34, -h * 0.15);
    ctx.lineTo(w * 0.26, h * 0.01);
    ctx.lineTo(-w * 0.26, h * 0.01);
    ctx.closePath();
    const plate = ctx.createLinearGradient(0, -h * 0.15, 0, h * 0.01);
    plate.addColorStop(0, "#FFFFFF");
    plate.addColorStop(0.55, C.ivory);
    plate.addColorStop(1, "#A9B8C8");
    ctx.fillStyle = plate; ctx.fill();

    /* horizontal band breaking the vertical mass, so rotation stays readable */
    ctx.fillStyle = "rgba(143,160,179,0.85)";
    ctx.fillRect(-w * 0.28, h * 0.005, w * 0.56, 1.1 * s);

    /* energy core */
    ctx.save();
    ctx.shadowColor = "rgba(34,211,238,0.95)"; ctx.shadowBlur = 16 * s;
    const core = ctx.createRadialGradient(w * 0.06, -h * 0.06, 0.4 * s, w * 0.06, -h * 0.06, 3.6 * s);
    core.addColorStop(0, "#FFFFFF");
    core.addColorStop(0.5, C.gravityHi);
    core.addColorStop(1, C.gravity);
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(w * 0.06, -h * 0.06, 2.9 * s, 0, 6.2832); ctx.fill();
    ctx.restore();

    /* arm */
    const swing = grounded ? Math.sin(phase + Math.PI) * w * 0.30 : -w * 0.34;
    const shX = w * 0.30, shY = -h * 0.12;
    const handX = shX + swing, handY = shY + h * 0.20;
    ctx.lineCap = "round";
    ctx.strokeStyle = C.graphite; ctx.lineWidth = 3.0 * s;
    ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(handX, handY); ctx.stroke();
    ctx.strokeStyle = C.ivory; ctx.lineWidth = 1.7 * s;
    ctx.beginPath(); ctx.moveTo((shX + handX) / 2, (shY + handY) / 2); ctx.lineTo(handX, handY); ctx.stroke();
    ctx.fillStyle = C.hazard;
    ctx.beginPath(); ctx.arc(handX, handY + 0.6 * s, 1.5 * s, 0, 6.2832); ctx.fill();

    /* helmet and visor: the only face FLUX has */
    const headR = w * 0.26, headX = w * 0.10, headY = -h * 0.33;
    ctx.fillStyle = C.graphite;
    roundRect(-2.2 * s, -h * 0.23, 4.4 * s, h * 0.09, 1.4 * s); ctx.fill();
    const dome = ctx.createLinearGradient(headX - headR, headY - headR, headX + headR, headY + headR);
    dome.addColorStop(0, "#FFFFFF");
    dome.addColorStop(0.6, C.ivory);
    dome.addColorStop(1, "#9FB0C0");
    ctx.fillStyle = dome;
    ctx.beginPath(); ctx.arc(headX, headY, headR, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = "rgba(22,30,41,0.5)"; ctx.lineWidth = 0.9 * s;
    ctx.beginPath(); ctx.arc(headX, headY, headR, 0, 6.2832); ctx.stroke();

    ctx.save();
    ctx.shadowColor = "rgba(169,244,255,1)"; ctx.shadowBlur = 10 * s;
    ctx.fillStyle = C.gravityHi;
    roundRect(headX - headR * 0.62, headY - 1.1 * s, headR * 1.5, 2.4 * s, 1.2 * s);
    ctx.fill();
    ctx.restore();

    /* rim light from the gravity side */
    ctx.strokeStyle = "rgba(34,211,238,0.8)"; ctx.lineWidth = 1.2 * s;
    ctx.beginPath(); ctx.arc(headX, headY, headR * 0.98, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-w * 0.36, -h * 0.15); ctx.lineTo(w * 0.36, -h * 0.15); ctx.stroke();

    ctx.restore();
  }

  function render() {
    const cameraX = G.player.x - SCREEN_X;
    const p = G.player;

    ctx.save();
    if (G.shake > 0.2) {
      ctx.translate(rnd(-G.shake, G.shake) * 0.5, rnd(-G.shake, G.shake) * 0.5);
    }

    // background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, C.slate);
    bg.addColorStop(0.55, "#0E1720");
    bg.addColorStop(1, C.void);
    ctx.fillStyle = bg;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    // far parallax grid
    bgOffset = (cameraX * 0.25) % 64;
    ctx.fillStyle = "rgba(143,160,179,0.13)";
    for (let x = -bgOffset; x < W + 64; x += 64) {
      for (let y = 40; y < H; y += 64) {
        ctx.fillRect(x, y, 2, 2);
      }
    }

    // gravity wash, always aligned to the current vector
    const gTop = p.dir > 0 ? H : 0, gEnd = p.dir > 0 ? H - 300 : 300;
    const wash = ctx.createLinearGradient(0, gTop, 0, gEnd);
    wash.addColorStop(0, "rgba(34,211,238,0.11)");
    wash.addColorStop(1, "rgba(34,211,238,0)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, W, H);

    // drifting dust: the second gravity channel
    for (const d of dust) {
      ctx.fillStyle = "rgba(200,235,255," + d.a + ")";
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.2832); ctx.fill();
    }

    // speed streaks
    if (G.state === "play" && G.speed > 520) {
      const a = (G.speed - 520) / (MAX_SPEED - 520);
      ctx.strokeStyle = "rgba(169,244,255," + (0.05 + a * 0.1) + ")";
      ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const y = ((i * 97 + (cameraX * 0.6) % 400) % H);
        const x = (i * 173 + cameraX * 0.9) % (W + 300) - 150;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 60 + a * 90, y);
        ctx.stroke();
      }
    }

    // corridor
    for (const s of G.sections) {
      const sx = s.x - cameraX;
      if (sx > W + 60 || sx + s.w < -60) continue;

      if (s.hasFloor) {
        const fg = ctx.createLinearGradient(0, s.floorY, 0, H);
        fg.addColorStop(0, "rgba(22,30,41,0.97)");
        fg.addColorStop(1, "rgba(5,7,11,0.99)");
        ctx.fillStyle = fg;
        ctx.fillRect(sx, s.floorY, s.w + 1, H - s.floorY + 20);
        drawSurface(sx, s.floorY, s.w, p.dir > 0 && p.grounded);
      }

      if (s.hasCeil) {
        const cg = ctx.createLinearGradient(0, 0, 0, s.ceilY);
        cg.addColorStop(0, "rgba(5,7,11,0.99)");
        cg.addColorStop(1, "rgba(22,30,41,0.97)");
        ctx.fillStyle = cg;
        ctx.fillRect(sx, -20, s.w + 1, s.ceilY + 20);
        drawSurface(sx, s.ceilY, s.w, p.dir < 0 && p.grounded);
      }

      for (const sp of s.spikes) {
        const spx = sp.x - cameraX;
        if (spx > W + 40 || spx + sp.w < -40) continue;
        drawSpike(spx, sp);
      }

      for (const c of s.coins) {
        if (c.got) continue;
        const cx = c.x - cameraX;
        if (cx > W + 40 || cx < -40) continue;
        c.spin += 0.06;
        const sq = Math.abs(Math.cos(c.spin));
        ctx.save();
        ctx.translate(cx, c.y);
        ctx.scale(0.35 + sq * 0.65, 1);
        ctx.shadowColor = "rgba(34,211,238,0.95)";
        ctx.shadowBlur = 18;
        ctx.fillStyle = C.gravityHi;
        ctx.beginPath();
        ctx.moveTo(0, -c.r); ctx.lineTo(c.r, 0); ctx.lineTo(0, c.r); ctx.lineTo(-c.r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.beginPath();
        ctx.moveTo(0, -c.r * 0.5); ctx.lineTo(c.r * 0.5, 0); ctx.lineTo(0, c.r * 0.5); ctx.lineTo(-c.r * 0.5, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // trail
    if (G.trail.length > 1 && (G.state === "play" || G.state === "over")) {
      for (let i = 0; i < G.trail.length; i++) {
        const t = G.trail[i];
        const a = (i / G.trail.length) * 0.26;
        ctx.fillStyle = "rgba(34,211,238," + a + ")";
        const r = 11 * (i / G.trail.length);
        ctx.beginPath();
        ctx.arc(t.x, t.y, r + 2, 0, 6.2832);
        ctx.fill();
      }
    }

    drawShiftFx();

    if (G.state !== "over") {
      drawFlux(
        SCREEN_X + p.w / 2,
        p.y + p.h / 2,
        p.w + 2,
        p.h + 2,
        p.visAngle,
        G.dist * 0.022,
        p.grounded,
        p.squash,
        p.shift,
        p.dir
      );
    }

    // particles
    for (const q of G.particles) {
      const a = Math.max(0, q.life / q.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.r, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    if (G.flash > 0) {
      ctx.fillStyle = "rgba(255,77,77," + (G.flash * 0.32) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();
  }

  /* ---------------- loop ---------------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.034, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  /* ---------------- sizing ---------------- */
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = stage.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const sx = (rect.width * dpr) / W;
    const sy = (rect.height * dpr) / H;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
  }

  /* ---------------- input ---------------- */
  function primaryAction() {
    if (G.state === "title") { startGame(); return; }
    if (G.state === "over") { if (el.overScreen.classList.contains("show")) startGame(); return; }
    if (G.state === "paused") { resumeGame(); return; }
    flip();
  }

  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    e.preventDefault();
    primaryAction();
  });

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === " " || k === "arrowup" || k === "w" || k === "arrowdown" || k === "s") {
      e.preventDefault();
      primaryAction();
    } else if (k === "p" || k === "escape") {
      if (G.state === "play") pauseGame();
      else if (G.state === "paused") resumeGame();
    } else if (k === "m") {
      toggleMute();
    } else if (k === "r") {
      if (G.state === "play" || G.state === "paused" || G.state === "over") startGame();
    } else if (k === "enter" && (G.state === "title" || G.state === "over")) {
      startGame();
    }
  }, { passive: false });

  el.playBtn.addEventListener("click", (e) => { e.stopPropagation(); startGame(); });
  el.resumeBtn.addEventListener("click", (e) => { e.stopPropagation(); resumeGame(); });
  el.quitBtn.addEventListener("click", (e) => { e.stopPropagation(); startGame(); });
  el.againBtn.addEventListener("click", (e) => { e.stopPropagation(); startGame(); });

  function toggleMute() {
    muted = !muted;
    store.set("muted", muted);
    el.mute.textContent = muted ? "SOUND OFF" : "SOUND ON";
    el.mute.style.opacity = muted ? "0.5" : "1";
    if (!muted) sfx.flip();
  }
  el.mute.addEventListener("click", (e) => { e.stopPropagation(); toggleMute(); });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && G.state === "play") pauseGame();
  });

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 120));

  /* ---------------- boot ---------------- */
  el.mute.textContent = muted ? "SOUND OFF" : "SOUND ON";
  el.mute.style.opacity = muted ? "0.5" : "1";
  el.titleBest.textContent = "Best " + best.toLocaleString();
  el.best.textContent = best.toLocaleString();
  seedSections();
  seedDust();
  G.player.y = FLOOR_DEFAULT - PLAYER_H;
  resize();
  requestAnimationFrame(frame);

  // expose a tiny hook so the page can be smoke-tested
  window.__gravityShift = {
    state: () => G.state,
    score: () => Math.round(G.score),
    start: startGame,
    flip,
  };
})();
