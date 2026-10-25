/**
 * Grim Encounter - Dice So Nice d20.
 *
 * Draws the initiative d20 with the player's real Dice So Nice look (theme, dice preset, texture, material,
 * font), by asking Dice So Nice itself to build the die mesh and render it. It is only ever an upgrade:
 * every step that can fail falls back to the canvas die in dice3d.js, so a missing / changed Dice So Nice
 * never breaks the encounter.
 *
 * One shared WebGL canvas covers the stage; each die is a mesh that follows an invisible placeholder element
 * in the column (so layout, clicks and the column's CSS keep working exactly as they do for the canvas die).
 */
import { Die, Loop } from "./dice3d.js";

const ID = "grim-encounter", DSN_ID = "dice-so-nice";
const CACHE_KEY = "grim-encounter";
const warn = (...a) => console.warn(`${ID} | DSN die`, ...a);

/* ---------- tiny vector helpers (plain arrays) ---------- */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Rotation matrix (rows) -> quaternion [x, y, z, w]. */
function quatFromMatrix(m) {
  const t = m[0][0] + m[1][1] + m[2][2];
  let x, y, z, w;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (m[2][1] - m[1][2]) / s; y = (m[0][2] - m[2][0]) / s; z = (m[1][0] - m[0][1]) / s; }
  else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; w = (m[2][1] - m[1][2]) / s; x = s / 4; y = (m[0][1] + m[1][0]) / s; z = (m[0][2] + m[2][0]) / s; }
  else if (m[1][1] > m[2][2]) { const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; w = (m[0][2] - m[2][0]) / s; x = (m[0][1] + m[1][0]) / s; y = s / 4; z = (m[1][2] + m[2][1]) / s; }
  else { const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; w = (m[1][0] - m[0][1]) / s; x = (m[0][2] + m[2][0]) / s; y = (m[1][2] + m[2][1]) / s; z = s / 4; }
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}

/* ---------- availability ---------- */
export function dsnDiceAvailable() {
  try {
    const d = game.dice3d;
    return !!(game.modules.get(DSN_ID)?.active && d?.DiceFactory?.create && d?.box?.diceScene?.constructor && d?.dice3dRenderers);
  } catch (e) { return false; }
}

/* ---------- face geometry: which way must the die turn to show value N? ---------- */
const frameCache = new WeakMap();

/**
 * Dice So Nice packs every face label into one atlas texture in 256 px tiles (row by row, edge tiles first),
 * and the mesh's UVs say which tile each triangle uses. Reading the triangles therefore tells us, for every
 * value, the outward normal and the "up" direction of its label - with no access to DSN's physics.
 * Returns Map(value -> { n, up }) or null when the die cannot be read reliably.
 */
function faceFrames(mesh, preset) {
  const g = mesh.geometry;
  if (frameCache.has(g)) return frameCache.get(g);
  let frames = null;
  try { frames = readFrames(mesh, preset, mesh.shape); } catch (e) { warn("could not read die faces", e); }
  frameCache.set(g, frames);
  return frames;
}

function readFrames(mesh, preset, kind) {
  const g = mesh.geometry, pos = g.attributes?.position, uv = g.attributes?.uv, idx = g.index;
  const N = { d20: 20, d8: 8 }[kind];
  if (!pos || !uv || !idx || !N) return null;
  const labels = Array.isArray(preset.labels?.[0]) ? preset.labels[0] : preset.labels;
  const values = preset.values;
  if (!labels || !values || values.length !== N) return null;
  const off = labels.length - values.length, perLine = Math.ceil(Math.sqrt(labels.length));
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  let atlas = mat?.map?.image?.width;
  if (!atlas) atlas = 2 ** Math.ceil(Math.log2(Math.sqrt(labels.length) * 256));
  const k = atlas / 256;

  const P = i => [pos.getX(i), pos.getY(i), pos.getZ(i)], T = i => [uv.getX(i), uv.getY(i)];
  const best = new Map();
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    const p0 = P(a), p1 = P(b), p2 = P(c), t0 = T(a), t1 = T(b), t2 = T(c);
    const e1 = sub(p1, p0), e2 = sub(p2, p0), nr = cross(e1, e2), area = len(nr) / 2;
    if (area < 1e-12) continue;
    const u = (t0[0] + t1[0] + t2[0]) / 3, v = (t0[1] + t1[1] + t2[1]) / 3;
    const tile = Math.floor(v * k) * perLine + Math.floor(u * k);
    if (tile < off || tile - off >= values.length) continue;   // an edge tile, not a face
    const value = values[tile - off];
    if (best.has(value) && best.get(value).area >= area) continue;
    // label "up" = the direction in which v decreases (the atlas is stored top row first)
    const du1 = t1[0] - t0[0], dv1 = t1[1] - t0[1], du2 = t2[0] - t0[0], dv2 = t2[1] - t0[1];
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-12) continue;
    const dPdv = [(du1 * e2[0] - du2 * e1[0]) / det, (du1 * e2[1] - du2 * e1[1]) / det, (du1 * e2[2] - du2 * e1[2]) / det];
    let n = unit(nr);
    const cen = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3];
    if (dot(n, cen) < 0) n = [-n[0], -n[1], -n[2]];
    let up = [-dPdv[0], -dPdv[1], -dPdv[2]];
    const d = dot(up, n); up = unit([up[0] - n[0] * d, up[1] - n[1] * d, up[2] - n[2] * d]);
    best.set(value, { n, up, area });
  }
  // sanity: every face found, and opposite faces add up to N + 1 (d20: 21, d8: 9)
  if (best.size !== N) return null;
  for (let v = 1; v <= N; v++) {
    const a = best.get(v)?.n, b = best.get(N + 1 - v)?.n;
    if (!a || !b || len([a[0] + b[0], a[1] + b[1], a[2] + b[2]]) > 0.05) return null;
  }
  return best;
}

/* ---------- the shared scene ---------- */
const Stage = {
  sc: null, layer: null, dice: new Set(), raf: 0, last: 0, failed: false, errors: 0, lastError: null, starting: null, size: [0, 0],

  /** Create the DSN scene once. Resolves true when ready. */
  async ensure(parent) {
    if (this.failed) return false;
    try {
      if (!this.sc) {
        this.starting ??= (async () => {
          const S = game.dice3d.box.diceScene;
          const layer = this.makeLayer();
          parent.appendChild(layer);
          const config = Object.assign({}, S.config, { rendererCacheKey: CACHE_KEY, dimensions: { width: innerWidth, height: innerHeight }, autoscale: false, scale: 60 });
          const sc = new S.constructor(layer, game.dice3d.DiceFactory, config);
          await sc.initialize();
          this.sc = sc; this.layer = layer; this.size = [innerWidth, innerHeight];
          this.tidy();
          addEventListener("resize", this.onResize);
        })();
        await this.starting;
      }
      this.attach(parent);
      return true;
    } catch (e) {
      warn("Dice So Nice scene unavailable, using the built-in dice", e);
      this.failed = true; this.starting = null;
      return false;
    }
  },

  makeLayer() {
    const l = document.createElement("div");
    l.className = "gen-dsn-layer";
    l.style.cssText = "position:fixed;inset:0;z-index:1;pointer-events:none;";
    return l;
  },

  /** The stage element is rebuilt for every encounter: move the canvas layer into the live one. */
  attach(parent) {
    if (!this.layer) return;
    if (this.layer.parentNode !== parent) parent.appendChild(this.layer);
    if (this.size[0] !== innerWidth || this.size[1] !== innerHeight) this.onResize();
  },

  tidy() {   // no table shadow: the die floats over the stage
    const sc = this.sc;
    if (sc.desk) sc.desk.visible = false;
    if (sc.light) sc.light.castShadow = false;
    const cv = sc.renderer.domElement;
    cv.style.cssText += ";position:absolute;left:0;top:0;pointer-events:none;";
  },

  onResize: () => {
    const s = Stage;
    if (!s.sc) return;
    try {
      s.sc.setScene({ width: innerWidth, height: innerHeight });
      s.size = [innerWidth, innerHeight]; s.tidy();
      for (const d of s.dice) s.sc.scene.add(d.mesh);   // setScene keeps the scene object; this is just a safety net
    } catch (e) { warn("resize failed", e); }
  },

  /** Screen pixel -> world position on the y = 0 plane (the camera looks straight down at it). */
  mapping() {
    const sc = this.sc, cam = sc.camera, [W, H] = this.size;
    cam.updateMatrixWorld();
    const at = (px, py) => {
      sc.raycaster.setFromCamera({ x: (px / W) * 2 - 1, y: -((py / H) * 2 - 1) }, cam);
      const { origin: o, direction: d } = sc.raycaster.ray, t = -o.y / d.y;
      return [o.x + d.x * t, o.z + d.z * t];
    };
    const a = at(0, 0), b = at(W, H);
    return { x0: a[0], z0: a[1], sx: (b[0] - a[0]) / W, sz: (b[1] - a[1]) / H };
  },

  /** Finished meshes waiting for the next die (a rebuild takes one instantly instead of building a new one). */
  pool: new Map(),
  take(key) { return this.pool.get(key)?.pop() ?? null; },
  give(key, mesh) {
    if (!key || !mesh) return;
    try { this.sc?.scene.remove(mesh); } catch (e) { /* ignore */ }
    const list = this.pool.get(key) ?? []; list.push(mesh); this.pool.set(key, list);
  },
  /** Build a few spare meshes in the background so adding / swapping / re-rolling dice never waits. */
  async warm(key, kind, app, want) {
    if (this.warming?.has(key)) return;
    (this.warming ??= new Set()).add(key);
    try {
      const F = game.dice3d.DiceFactory;
      while ((this.pool.get(key)?.length ?? 0) < want && !this.failed && this.sc) {
        await new Promise(r => setTimeout(r, 30));
        const m = await F.create(this.sc.renderer.scopedTextureCache, kind, app);
        if (!m) break;
        this.give(key, m);
      }
    } catch (e) { /* warming is only an optimisation */ }
    this.warming.delete(key);
  },

  add(die) { this.dice.add(die); this.sc.scene.add(die.mesh); if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); } },
  remove(die) {
    this.dice.delete(die);
    try { this.sc?.scene.remove(die.mesh); } catch (e) { /* ignore */ }
  },

  renderErrors: 0,
  fail(e, what) {
    this.lastError = `${what}: ${e?.message ?? e}`;
    warn(what, e);
    if (++this.errors >= 8) this.failed = true;   // give up for good only after repeated trouble
  },

  frame: (now) => {
    const s = Stage;
    s.raf = 0;
    if (!s.sc || !s.dice.size) return;
    const dt = Math.min(0.1, (now - s.last) / 1000 || 0.016); s.last = now;
    if (s.layer && !s.layer.isConnected) { for (const d of [...s.dice]) d.leave(); return; }   // stage closed
    try {
      const m = s.mapping();
      for (const d of [...s.dice]) {
        try { d.step(dt, now / 1000, m); }
        catch (e) { s.fail(e, "a die could not be positioned"); d.leave(); }   // only that die goes back to the canvas renderer
      }
      // DSN's own pipeline renders a "bloom mask" pass with globalBloom = 1 (every die shader outputs black in it) and
      // resets it afterwards; on a plain render the flag must be 0 or the dice come out black.
      const gb = game.dice3d.uniforms?.globalBloom, prev = gb?.value;
      if (gb) gb.value = 0;
      try { s.sc.renderScene(); } finally { if (gb) gb.value = prev; }
      s.renderErrors = 0;
    } catch (e) {
      s.fail(e, "render failed");
      // one bad frame is not the end of the 3D dice; three in a row is
      if (++s.renderErrors >= 3) { s.failed = true; for (const d of [...s.dice]) d.leave(); return; }
    }
    s.raf = requestAnimationFrame(s.frame);
  }
};

/* ---------- the die ---------- */
const SPEED_SPIN = 15, SPEED_IDLE = 0.85;

/**
 * Drop-in replacement for Die("d20"): same el / state / spin() / roll() / destroy(). Starts life as the plain
 * canvas die and swaps itself for the Dice So Nice mesh as soon as that is ready.
 */
export class DsnDie extends Die {
  /** @param {object} look canvas-die colours (fallback) @param {string|null} skin user id whose DSN look to use */
  constructor(kind, look, skin) {
    super(kind, look);
    this.skin = skin; this.mesh = null; this.on = false; this.value = null; this.rev = false;
    this.phase = "idle"; this.t = 0; this.axis = [0, 1, 0]; this.from = null; this.to = null; this.gone = false;
    this.wob = Math.random() * 10; this.punch = 0;
    // Until the Dice So Nice mesh is ready the placeholder stays invisible (no flash of the simple die); if it can never be
    // built, prep() gives the canvas die back.
    this.hidden = skinHasAppearance(skin) && dsnDiceAvailable() && !Stage.failed;
    if (this.hidden) this.el.style.visibility = "hidden";
    this.prep();
  }

  async prep() {
    this.retryPending = false;
    try {
      if (!this.hidden) return;
      // wait (frame by frame) until we are in the DOM: the stage element hosts the shared layer
      for (let i = 0; i < 120 && !this.el.isConnected && !this.gone; i++) await new Promise(r => requestAnimationFrame(r));
      const stage = this.el.closest(".efx-dice-stage");
      if (this.gone || !stage) return;
      if (!await Stage.ensure(stage)) return;
      const F = game.dice3d.DiceFactory;
      const app = F.getAppearanceForDice(game.users.get(this.skin).flags[DSN_ID].appearance, this.kind);
      const preset = F.resolvePreset(this.kind, app);
      if (!preset || preset.modelFile) return;                  // 3D-model presets have no readable faces: keep the canvas die
      this.key = `${this.kind}|${this.skin}|${JSON.stringify(app)}`;
      let mesh = Stage.take(this.key);
      if (!mesh) mesh = await F.create(Stage.sc.renderer.scopedTextureCache, this.kind, app);
      if (!mesh) return;
      if (this.gone) { Stage.give(this.key, mesh); return; }
      const frames = faceFrames(mesh, preset);
      if (!frames) return;
      mesh.geometry.boundingSphere || mesh.geometry.computeBoundingSphere();
      this.mesh = mesh; this.frames = frames; this.radius = mesh.geometry.boundingSphere.radius || 1;
      this.Q = mesh.quaternion.constructor; this.V = mesh.position.constructor;
      this.q0 = new this.Q(); this.q1 = new this.Q(); this.dq = new this.Q(); this.ax = new this.V();
      mesh.quaternion.set(Math.random() - .5, Math.random() - .5, Math.random() - .5, Math.random() * .5 + .5).normalize();
      this.adopt();
      Stage.warm(this.key, this.kind, app, this.kind === "d20" ? 4 : 2);
    } catch (e) {
      Stage.lastError = `prepare ${this.kind}: ${e?.message ?? e}`;
      warn("falling back to the built-in die", e);
      if (!this.retried && !this.gone) { this.retried = true; this.retryPending = true; setTimeout(() => this.prep(), 700); }   // textures may simply not have been ready
    } finally {
      if (!this.on && !this.retryPending) this.showCanvas();
    }
  }

  /** The canvas die is the fallback: make it visible. */
  showCanvas() { if (this.hidden) { this.hidden = false; this.el.style.visibility = ""; } }

  /** Switch from the canvas die to the mesh - but never in the middle of a landing. */
  adopt() {
    if (!this.mesh || this.on || this.gone) return;
    this.on = true; this.showCanvas();
    Loop.remove(this);
    try { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.el.width, this.el.height); } catch (e) { /* ignore */ }
    this.el.classList.add("gen-d-dsn");   // an empty placeholder now: it keeps the layout and clicks, the mesh is drawn over it
    this.el.style.visibility = "hidden";   // layout placeholder only; the mesh is drawn over it
    if (this.state === "spin") this.phase = "spin";
    else if ((this.state === "tumble" || this.state === "land") && this.value != null) {   // a roll already under way carries straight on
      this.phase = "tumble"; this.t = .35; this.axis = unit([Math.random() - .5, Math.random() - .5, Math.random() * .4 - .2]);
    }
    else if (this.state === "rest" && this.value != null) { this.phase = "rest"; this.point(this.value, 1); }
    else this.phase = "idle";
    Stage.add(this);
  }

  /** Give the die back to the canvas renderer (stage closed or the scene failed). */
  leave() {
    if (!this.on) return;
    Stage.remove(this); this.on = false;
    // a roll in flight must still finish: let the canvas die land on the same face
    if (this.done && this.value != null) { const d = this.done; this.done = null; super.roll(this.value).then(d); }
    this.el.classList.remove("gen-d-dsn"); this.hidden = false; this.el.style.visibility = "";
    this.dirty = true; Loop.add(this);
  }

  spin(reverse = false) {
    super.spin(reverse);
    if (this.on) Loop.remove(this);   // the hidden canvas die must not keep drawing
    this.rev = !!reverse; this.phase = "spin"; this.t = 0;
    this.axis = reverse ? unit([(Math.random() - .5) * .3, 1, (Math.random() - .5) * .3]) : unit([Math.random() - .5, Math.random() - .5, Math.random() * .4 - .2]);
  }

  roll(value) {
    this.value = value;
    if (!this.on) {
      // The canvas die rolls (invisibly while the mesh is still being prepared); if the mesh arrives mid-roll it takes over.
      const out = new Promise(res => { this.done = res; });
      super.roll(value).then(() => {
        if (this.on || !this.done) return;
        const d = this.done; this.done = null; this.adopt(); d();
      });
      return out;
    }
    this.t = this.phase === "spin" ? .45 : 0;   // coming out of a spin the die already moves, so it settles sooner
    this.state = "tumble"; this.phase = "tumble"; this.rev = false;
    this.axis = unit([Math.random() - .5, Math.random() - .5, Math.random() * .4 - .2]);
    return new Promise(res => { this.done = res; });
  }

  destroy() {
    this.gone = true;
    if (this.on) { Stage.remove(this); this.on = false; }
    if (this.mesh) { Stage.give(this.key, this.mesh); this.mesh = null; }
    super.destroy();
  }

  /** Rotate so `value` faces the camera, label upright. `k` = 1 snaps, otherwise returns the target in q1. */
  point(value, k = 1) {
    const f = this.frames.get(value) ?? this.frames.values().next().value;
    const r = cross(f.up, f.n);
    // M = X r^T + (-Z) u^T + Y n^T : maps (right, up, out) of the face onto screen (right, up, towards camera)
    const M = [
      [r[0], r[1], r[2]],
      [f.n[0], f.n[1], f.n[2]],
      [-f.up[0], -f.up[1], -f.up[2]]
    ];
    const [x, y, z, w] = quatFromMatrix(M);
    this.q1.set(x, y, z, w);
    if (k >= 1) this.mesh.quaternion.copy(this.q1);
    return this.q1;
  }

  turn(angle, axis) {
    this.ax.set(axis[0], axis[1], axis[2]).normalize();
    this.dq.setFromAxisAngle(this.ax, angle);
    this.mesh.quaternion.premultiply(this.dq).normalize();
  }

  step(dt, now, m) {
    const mesh = this.mesh, el = this.el;
    // follow the placeholder
    const r = el.getBoundingClientRect();
    const show = r.width > 4 && getComputedStyle(el).display !== "none";
    mesh.visible = show;   // (the animation below keeps running while hidden, so a roll always finishes)
    if (show) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      mesh.position.set(m.x0 + cx * m.sx, 0, m.z0 + cy * m.sz);
      const dropped = el.classList.contains("is-dropped");
      let s = (r.width * 0.5 * Math.abs(m.sx)) / this.radius * (dropped ? .78 : 1);
      if (this.punch > 0) { this.punch = Math.max(0, this.punch - dt * 3); s *= 1 + Math.sin(this.punch * Math.PI) * 0.07; }
      mesh.scale.set(s, s, s);
    }

    switch (this.phase) {
      case "spin": {
        this.t += dt;
        const w = [this.axis[0] + Math.sin(this.t * 5) * .4, this.axis[1] + (this.rev ? 0 : 0), this.axis[2] + Math.cos(this.t * 4) * .4];
        this.turn(dt * SPEED_SPIN * (this.rev ? -1 : 1), w);
        break;
      }
      case "tumble": {
        this.t += dt;
        const k = Math.min(1, this.t / 1.05), speed = 17 - 9 * k;
        this.turn(dt * speed, [this.axis[0] + Math.sin(this.t * 5) * .4, this.axis[1], this.axis[2] + Math.cos(this.t * 4) * .4]);
        if (k >= 1) { this.phase = "land"; this.t = 0; this.q0.copy(mesh.quaternion); this.point(this.value, 0); }
        break;
      }
      case "land": {
        this.t += dt;
        const k = Math.min(1, this.t / .55), e = 1 - Math.pow(1 - k, 3);
        mesh.quaternion.copy(this.q0).slerp(this.q1, e);
        if (k >= 1) {
          mesh.quaternion.copy(this.q1); this.phase = "rest"; this.state = "rest"; this.punch = 1;
          const d = this.done; this.done = null; d?.();
        }
        break;
      }
      case "idle": {
        this.turn(dt * SPEED_IDLE, [Math.sin(now * .4 + this.wob) * .5, 1, Math.cos(now * .31 + this.wob) * .5]);
        break;
      }
      default: break;   // rest
    }
    mesh.updateMatrixWorld();
  }
}

/** Does this user have a saved Dice So Nice appearance we can build a die from? */
function skinHasAppearance(userId) {
  try { return !!userId && !!game.users.get(userId)?.flags?.[DSN_ID]?.appearance; } catch (e) { return false; }
}

/** Console helper (merged into api.dsn.debug). */
export function dsnDiceDebug() {
  return { available: dsnDiceAvailable(), failed: Stage.failed, lastError: Stage.lastError, errors: Stage.errors, sceneReady: !!Stage.sc, active: [...Stage.dice].length };
}
export const _stage = Stage;
