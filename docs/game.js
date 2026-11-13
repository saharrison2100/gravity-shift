/* Gravity Shift — a one-touch gravity-flip runner.
   Pure Canvas 2D + Web Audio. No dependencies. */
(() => {
  "use strict";

  const W = 960, H = 540;
  const PROJECT = "gravity-shift";

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
    player: { x: 0, y: 300, w: PLAYER_W, h: PLAYER_H, vy: 0, dir: 1, grounded: false, squash: 0 },
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
    burst(px, py, 34, "#ff3d81", 460, true);
    burst(px, py, 14, "#22e6ff", 300, true);

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
    sfx.flip();
    G.particles.push({
      x: SCREEN_X + PLAYER_W / 2, y: p.y + PLAYER_H / 2,
      vx: 0, vy: -p.dir * 40, life: 0.22, max: 0.22, r: 16, color: "rgba(34,230,255,0.5)",
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
          if (!p.grounded && p.vy > 300) { G.shake = Math.min(6, p.vy / 260); sfx.land(); burst(SCREEN_X + p.w / 2, sec.floorY, 5, "#22e6ff", 150, false); }
          p.y = sec.floorY - p.h;
          p.vy = 0;
          p.grounded = true;
        }
        if (!sec.hasFloor && p.y > H + 70) return die("pit");
      } else {
        if (sec.hasCeil && p.y <= sec.ceilY) {
          if (!p.grounded && p.vy < -300) { G.shake = Math.min(6, -p.vy / 260); sfx.land(); burst(SCREEN_X + p.w / 2, sec.ceilY, 5, "#22e6ff", 150, false); }
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
            burst(cx, c.y, 10, "#ffd166", 260, true);
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

  function render() {
    const cameraX = G.player.x - SCREEN_X;

    ctx.save();
    if (G.shake > 0.2) {
      ctx.translate(rnd(-G.shake, G.shake) * 0.5, rnd(-G.shake, G.shake) * 0.5);
    }

    // background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#070c18");
    bg.addColorStop(0.55, "#080e1e");
    bg.addColorStop(1, "#04060e");
    ctx.fillStyle = bg;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    // parallax dots
    bgOffset = (cameraX * 0.25) % 64;
    ctx.fillStyle = "rgba(76, 132, 196, 0.20)";
    for (let x = -bgOffset; x < W + 64; x += 64) {
      for (let y = 40; y < H; y += 64) {
        ctx.fillRect(x, y, 2, 2);
      }
    }
    // horizon glow
    const glow = ctx.createRadialGradient(W * 0.5, H * 0.5, 40, W * 0.5, H * 0.5, W * 0.7);
    glow.addColorStop(0, "rgba(34, 230, 255, 0.055)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // speed streaks
    if (G.state === "play" && G.speed > 520) {
      const a = (G.speed - 520) / (MAX_SPEED - 520);
      ctx.strokeStyle = "rgba(120, 200, 255," + (0.05 + a * 0.1) + ")";
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
        fg.addColorStop(0, "rgba(20, 46, 78, 0.96)");
        fg.addColorStop(1, "rgba(6, 12, 24, 0.98)");
        ctx.fillStyle = fg;
        ctx.fillRect(sx, s.floorY, s.w + 1, H - s.floorY + 20);
        ctx.strokeStyle = "rgba(34, 230, 255, 0.85)";
        ctx.lineWidth = 2;
        ctx.shadowColor = "rgba(34, 230, 255, 0.75)";
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(sx, s.floorY);
        ctx.lineTo(sx + s.w, s.floorY);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      if (s.hasCeil) {
        const cg = ctx.createLinearGradient(0, 0, 0, s.ceilY);
        cg.addColorStop(0, "rgba(6, 12, 24, 0.98)");
        cg.addColorStop(1, "rgba(20, 46, 78, 0.96)");
        ctx.fillStyle = cg;
        ctx.fillRect(sx, -20, s.w + 1, s.ceilY + 20);
        ctx.strokeStyle = "rgba(34, 230, 255, 0.85)";
        ctx.lineWidth = 2;
        ctx.shadowColor = "rgba(34, 230, 255, 0.75)";
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(sx, s.ceilY);
        ctx.lineTo(sx + s.w, s.ceilY);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // spikes
      for (const sp of s.spikes) {
        const spx = sp.x - cameraX;
        if (spx > W + 40 || spx + sp.w < -40) continue;
        ctx.fillStyle = "#ff3d81";
        ctx.shadowColor = "rgba(255, 61, 129, 0.9)";
        ctx.shadowBlur = 16;
        ctx.beginPath();
        if (sp.dir < 0) {
          ctx.moveTo(spx, sp.y);
          ctx.lineTo(spx + sp.w / 2, sp.y - sp.h);
          ctx.lineTo(spx + sp.w, sp.y);
        } else {
          ctx.moveTo(spx, sp.y);
          ctx.lineTo(spx + sp.w / 2, sp.y + sp.h);
          ctx.lineTo(spx + sp.w, sp.y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // shards
      for (const c of s.coins) {
        if (c.got) continue;
        const cx = c.x - cameraX;
        if (cx > W + 40 || cx < -40) continue;
        c.spin += 0.06;
        const sq = Math.abs(Math.cos(c.spin));
        ctx.save();
        ctx.translate(cx, c.y);
        ctx.scale(0.35 + sq * 0.65, 1);
        ctx.fillStyle = "#ffd166";
        ctx.shadowColor = "rgba(255, 209, 102, 0.95)";
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.moveTo(0, -c.r);
        ctx.lineTo(c.r, 0);
        ctx.lineTo(0, c.r);
        ctx.lineTo(-c.r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
      }
    }

    // trail
    if (G.trail.length > 1 && (G.state === "play" || G.state === "over")) {
      for (let i = 0; i < G.trail.length; i++) {
        const t = G.trail[i];
        const a = (i / G.trail.length) * 0.3;
        ctx.fillStyle = "rgba(34, 230, 255," + a + ")";
        const r = 12 * (i / G.trail.length);
        ctx.beginPath();
        ctx.arc(t.x, t.y, r + 2, 0, 6.2832);
        ctx.fill();
      }
    }

    // player
    if (G.state !== "over") {
      const p = G.player;
      const sq = p.squash;
      const w = p.w * (1 + sq * 0.22), h = p.h * (1 - sq * 0.18);
      const x = SCREEN_X + (p.w - w) / 2, y = p.y + (p.h - h) / 2;
      ctx.shadowColor = "rgba(34, 230, 255, 0.9)";
      ctx.shadowBlur = 26;
      const pg = ctx.createLinearGradient(x, y, x, y + h);
      pg.addColorStop(0, "#b8fbff");
      pg.addColorStop(0.5, "#22e6ff");
      pg.addColorStop(1, "#0a86a8");
      ctx.fillStyle = pg;
      roundRect(x, y, w, h, 8);
      ctx.fill();
      ctx.shadowBlur = 0;
      // eye
      const eyeY = y + h * (p.dir > 0 ? 0.42 : 0.58);
      ctx.fillStyle = "#04121a";
      ctx.fillRect(x + w * 0.58, eyeY - 2, 4, 4);
      ctx.fillRect(x + w * 0.34, eyeY - 2, 4, 4);
    }

    // particles
    for (const p of G.particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    if (G.flash > 0) {
      ctx.fillStyle = "rgba(255, 61, 129," + (G.flash * 0.35) + ")";
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
