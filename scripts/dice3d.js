// Shared with Grim FateRoll and Grim Pulse (same author). Class names use the gen- prefix so the modules can run together.
// A tiny software 3D renderer for polyhedral dice, drawn on a 2D canvas.
// The die never leaves its canvas, so it stays inside the sigil.
// Screen space: x right, y down, z toward the viewer.

const PHI = (1 + Math.sqrt(5)) / 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/* ---------- quaternions [w,x,y,z] ---------- */
const qMul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
];
const qNorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return q.map((v) => v / l); };
const qAxis = (axis, ang) => { const a = norm(axis), s = Math.sin(ang / 2); return [Math.cos(ang / 2), a[0] * s, a[1] * s, a[2] * s]; };
function qToMat(q) {
  const [w, x, y, z] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]
  ];
}
function qFromMat(m) {
  const t = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; q = [s / 4, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s]; }
  else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; q = [(m[2][1] - m[1][2]) / s, s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s]; }
  else if (m[1][1] > m[2][2]) { const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; q = [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s]; }
  else { const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4]; }
  return qNorm(q);
}
function qSlerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map((v) => -v); d = -d; }
  if (d > 0.9995) return qNorm(a.map((v, i) => v + (b[i] - v) * t));
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((v, i) => v * wa + b[i] * wb);
}
const mulMV = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

/* ---------- geometry ---------- */
function finish(verts, faces, textSize) {
  const radius = Math.max(...verts.map((v) => Math.hypot(...v)));
  const out = faces.map((idx) => {
    let [a, b, c] = idx.map((i) => verts[i]);
    let n = cross(sub(b, a), sub(c, a));
    const cen = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    if (dot(n, cen) < 0) { idx = [idx[0], idx[2], idx[1]]; n = [-n[0], -n[1], -n[2]]; }
    n = norm(n);
    const up = norm(sub(verts[idx[0]], cen));
    const right = cross(n, up);
    // rotation that brings this face toward the viewer with its number upright
    const land = qFromMat([right, [-up[0], -up[1], -up[2]], n]);
    return { idx, n, cen, up, right, land, value: 0 };
  });
  return { verts, faces: out, radius, textSize };
}

function icosahedron() {
  const v = [];
  for (const a of [-1, 1]) for (const b of [-PHI, PHI]) { v.push([0, a, b]); v.push([a, b, 0]); v.push([b, 0, a]); }
  const f = [];
  const near = (i, j) => Math.abs(Math.hypot(...sub(v[i], v[j])) - 2) < 1e-6;
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++)
    if (near(i, j) && near(j, k) && near(i, k)) f.push([i, j, k]);
  const poly = finish(v, f, 0.62);
  // opposite faces sum to 21, like a real d20
  let n = 1;
  for (const face of poly.faces) {
    if (face.value) continue;
    const opp = poly.faces.find((o) => !o.value && dot(o.n, face.n) < -0.999);
    face.value = n; if (opp) opp.value = 21 - n; n++;
  }
  return poly;
}

function tetrahedron() {
  const v = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  const poly = finish(v, [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]], 0.95);
  poly.faces.forEach((f, i) => (f.value = i + 1));
  return poly;
}

function octahedron() {
  const v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const f = [];
  for (const x of [0, 1]) for (const y of [2, 3]) for (const z of [4, 5]) f.push([x, y, z]);
  const poly = finish(v, f, 0.8);
  // opposite faces sum to 9, like a real d8
  let n = 1;
  for (const face of poly.faces) {
    if (face.value) continue;
    const opp = poly.faces.find((o) => !o.value && dot(o.n, face.n) < -0.999);
    face.value = n; if (opp) opp.value = 9 - n; n++;
  }
  return poly;
}

const POLY = {};
const BUILD = { d4: tetrahedron, d8: octahedron, d20: icosahedron };
const getPoly = (kind) => (POLY[kind] ??= (BUILD[kind] ?? icosahedron)());

/* ---------- colour ---------- */
function hexRgb(hex) {
  let h = String(hex ?? "").trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}/i.test(h)) return [42, 6, 7];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const rgb = (c, a = 1) => `rgba(${c.map((v) => Math.max(0, Math.min(255, Math.round(v)))).join(",")},${a})`;

export const DEFAULT_LOOK = { body: "#3a0709", label: "#f4e7cf", edge: "#e0242e" };

/* ---------- shared frame loop ---------- */
const actors = new Set();
let raf = 0, last = 0;
function frame(now) {
  const dt = Math.min(0.2, (now - last) / 1000 || 0.016); last = now;
  for (const a of actors) { try { a.tick(dt, now / 1000); } catch (e) { console.error("grim-encounter |", e); actors.delete(a); } }
  raf = actors.size ? requestAnimationFrame(frame) : 0;
}
export const Loop = {
  add(a) { actors.add(a); if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } },
  remove(a) { actors.delete(a); },
  clear() { actors.clear(); }
};

/* ---------- die ---------- */
export class Die {
  /** @param {"d20"|"d4"} kind */
  constructor(kind, look = {}) {
    this.kind = kind;
    this.poly = getPoly(kind);
    this.look = { ...DEFAULT_LOOK, ...look };
    this.body = hexRgb(this.look.body); this.label = hexRgb(this.look.label); this.edge = hexRgb(this.look.edge);
    this.el = document.createElement("canvas");
    this.el.className = `gen-d gen-d-${kind}`;
    this.ctx = this.el.getContext("2d");
    this.q = qNorm([Math.random(), Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
    this.axis = norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
    this.state = "idle"; this.t = 0; this.target = null; this.seed = Math.random() * 10;
    this.px = 0;
    Loop.add(this);
  }

  resize() {
    const css = this.el.clientWidth || 64;
    const px = Math.round(css * Math.min(2, window.devicePixelRatio || 1));
    if (px !== this.px) { this.px = px; this.el.width = px; this.el.height = px; this.dirty = true; }
  }

  /** Tumble, then settle with `value` facing the viewer. Resolves once at rest. */
  roll(value) {
    this.target = this.poly.faces.find((f) => f.value === value) ?? this.poly.faces[0];
    this.axis = norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() * 0.4 - 0.2]);
    // Coming out of a spin the die is already moving, so it needs less time to settle.
    const fromSpin = this.state === "spin";
    this.state = "tumble"; this.t = fromSpin ? 0.45 : 0;
    Loop.add(this);
    return new Promise((res) => (this._done = res));
  }

  /** Keep tumbling fast with no end, until roll(value) is called (the result is still on its way). */
  spin(reverse = false) {
    this.axis = norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() * 0.4 - 0.2]);
    this.state = "spin"; this.t = 0; this.dir = reverse ? -1 : 1;
    Loop.add(this);
  }

  tick(dt, now) {
    this.resize();
    if (this.state === "spin") {
      this.t += dt;
      const wob = [this.axis[0] + Math.sin(this.t * 5) * 0.4, this.axis[1], this.axis[2] + Math.cos(this.t * 4) * 0.4];
      this.q = qNorm(qMul(qAxis(wob, dt * 15 * (this.dir ?? 1)), this.q));
    } else if (this.state === "idle") {
      const wob = [Math.sin(now * 0.4 + this.seed) * 0.5, 1, Math.cos(now * 0.31 + this.seed) * 0.5];
      this.q = qNorm(qMul(qAxis(wob, dt * 0.85), this.q));
    } else if (this.state === "tumble") {
      this.t += dt;
      const k = Math.min(1, this.t / 1.05);
      const speed = 17 - 9 * k;
      const wob = [this.axis[0] + Math.sin(this.t * 5) * 0.4, this.axis[1], this.axis[2] + Math.cos(this.t * 4) * 0.4];
      this.q = qNorm(qMul(qAxis(wob, dt * speed), this.q));
      if (k >= 1) { this.state = "land"; this.t = 0; this.from = this.q; }
    } else if (this.state === "land") {
      this.t += dt;
      const k = Math.min(1, this.t / 0.55);
      const e = 1 - Math.pow(1 - k, 3);
      this.q = qSlerp(this.from, this.target.land, e);
      if (k >= 1) { this.q = this.target.land; this.state = "rest"; this.dirty = true; this._done?.(); this._done = null; }
    } else if (!this.dirty) return;
    this.draw();
    this.dirty = false;
    if (this.state === "rest") Loop.remove(this);
  }

  draw() {
    const { ctx, poly, px } = this;
    if (!px) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    const m = qToMat(this.q);
    const scale = (px * 0.44) / poly.radius;
    const persp = (z) => 1 / (1 - (z / poly.radius) * 0.13);
    const pts = poly.verts.map((v) => { const r = mulMV(m, v), p = persp(r[2]) * scale; return [px / 2 + r[0] * p, px / 2 + r[1] * p, r[2]]; });
    const L = norm([-0.45, -0.7, 0.75]);
    const faces = poly.faces.map((f) => ({ f, n: mulMV(m, f.n), c: mulMV(m, f.cen) })).sort((a, b) => a.c[2] - b.c[2]);
    const landed = this.state === "rest" || (this.state === "land" && this.t > 0.3);
    ctx.lineJoin = "round";
    for (const { f, n, c } of faces) {
      if (n[2] <= -0.02) continue;
      const top = landed && f === this.target;
      const diff = Math.max(0, dot(n, L));
      const lit = 0.42 + 0.95 * diff + (top ? 0.35 : 0);
      const spec = Math.pow(diff, 10) * 70;
      ctx.beginPath();
      f.idx.forEach((i, k) => (k ? ctx.lineTo(pts[i][0], pts[i][1]) : ctx.moveTo(pts[i][0], pts[i][1])));
      ctx.closePath();
      ctx.fillStyle = rgb(this.body.map((v) => v * lit + spec + 10 * diff));
      ctx.fill();
      ctx.lineWidth = px * (top ? 0.022 : 0.013);
      ctx.strokeStyle = rgb(this.edge.map((v) => v * (0.75 + 0.5 * diff)), top ? 1 : 0.9);
      ctx.stroke();
      // number, affinely mapped onto the face
      const facing = Math.max(0, n[2]);
      if (facing < 0.08) continue;
      const r = mulMV(m, f.right), u = mulMV(m, f.up);
      const p = persp(c[2]) * scale, k = p * 0.01;
      ctx.save();
      ctx.setTransform(r[0] * k, r[1] * k, -u[0] * k, -u[1] * k, px / 2 + c[0] * p, px / 2 + c[1] * p);
      ctx.globalAlpha = Math.min(1, Math.pow(facing, 0.6) * (landed && !top ? 0.55 : 1));
      ctx.fillStyle = rgb(this.label);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const size = 100 * poly.textSize;
      ctx.font = `700 ${size}px "GEN Num", Georgia, serif`;
      if (top) { ctx.shadowColor = rgb(this.label, 0.9); ctx.shadowBlur = px * 0.05; }
      const txt = String(f.value);
      ctx.fillText(txt, 0, size * 0.05);
      if (this.kind === "d20" && (f.value === 6 || f.value === 9)) ctx.fillRect(-size * 0.22, size * 0.46, size * 0.44, size * 0.07);
      ctx.restore();
    }
  }

  destroy() { Loop.remove(this); this.el.remove(); }
}
