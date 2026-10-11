/**
 * Grim Encounter  –  Foundry VTT V13-V14 / dnd5e
 * GM-only launcher -> pick scene, party and flame colour -> cinematic intro -> tokens added to the
 * real Combat -> one 3D d20 per player (simultaneous, skinned with Dice So Nice) -> NPCs roll silently
 * -> order announced as cards -> combat starts automatically. Follows Grim Core's theme when present.
 */
const ID = "grim-encounter";
const SOCKET = `module.${ID}`;

/* ------------------------------------------------------------------ */
/*  Back-end config (edit freely)                                      */
/* ------------------------------------------------------------------ */
const TITLE = "ENCOUNTER";
const SHOW_NPC_IN_ORDER = true;   // false = only list players in the initiative summary

const STYLES = {
  fire: {
    label: "Inferno", sep: "◆",
    phrases: ["Imminent Danger", "Watch Out!", "Get Ready To Fight", "Draw Your Weapons", "Enemies Approach", "Steel Yourself", "No Turning Back", "Blood Will Be Spilled"],
    t: { switch: 2100, leave: 5300, end: 6800, dice: 5600 },   // ms
    die: { h: 5, s: 78 }, colors: ["255,210,100", "255,120,30"]
  }
};

/* ------------------------------------------------------------------ */
/*  Flame colour                                                       */
/*  The fire is authored in orange. Any other colour is the same fire  */
/*  turned around the hue wheel (CSS hue-rotate on the fire layers).   */
/* ------------------------------------------------------------------ */
const FLAMES = [
  { id: "ember", name: "Ember", hex: "#ff7a1a" }, { id: "crimson", name: "Crimson", hex: "#e0262e" }, { id: "gold", name: "Gold", hex: "#ffc21a" },
  { id: "emerald", name: "Emerald", hex: "#2fd16a" }, { id: "azure", name: "Azure", hex: "#2f8bff" }, { id: "violet", name: "Violet", hex: "#9b5cff" },
  { id: "rose", name: "Rose", hex: "#ff4fa3" }
];
const DEFAULT_FLAME = FLAMES[0].hex, FIRE_BASE_HUE = 22;
const isHex = v => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

function flameOf(hex) {
  if (!isHex(hex)) hex = DEFAULT_FLAME;
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const sat = mx ? d / mx : 0;
  const rot = Math.round(((h - FIRE_BASE_HUE + 540) % 360) - 180);
  return {
    hex, rot,
    sat: sat < .5 ? Math.max(.1, sat * 2) : 1,                                  // grey picks give a pale flame
    bri: 1 + .35 * Math.max(0, Math.cos((h - 240) * Math.PI / 180)) * (sat < .5 ? 0 : 1)   // blues/violets read darker after the turn
  };
}
function paintFlame(el, hex) {
  const f = flameOf(hex);
  el.style.setProperty("--fire-rot", `${f.rot}deg`);
  el.style.setProperty("--fire-sat", f.sat.toFixed(2));
  el.style.setProperty("--fire-bri", f.bri.toFixed(2));
  return f;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** True when the OS asks for reduced motion. */
const calm = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */
Hooks.once("init", () => {
  game.settings.register(ID, "sound", {
    name: "Encounter stinger sound",
    hint: "Audio file played when an encounter starts (leave empty for none).",
    scope: "world", config: true, type: String, default: "", filePicker: "audio"
  });
  game.settings.register(ID, "dsn", {
    name: "Use Dice So Nice dice look",
    hint: "Skin the initiative d20 with each player's own Dice So Nice appearance (colorset, texture, material, font). Needs the Dice So Nice module; otherwise the style's default die is used.",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.settings.register(ID, "flame", { scope: "client", config: false, type: String, default: DEFAULT_FLAME });
  game.settings.register(ID, "panel", { scope: "client", config: false, type: Object, default: {} });
});

Hooks.once("ready", () => {
  syncGrimCore();
  setTimeout(syncGrimCore, 1500);   // Grim Core finishes applying its theme just after "ready"
  game.socket.on(SOCKET, onMessage);
  game.modules.get(ID).api = {
    open: openLauncher, launch,
    dsn: { look: dsnLook, debug: dsnDebug },
    syncTheme: syncGrimCore,
    preview: { intro: playIntro, dice: showDice, rolled: playRolled, order: playOrder, close: closeAll, decorate: decorateLauncher }
  };
});

function openLauncher() {
  if (!game.user.isGM) return ui.notifications.warn("Grim Encounter: only the Game Master can start an encounter.");
  EncounterPanel.toggle();
}

Hooks.on("getSceneControlButtons", controls => {
  if (!game.user.isGM) return;
  const tools = controls.tokens?.tools ?? controls.token?.tools;
  if (!tools) return;
  tools[ID] = {
    name: ID, title: "Grim Encounter", icon: "fa-solid fa-fire-flame-curved",
    order: Object.keys(tools).length + 1, button: true, visible: game.user.isGM,
    onChange: () => openLauncher()
  };
});

/* ------------------------------------------------------------------ */
/*  Launcher (GM only)                                                 */
/* ------------------------------------------------------------------ */
const PANEL_TEMPLATE = `modules/${ID}/templates/launcher.hbs`;

async function launcherContext() {
  const last = flameOf(game.settings.get(ID, "flame")).hex.toLowerCase();
  const scenes = game.scenes.contents
    .map(s => ({ id: s.id, name: s.name, key: s.name.toLowerCase(), thumb: s.thumb, active: s.active }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const actors = game.actors.contents
    .filter(a => a.type === "character" && a.hasPlayerOwner)
    .map(a => ({
      id: a.id, name: a.name, img: a.img,
      checked: game.users.some(u => u.active && !u.isGM && a.testUserPermission(u, "OWNER"))
    }));
  const preset = FLAMES.find(f => f.hex === last);
  const flames = FLAMES.map(f => ({ ...f, checked: f.hex === (preset?.hex ?? DEFAULT_FLAME) }));
  return { scenes, actors, flames, custom: { hex: last, set: !preset, checked: !preset }, flameName: preset?.name ?? "Custom", hasScenes: scenes.length > 0 };
}

/** GM launcher: a floating panel (not a Foundry window). Grab the header and it moves immediately; position is remembered per client. */
class EncounterPanel {
  static #inst = null;
  static toggle() {
    if (!game.user.isGM) return;
    if (EncounterPanel.#inst) return EncounterPanel.#inst.close();
    EncounterPanel.#inst = new EncounterPanel(); EncounterPanel.#inst.open();
  }

  async open() {
    const saved = game.settings.get(ID, "panel") ?? {};
    this.x = saved.x ?? Math.max(12, innerWidth - 480); this.y = saved.y ?? 90;
    const el = this.el = document.createElement("div");
    el.id = "efx-panel"; el.className = "efx-launcher efx-floating";
    el.innerHTML = `<form class="efx-panel-form"></form>`;
    document.body.appendChild(el);
    this.form = el.querySelector("form");
    await this.renderBody();
    this.clampPos(); this.place(); this.bind();
    this._onResize = () => { this.clampPos(); this.place(); };
    addEventListener("resize", this._onResize);
  }

  async renderBody() {
    const render = foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
    this.form.innerHTML = await render(PANEL_TEMPLATE, await launcherContext());
    decorateLauncher(this.el);
  }

  flameLabel() {
    const hex = flameOf(this.pickedFlame()).hex.toLowerCase();
    const n = this.el.querySelector(".efx-flame-name");
    if (n) n.textContent = FLAMES.find(f => f.hex === hex)?.name ?? "Custom";
  }

  place() { this.el.style.left = `${this.x}px`; this.el.style.top = `${this.y}px`; }
  clampPos() {
    const w = this.el.offsetWidth || 440;
    this.x = clamp(this.x, 0, Math.max(0, innerWidth - Math.min(w, 120)));
    this.y = clamp(this.y, 0, Math.max(0, innerHeight - 48));
  }
  save() { game.settings.set(ID, "panel", { x: Math.round(this.x), y: Math.round(this.y) }); }

  bind() {
    const el = this.el;
    // Grab the header = drag. Delegated, so it keeps working after any re-render.
    el.addEventListener("pointerdown", e => {
      const head = e.target.closest(".efx-compact-head");
      if (!head || e.button !== 0 || e.target.closest("button")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId); el.classList.add("efx-dragging");
      const move = ev => { this.x = clamp(ev.clientX - dx, 0, innerWidth - 80); this.y = clamp(ev.clientY - dy, 0, innerHeight - 40); this.place(); };
      const up = () => {
        head.removeEventListener("pointermove", move); head.removeEventListener("pointerup", up); head.removeEventListener("pointercancel", up);
        el.classList.remove("efx-dragging"); this.save();
      };
      head.addEventListener("pointermove", move); head.addEventListener("pointerup", up); head.addEventListener("pointercancel", up);
    });
    el.addEventListener("click", e => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "close") this.close(); else if (act === "preview") this.preview();
    });
    el.addEventListener("input", e => {
      if (e.target.name !== "flameCustom") return;
      const sw = e.target.closest(".efx-swatch");
      sw.style.setProperty("--sw", e.target.value); sw.classList.add("set");
      sw.querySelector('input[type="radio"]').checked = true; this.flameLabel();
    });
    el.addEventListener("change", e => { if (e.target.name === "flame") this.flameLabel(); });
    el.addEventListener("keydown", e => { if (e.key === "Escape") this.close(); });
    this.form.addEventListener("submit", e => { e.preventDefault(); this.start(); });
  }

  /** The flame colour currently picked in the form (a preset swatch or the custom picker). */
  pickedFlame() {
    const v = this.form.querySelector('input[name="flame"]:checked')?.value;
    return v === "custom" ? this.form.querySelector('input[name="flameCustom"]')?.value : v;
  }

  preview() {   // local only: no scene change, no combat
    onMessage({ action: "intro", style: "fire", flame: flameOf(this.pickedFlame()).hex });
  }

  async start() {
    if (!game.user.isGM) return;
    const fd = new FormData(this.form);
    const style = "fire", flame = flameOf(this.pickedFlame()).hex;
    const sceneId = fd.get("sceneId"), actorIds = fd.getAll("actor"), hostile = fd.has("hostile");
    await game.settings.set(ID, "flame", flame);
    this.close();
    launch({ sceneId, actorIds, hostile, style, flame });
  }

  close() {
    removeEventListener("resize", this._onResize);
    this.el?.remove();
    EncounterPanel.#inst = null;
  }
}

/** Visual decoration only (motes, parallax). */
function decorateLauncher(el) {
  if (!el || el._efxDecorated) return;
  el._efxDecorated = true;
  const motes = el.querySelector(".bg-motes");
  if (motes) {
    for (let i = 0; i < 22; i++) {
      const m = document.createElement("i");
      m.style.cssText = `left:${rand(0,100).toFixed(1)}%;--s:${rand(1.5,4).toFixed(1)}px;--d:${rand(8,18).toFixed(1)}s;--dl:-${rand(0,18).toFixed(1)}s;--dx:${rand(-22,22).toFixed(0)}px`;
      motes.appendChild(m);
    }
  }
  el.addEventListener("pointermove", ev => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    el.style.setProperty("--mx", ((ev.clientX-r.left)/r.width-.5).toFixed(3));
    el.style.setProperty("--my", ((ev.clientY-r.top)/r.height-.5).toFixed(3));
  });
}

/* ------------------------------------------------------------------ */
/*  GM orchestration                                                   */
/* ------------------------------------------------------------------ */
const GM = { combatId: null, pcs: new Map(), rolled: new Set(), finishing: false, style: "fire", flame: DEFAULT_FLAME };

function broadcast(msg) { game.socket.emit(SOCKET, msg); onMessage(msg); }
const ownersOf = c => game.users.filter(u => !u.isGM && c.actor?.testUserPermission(u, "OWNER"));

async function launch({ sceneId, actorIds = [], hostile = true, style = "fire", flame = DEFAULT_FLAME }) {
  if (!game.user.isGM) return;
  if (!STYLES[style]) style = "fire";
  const scene = game.scenes.get(sceneId);
  if (!scene) return ui.notifications.error("Grim Encounter: scene not found.");
  flame = flameOf(flame).hex;
  const T = STYLES[style].t, t0 = Date.now();
  GM.pcs = new Map(); GM.rolled = new Set(); GM.finishing = false; GM.combatId = null; GM.style = style; GM.flame = flame;

  broadcast({ action: "intro", style, flame });
  await sleep(T.switch);

  // 1) Move everyone to the target scene while the screen is covered
  const needActivate = !scene.active;
  const needView = game.scenes.viewed?.id !== scene.id;
  if (needActivate || needView) {
    const ready = new Promise(r => { Hooks.once("canvasReady", r); setTimeout(r, 6000); });
    if (needActivate) await scene.activate(); else await scene.view();
    await ready;
  }

  // 2) Real Combat document: find or create, then add tokens
  try {
    const combat = await ensureCombat(scene, actorIds, hostile);
    GM.combatId = combat.id;

    // 3) NPCs (and hidden combatants) roll silently; player characters wait for their own die
    const updates = [];
    for (const c of combat.combatants) {
      const owners = ownersOf(c);
      if (owners.length && !c.hidden) {
        GM.pcs.set(c.id, { id: c.id, name: c.name, img: c.img, player: owners.map(u => u.name).join(", "), owners: owners.map(u => u.id) });
      } else {
        const r = await rollInit(c);
        updates.push({ _id: c.id, initiative: r.total });
      }
    }
    if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
  } catch (err) {
    console.error(`${ID} | combat setup failed`, err);
    ui.notifications.error("Grim Encounter: failed to set up the Combat (see console).");
    return broadcast({ action: "close" });
  }

  await sleep(Math.max(0, T.dice - (Date.now() - t0)));
  if (!GM.pcs.size) { GM.finishing = true; return finishOrder(0); }
  broadcast({ action: "dice", dice: [...GM.pcs.values()], style, flame: GM.flame });
}

async function ensureCombat(scene, actorIds, hostile) {
  let combat = game.combats.find(c => c.scene?.id === scene.id);
  if (!combat) combat = await getDocumentClass("Combat").create({ scene: scene.id, active: true });
  if (!combat.active && typeof combat.activate === "function") await combat.activate();

  const wanted = new Set(actorIds), found = new Set(), data = [];
  for (const t of scene.tokens) {
    const isPC = t.actorId && wanted.has(t.actorId);
    const isFoe = hostile && t.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE;
    if (!isPC && !isFoe) continue;
    if (isPC) found.add(t.actorId);
    if (combat.combatants.some(c => c.tokenId === t.id)) continue;
    data.push({ tokenId: t.id, sceneId: scene.id, actorId: t.actorId, hidden: t.hidden });
  }
  if (data.length) await combat.createEmbeddedDocuments("Combatant", data);

  const missing = actorIds.filter(id => !found.has(id)).map(id => game.actors.get(id)?.name).filter(Boolean);
  if (missing.length) ui.notifications.warn(`No token in this scene for: ${missing.join(", ")}`);
  return combat;
}

async function rollInit(c) {
  const roll = c.getInitiativeRoll();
  await roll.evaluate();
  const d20 = roll.dice.find(d => d.faces === 20);
  const kept = d20?.results.find(r => r.active)?.result;
  return { nat: clamp(kept ?? Math.round(roll.total), 1, 20), total: roll.total };
}

async function gmRollOne(id, userId) {
  const combat = game.combats.get(GM.combatId);
  const c = combat?.combatants.get(id);
  const user = game.users.get(userId);
  if (!c || !user || !GM.pcs.has(id) || GM.rolled.has(id)) return;
  if (!user.isGM && !c.actor?.testUserPermission(user, "OWNER")) return;
  GM.rolled.add(id);
  const r = await rollInit(c);
  await c.update({ initiative: r.total });
  broadcast({ action: "rolled", id, nat: r.nat, total: Math.round(r.total * 100) / 100 });
  if (GM.rolled.size >= GM.pcs.size && !GM.finishing) { GM.finishing = true; finishOrder(2300); }
}

async function finishOrder(wait) {
  await sleep(wait);
  const combat = game.combats.get(GM.combatId);
  if (!combat) return broadcast({ action: "close" });
  const order = combat.combatants.contents
    .filter(c => !c.hidden && (SHOW_NPC_IN_ORDER || GM.pcs.has(c.id)))
    .sort((a, b) => (b.initiative ?? -999) - (a.initiative ?? -999))
    .map(c => ({ name: c.name, img: (c.actor?.img && !/mystery-man/.test(c.actor.img) ? c.actor.img : c.img), total: Math.round((c.initiative ?? 0) * 100) / 100, pc: GM.pcs.has(c.id) }));
  broadcast({ action: "order", order, style: GM.style, flame: GM.flame });
  await sleep(1800 + order.length * 110 + 3200);
  try { await combat.startCombat(); ui.combat?.activate?.(); } catch (e) { console.warn(`${ID} |`, e); }
  broadcast({ action: "close" });
}

/* ------------------------------------------------------------------ */
/*  Socket / client                                                    */
/* ------------------------------------------------------------------ */
function onMessage(msg) {
  switch (msg.action) {
    case "intro": return playIntro(msg);
    case "dice": return showDice(msg);
    case "rolled": return playRolled(msg);
    case "order": return playOrder(msg);
    case "close": return closeStage();
    case "rollRequest":
      if (game.users.activeGM?.isSelf) gmRollOne(msg.id, msg.userId);
  }
}

let rootEl = null;
const root = () => {
  if (!rootEl || !rootEl.isConnected) {
    rootEl = document.createElement("div"); rootEl.id = "efx-root"; document.body.appendChild(rootEl);
    syncGrimCore();
  }
  return rootEl;
};

/* ------------------------------------------------------------------ */
/*  Grim Core (optional hub that themes every Grim module together)    */
/*  Core restyles the launcher panel by itself (it owns the --ge-*     */
/*  tokens of #efx-panel). The full-screen stage lives outside the     */
/*  panel and exists on every player's screen, so we read Core's       */
/*  palette through its public API and apply it to #efx-root.          */
/* ------------------------------------------------------------------ */
function syncGrimCore() {
  try {
    const targets = [document.getElementById("efx-root"), document.getElementById("efx-panel")].filter(Boolean);
    const core = game.modules.get("grim-core");
    const palette = core?.active && typeof core.api?.palette === "function" ? core.api.palette() : null;
    for (const el of targets) {
      for (const k of [...el.style].filter(n => n.startsWith("--ge-"))) el.style.removeProperty(k);   // forget a previous theme
      if (!palette) continue;
      for (const [key, value] of Object.entries(palette)) el.style.setProperty(`--ge-${key}`, value);
      if (palette["accent-soft"]) el.style.setProperty("--ge-soft", palette["accent-soft"]);
    }
  } catch (e) { console.warn(`${ID} | Grim Core theme unavailable`, e); }
}
const live = { fx: new Set(), dsparks: null, run: 0 };
const track = fx => { live.fx.add(fx); return fx; };
function closeAll() {
  live.run++;
  for (const fx of live.fx) fx.stop?.();
  live.fx.clear();
  live.dsparks?.stop(); live.dsparks = null;
  root().replaceChildren();
}
function closeStage() {
  const stage = root().querySelector(".efx-dice-stage");
  if (!stage) return closeAll();
  const run = live.run;
  stage.classList.add("leaving");
  setTimeout(() => { if (live.run === run) closeAll(); }, 900);
}
const play = src => { try { if (src) foundry.audio.AudioHelper.play({ src, volume: 0.8, autoplay: true, loop: false }, false); } catch (e) { /* ignore */ } };

/* ------------------------------------------------------------------ */
/*  Sparks (2D canvas; additive embers or opaque blood)                */
/* ------------------------------------------------------------------ */
class Sparks {
  constructor(canvas) {
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.p = []; this.on = true; this.rain = 0;
    this.resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
    this.resize(); addEventListener("resize", this.resize);
    this.last = performance.now(); this.loop = this.loop.bind(this); requestAnimationFrame(this.loop);
  }
  stop() { this.on = false; removeEventListener("resize", this.resize); }
  burst(x, y, o = {}) {
    const { n = 40, speed = 420, life = [0.5, 1.2], size = [2, 5], colors = ["255,210,100", "255,120,30"],
      gravity = 500, angle = 0, spread = Math.PI * 2, add = true } = o;
    for (let i = 0; i < n && this.p.length < 1500; i++) {
      const a = angle + (Math.random() - 0.5) * spread, s = speed * rand(0.25, 1);
      this.p.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: gravity, life: 0, max: rand(...life),
        size: rand(...size), col: colors[(Math.random() * colors.length) | 0], add });
    }
  }
  loop(now) {
    if (!this.on) return;
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const { width: w, height: h } = this.c, ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    if (this.rain > 0) {
      const n = Math.round(this.rain * dt * 60);
      for (let i = 0; i < n; i++) this.burst(rand(0, w), h + 10, { n: 1, speed: rand(250, 800), angle: -Math.PI / 2, spread: 0.5, gravity: -30, life: [1.2, 3], size: [1.5, 4] });
    }
    this.p = this.p.filter(p => {
      p.life += dt; if (p.life >= p.max) return false;
      p.vy += p.g * dt; p.x += (p.vx + (p.add ? Math.sin(p.life * 7 + p.y * .01) * 14 : 0)) * dt; p.y += p.vy * dt;
      const a = 1 - p.life / p.max, r = p.size * (0.5 + a * 0.7);
      if (p.add) {
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.4);
        g.addColorStop(0, `rgba(${p.col},${a})`); g.addColorStop(1, `rgba(${p.col},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.4, 0, 6.283); ctx.fill();
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = `rgba(${p.col},${Math.min(1, a * 2)})`;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 0.8, r * (1 + Math.min(.55, Math.hypot(p.vx, p.vy) / 1800)), Math.atan2(p.vy, p.vx) - Math.PI / 2, 0, 6.283); ctx.fill();
      }
      return true;
    });
    requestAnimationFrame(this.loop);
  }
}

/* ------------------------------------------------------------------ */
/*  Fire (WebGL fbm shader) + 2D fallback                              */
/* ------------------------------------------------------------------ */
const FIRE_FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uT; uniform float uHi; uniform float uLo;
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y); }
float fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<6;i++){ v+=a*noise(p); p=p*2.02+vec2(1.7,9.2); a*=0.5; } return v; }
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; float asp=uRes.x/uRes.y; vec2 p=vec2(uv.x*asp,uv.y); float t=uT;
  vec2 q=vec2(p.x*2.4,p.y*1.7-t*1.1);
  vec2 w=vec2(fbm(q+vec2(0.0,t*0.3)),fbm(q+vec2(5.2,1.3-t*0.25)));
  float n=fbm(q+(w-0.5)*2.2+vec2(0.0,-t*0.5));
  float n2=fbm(vec2(p.x*5.0,p.y*1.2-t*1.6)+w*1.5);
  float r1=1.0-abs(fbm(vec2(p.x*3.2,p.y*1.1-t*1.9)+w*2.0)*2.0-1.0); r1=pow(r1,2.2);
  float rag=(n*0.5+n2*0.5)-0.5;
  float field=(uHi-uv.y)*1.5+rag*1.5+(r1-0.4)*0.45;
  float fieldLo=(uv.y-uLo)*1.5+rag*1.5+(r1-0.4)*0.45;
  float body=smoothstep(0.0,0.14,field)*smoothstep(0.0,0.14,fieldLo);
  float core=clamp(r1*1.25+(n-0.5)*0.9,0.0,1.0);
  float heat=0.12+core*0.95+rag*0.35-clamp(field,0.0,1.0)*0.2+(1.0-smoothstep(0.0,0.5,field))*0.4+(1.0-smoothstep(0.0,0.5,fieldLo))*0.3;
  heat=clamp(heat,0.0,1.35);
  vec3 c=vec3(0.18,0.01,0.0);
  c=mix(c,vec3(0.8,0.08,0.0),smoothstep(0.08,0.4,heat));
  c=mix(c,vec3(1.0,0.45,0.03),smoothstep(0.38,0.78,heat));
  c=mix(c,vec3(1.0,0.9,0.5),smoothstep(0.82,1.2,heat));
  float glow=smoothstep(-0.55,0.0,field)*(1.0-smoothstep(0.0,0.05,field))*0.5;
  vec3 col=c*body+vec3(1.0,0.4,0.05)*glow*0.55;
  float a=clamp(body*(0.78+0.22*smoothstep(0.1,0.5,heat))+glow*0.55,0.0,1.0);
  gl_FragColor=vec4(col,a);
}`;

class FireGL {
  constructor(canvas) {
    const k = 0.6; canvas.width = Math.round(innerWidth * k); canvas.height = Math.round(innerHeight * k);
    const gl = this.gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) throw new Error("no webgl");
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, "attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}"));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FIRE_FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = n => gl.getUniformLocation(prog, n);
    this.uRes = u("uRes"); this.uT = u("uT"); this.uHi = u("uHi"); this.uLo = u("uLo");
    gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0);
    this.canvas = canvas; this.loop = this.loop.bind(this);
  }
  start() { this.on = true; this.t0 = performance.now(); this.exitAt = null; requestAnimationFrame(this.loop); }
  exit() { this.exitAt = performance.now(); }
  stop() { this.on = false; this.gl.getExtension("WEBGL_lose_context")?.loseContext(); }
  loop(now) {
    if (!this.on) return;
    const gl = this.gl, t = (now - this.t0) / 1000;
    const hi = -0.1 + 1.7 * ss(0, 1.9, t);
    let lo = -1.0;
    if (this.exitAt) lo = -1.0 + 2.8 * ss(0, 1.4, (now - this.exitAt) / 1000);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uT, t); gl.uniform1f(this.uHi, hi); gl.uniform1f(this.uLo, lo);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(this.loop);
  }
}

class FireFallback {
  constructor(canvas) {
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.parts = []; this.emit = 1;
    this.resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
    this.resize(); addEventListener("resize", this.resize); this.loop = this.loop.bind(this);
  }
  start() { this.on = true; this.last = performance.now(); requestAnimationFrame(this.loop); }
  exit() { this.emit = 0; this.c.style.transition = "opacity 1.2s"; this.c.style.opacity = 0; }
  stop() { this.on = false; removeEventListener("resize", this.resize); }
  loop(now) {
    if (!this.on) return;
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const { width: w, height: h } = this.c, ctx = this.ctx, k = h / 900;
    ctx.globalCompositeOperation = "source-over"; ctx.clearRect(0, 0, w, h);
    for (let i = 0, n = Math.round((w / 18) * this.emit); i < n && this.parts.length < 1100; i++)
      this.parts.push({ x: rand(0, w), y: h + 20, vx: rand(-30, 30), vy: -rand(140, 560) * k, life: 0, max: rand(1, 2.4), size: rand(40, 120) * k });
    ctx.globalCompositeOperation = "lighter";
    this.parts = this.parts.filter(p => {
      p.life += dt; if (p.life >= p.max) return false;
      p.x += (p.vx + Math.sin(p.life * 6 + p.x) * 25) * dt; p.y += p.vy * dt;
      const a = p.life / p.max, col = a < .25 ? "255,225,140" : a < .55 ? "255,130,30" : "190,30,10", r = p.size * (1 - a * .4);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, `rgba(${col},${(1 - a) * .55})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.283); ctx.fill(); return true;
    });
    requestAnimationFrame(this.loop);
  }
}
const makeFire = canvas => { try { return new FireGL(canvas); } catch (e) { console.warn(`${ID} | WebGL fire unavailable, using fallback`, e); return new FireFallback(canvas); } };

/* ------------------------------------------------------------------ */
/*  Intro: shared scaffolding                                          */
/* ------------------------------------------------------------------ */
function trackHTML(S, reverse) {
  const list = reverse ? [...S.phrases].reverse() : [...S.phrases];
  const reps = Math.max(4, Math.ceil(24 / list.length));
  const half = Array.from({ length: reps }, () => list.map(p => `<span>${esc(p)}</span><i>${S.sep}</i>`).join("")).join("");
  return half + half;
}
const bannerHTML = style => `
  <div class="efx-banner">
    <div class="efx-band efx-band-top"><div class="efx-track">${trackHTML(STYLES[style], false)}</div></div>
    <div class="efx-title">${[...TITLE].map(ch => `<span class="ch">${esc(ch)}</span>`).join("")}</div>
    <div class="efx-band efx-band-bot"><div class="efx-track">${trackHTML(STYLES[style], true)}</div></div>
  </div>`;

function makeCtx(el, style) {
  const t0 = performance.now(), run = live.run;
  return {
    el, style, S: STYLES[style], alive: () => live.run === run,
    until: async ms => { const w = ms - (performance.now() - t0); if (w > 0) await sleep(w); return live.run === run; }
  };
}

async function finishIntro(ctx, onLeave) {
  if (!await ctx.until(ctx.S.t.leave)) return;
  ctx.el.classList.add("leave"); onLeave?.();
  if (!await ctx.until(ctx.S.t.end)) return;
  ctx.el.remove();
  for (const fx of [...live.fx]) if (fx.owner === ctx.el) { fx.stop?.(); live.fx.delete(fx); }
}
const own = (fx, ctx) => { fx.owner = ctx.el; return track(fx); };

async function playIntro({ style = "fire", flame = DEFAULT_FLAME } = {}) {
  if (!STYLES[style]) style = "fire";
  closeAll();
  const el = document.createElement("div");
  el.className = `efx-intro st-${style}`;
  paintFlame(el, flame);
  el.innerHTML = INTRO[style].html();
  root().appendChild(el);
  for (const tr of el.querySelectorAll(".efx-track")) tr.style.setProperty("--dur", `${Math.max(12, tr.scrollWidth / 2 / 160)}s`);
  play(game.settings.get(ID, "sound"));
  void el.offsetWidth; el.classList.add("on");
  try { await INTRO[style].run(makeCtx(el, style)); }
  catch (err) { console.error(`${ID} | intro "${style}" failed`, err); closeAll(); }
}

const centerOf = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

/* ------------------------------------------------------------------ */
/*  Intro style: FIRE (Default)                                        */
/* ------------------------------------------------------------------ */
const INTRO = {};
INTRO.fire = {
  html: () => `
    <div class="efx-dim"></div>
    <div class="efx-shaker">
      <canvas class="efx-fire"></canvas><canvas class="efx-sparks"></canvas>
      ${bannerHTML("fire")}
      <div class="efx-ring"></div>
    </div>
    <div class="efx-flash"></div>`,
  async run(ctx) {
    const { el } = ctx;
    const fire = own(makeFire(el.querySelector(".efx-fire")), ctx); fire.start();
    const sparks = own(new Sparks(el.querySelector(".efx-sparks")), ctx); sparks.rain = 1.6;
    if (!await ctx.until(1300)) return;
    const title = el.querySelector(".efx-title"), chars = [...title.querySelectorAll(".ch")];
    for (const ch of chars) {                                   // typewriter
      ch.classList.add("on");
      const [x, y] = centerOf(ch);
      sparks.burst(x, y, { n: 7, speed: 260, life: [.25, .6], size: [1.5, 3], gravity: 300 });
      await sleep(70); if (!ctx.alive()) return;
    }
    if (!await ctx.until(1300 + chars.length * 70 + 90)) return;
    title.classList.add("slam");                                // slam
    if (!await ctx.until(1300 + chars.length * 70 + 320)) return;
    el.classList.add("impact", "bands");
    const [cx, cy] = centerOf(title);
    sparks.burst(cx, cy, { n: 180, speed: 900, life: [.5, 1.4], size: [2, 6], gravity: 700 });
    sparks.burst(cx, cy, { n: 60, speed: 500, life: [.4, 1], size: [3, 7], gravity: 200, colors: ["255,255,230", "255,200,90"] });
    setTimeout(() => title.classList.add("glow"), 450);
    await finishIntro(ctx, () => { fire.exit(); sparks.rain = 0; });
  }
};

/* ------------------------------------------------------------------ */
/*  3D d20 (CSS icosahedron)                                           */
/* ------------------------------------------------------------------ */
const PHI = (1 + Math.sqrt(5)) / 2;
const VERTS = [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]];
const FACES = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a); return a.map(v => v / l); };

/* ------------------------------------------------------------------ */
/*  Dice So Nice look (read-only; DSN is optional)                     */
/*  A player's DSN customisation lives on their User document under    */
/*  flags["dice-so-nice"].appearance. We read it and paint the CSS die */
/*  with it; nothing is ever written back to DSN, and every lookup is  */
/*  guarded so a missing/changed DSN simply falls back to the default. */
/* ------------------------------------------------------------------ */
const DSN_ID = "dice-so-nice";
const dsnOn = () => !!game.modules.get(DSN_ID)?.active && game.settings.get(ID, "dsn");
const okColor = c => typeof c === "string" && c.trim() && (globalThis.CSS?.supports?.("color", c.trim()) ?? true);
const firstStr = v => Array.isArray(v) ? v.find(x => typeof x === "string") : (typeof v === "string" ? v : v?.name);

// Approximate looks for DSN's built-in colorsets, used only when the live colorset table cannot be reached.
const DSN_PRESETS = {
  white: { bg: ["#f2efe8"], fg: "#1b1b1b", outline: "#000000", edge: "#c9c4b8" },
  black: { bg: ["#1a1a1c"], fg: "#f2efe8", outline: "#000000", edge: "#000000" },
  fire: { bg: ["#f8d84f", "#f9b02d", "#f43c04", "#910200", "#4c1009"], fg: "#f8d84f", outline: "#000000", edge: "#910200" },
  ice: { bg: ["#214fa3", "#3c6ac1", "#253f70", "#0b56e2", "#09317a"], fg: "#ffffff", outline: "#0b1d44", edge: "#2a4a8c" },
  water: { bg: ["#1b5e8a", "#2f8fc7", "#0e3c5c"], fg: "#e8f6ff", outline: "#06202f", edge: "#2f8fc7" },
  acid: { bg: ["#a6ff00", "#83b625", "#5ace04", "#69f006", "#b0f006"], fg: "#162300", outline: "#ffffff", edge: "#5ace04" },
  poison: { bg: ["#313866", "#504099", "#66409e", "#934fc3", "#c949fc"], fg: "#ffffff", outline: "#1b0d33", edge: "#66409e" },
  earth: { bg: ["#6b4a2b", "#8a6a3f", "#3f2a16"], fg: "#f5e6c8", outline: "#1d1208", edge: "#3f2a16" },
  thunder: { bg: ["#ffd400", "#d6a800", "#7a5a00"], fg: "#1a1400", outline: "#ffffff", edge: "#7a5a00" },
  lightning: { bg: ["#bfe4ff", "#7ab8ff", "#2f5fcf"], fg: "#0a1a3a", outline: "#ffffff", edge: "#2f5fcf" },
  force: { bg: ["#7a1fb0", "#b34bf0", "#3d0a5c"], fg: "#ffffff", outline: "#1c0430", edge: "#b34bf0" },
  psychic: { bg: ["#c23a8d", "#ff7ac8", "#5c1240"], fg: "#ffffff", outline: "#2b0620", edge: "#ff7ac8" },
  necrotic: { bg: ["#1d2a1d", "#3c5a3c", "#0a120a"], fg: "#b8f0b8", outline: "#000000", edge: "#3c5a3c" },
  radiant: { bg: ["#fff3b0", "#ffd75e", "#c9962e"], fg: "#3a2a00", outline: "#ffffff", edge: "#c9962e" },
  bloodmoon: { bg: ["#8f171b", "#4a0e11", "#1d0508"], fg: "#eadfce", outline: "#000000", edge: "#a3161b" },
  bronze: { bg: ["#b0793a", "#8a5a25", "#5a3a14"], fg: "#fff3d6", outline: "#2a1a08", edge: "#5a3a14" },
  dragons: { bg: ["#8f171b", "#c24a1a", "#3a0a0a"], fg: "#ffd27a", outline: "#000000", edge: "#c24a1a" }
};

/** Best-effort access to DSN's live tables (names vary between DSN versions, hence the probing). */
function dsnTables() {
  const d3 = game.dice3d, C = d3?.constructor;
  const pick = (...c) => c.find(x => x && typeof x === "object");
  return {
    colorsets: pick(d3?.exports?.COLORSETS, d3?.exports?.DiceColors?.colors, C?.COLORSETS, C?.ALL_COLORSETS),
    textures: pick(C?.ALL_TEXTURE, d3?.exports?.TEXTURELIST, d3?.exports?.TEXTURES, C?.TEXTURELIST)
  };
}

function dsnTextureSrc(name, tables) {
  if (!name || name === "none") return null;
  const t = tables.textures?.[name];
  const src = typeof t === "string" ? t : (t?.source ?? t?.src ?? t?.composite);
  return typeof src === "string" && src ? src : null;
}

/** Resolve a user's DSN d20 look. Returns null when DSN is off / the user has no saved appearance. */
function dsnLook(userId) {
  try {
    if (!dsnOn()) return null;
    const app = game.users.get(userId)?.flags?.[DSN_ID]?.appearance;
    if (!app) return null;
    const merged = { ...(app.global ?? {}) };
    for (const [k, v] of Object.entries(app.d20 ?? {})) if (v !== undefined && v !== null && v !== "") merged[k] = v;
    const tables = dsnTables();
    let src = { bg: merged.diceColor, fg: merged.labelColor, outline: merged.outlineColor, edge: merged.edgeColor, texture: merged.texture, material: merged.material };
    const cs = merged.colorset;
    if (cs && cs !== "custom") {
      const live = tables.colorsets?.[cs], pre = DSN_PRESETS[cs];
      if (live) src = { bg: live.background ?? live.diceColor, fg: live.foreground ?? live.labelColor, outline: live.outline ?? live.outlineColor, edge: live.edge ?? live.edgeColor, texture: firstStr(live.texture) ?? merged.texture, material: live.material ?? merged.material };
      else if (pre) src = { ...pre, texture: merged.texture, material: merged.material };
    }
    const bg = [].concat(src.bg ?? []).filter(okColor).slice(0, 5);
    if (!bg.length) return null;
    return {
      cs: cs ?? "custom", bg,
      fg: okColor(src.fg) ? src.fg : "#ffffff",
      outline: okColor(src.outline) ? src.outline : "#000000",
      edge: okColor(src.edge) ? src.edge : bg[0],
      texture: dsnTextureSrc(firstStr(src.texture), tables),
      material: String(src.material ?? "plastic"),
      font: typeof merged.font === "string" && merged.font ? merged.font : null
    };
  } catch (e) { console.warn(`${ID} | Dice So Nice look unavailable`, e); return null; }
}

/** Console helper: game.modules.get("grim-encounter").api.dsn.debug(userId?) */
function dsnDebug(userId = game.user.id) {
  const d3 = game.dice3d, t = dsnTables();
  return {
    active: !!game.modules.get(DSN_ID)?.active, version: game.modules.get(DSN_ID)?.version, enabledInSettings: game.settings.get(ID, "dsn"),
    dice3d: !!d3, dice3dKeys: d3 ? Object.keys(d3) : [], exportsKeys: d3?.exports ? Object.keys(d3.exports) : [],
    colorsetTable: !!t.colorsets, textureTable: !!t.textures,
    appearance: game.users.get(userId)?.flags?.[DSN_ID]?.appearance ?? null, look: dsnLook(userId)
  };
}

const lightFor = (look, lit) => {
  const mat = look?.material ?? "plastic";
  const hi = mat === "metal" || mat === "chrome" ? 0.5 : 0.32, lo = mat === "metal" || mat === "chrome" ? 0.62 : 0.5;
  return `linear-gradient(160deg,rgba(255,255,255,${(lit * hi).toFixed(3)}),rgba(0,0,0,${(lo - lit * 0.36).toFixed(3)}))`;
};

function buildDie(die, L, { h = 5, s: sat = 78 } = {}, look = null) {
  const sc = L / 2, H = L * Math.sqrt(3) / 2, light = norm([-0.4, -0.7, 1]), front = [];
  const mat = look?.material;
  const sheen = mat === "metal" || mat === "chrome"
    ? `linear-gradient(115deg,transparent 28%,rgba(255,255,255,${mat === "chrome" ? .5 : .34}) 47%,transparent 64%),` : "";
  const baseOf = i => !look ? null
    : look.bg.length > 1 ? `linear-gradient(${120 + (i * 47) % 90}deg,${look.bg.join(",")})` : `linear-gradient(${look.bg[0]},${look.bg[0]})`;
  if (look) {
    die.style.setProperty("--num", look.fg);
    die.style.setProperty("--nsh", `0 0 3px ${look.outline},0 0 1px ${look.outline},0 1px 2px ${look.outline}`);
    if (look.font) die.style.setProperty("--nfont", `"${look.font.replace(/"/g, "")}",Georgia,serif`);
    if (mat === "glass") die.style.setProperty("--bop", ".8");
  }
  FACES.forEach((f, i) => {
    const [A, B, C] = f.map(k => VERTS[k].map(v => v * sc));
    const cen = [0, 1, 2].map(k => (A[k] + B[k] + C[k]) / 3);
    let ex = norm(sub(C, B));
    const M = [0, 1, 2].map(k => (B[k] + C[k]) / 2), ey = norm(sub(M, A));
    let n = cross(ex, ey);
    if (dot(n, cen) < 0) { ex = ex.map(v => -v); n = n.map(v => -v); }
    const P = [0, 1, 2].map(k => cen[k] - ex[k] * (L / 2) - ey[k] * (2 * H / 3));
    const el = document.createElement("div"); el.className = "efx-face";
    const lit = Math.max(0, dot(n, light));
    let body, edge, blend = "";
    if (look) {
      const layers = [lightFor(look, lit)];
      if (sheen) layers.push(sheen.slice(0, -1));
      if (look.texture) layers.push(`url("${look.texture}") center/160% auto`);
      layers.push(baseOf(i));
      body = layers.join(","); edge = look.edge;
      if (look.texture) blend = layers.map((_, k) => k === layers.length - 2 ? "soft-light" : "normal").join(",");
    } else {
      body = `linear-gradient(160deg,hsl(${h} ${sat}% ${26 + lit * 24}%),hsl(${h} ${Math.max(0, sat - 6)}% ${10 + lit * 12}%))`;
      edge = `hsl(${h} ${Math.min(sat, 30)}% 7%)`;
    }
    el.style.cssText = `width:${L}px;height:${H}px;--fs:${Math.round(L * 0.29)}px;--edge:${edge};--body:${body};` +
      (blend ? `--blend:${blend};` : "") + `transform:matrix3d(${[...ex, 0, ...ey, 0, ...n, 0, ...P, 1].join()})`;
    el.innerHTML = `<b>${i + 1}</b>`;
    die.appendChild(el);
    front.push([ex[0], ey[0], n[0], 0, ex[1], ey[1], n[1], 0, ex[2], ey[2], n[2], 0, 0, 0, 0, 1]);
  });
  return front;
}

function randMatrix() {
  let q = [0, 0, 0, 0].map(() => Math.random() * 2 - 1);
  const l = Math.hypot(...q); q = q.map(v => v / l);
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
}

/* ------------------------------------------------------------------ */
/*  Dice stage: 1 die per player, everyone rolls at the same time      */
/* ------------------------------------------------------------------ */
const TILT = -18, IDLE_MS = 5200;   // idle spin: one turn per 5.2 s, tilted toward the viewer
const stageEl = () => root().querySelector(".efx-dice-stage");

function showDice({ dice = [], style = "fire", flame = DEFAULT_FLAME } = {}) {
  if (!STYLES[style]) style = "fire";
  stageEl()?.remove(); live.dsparks?.stop();
  const F = flameOf(flame), n = dice.length;
  const S = { ...STYLES[style], die: { ...STYLES[style].die, h: (STYLES[style].die.h + F.rot + 360) % 360, s: F.sat < 1 ? Math.round(78 * F.sat) : 78 } };
  const L = n <= 3 ? 100 : n <= 5 ? 84 : n <= 7 ? 68 : 54;
  const size = Math.round(L * 3);
  const isGM = game.user.isGM;
  const stage = document.createElement("div");
  stage.className = `efx-dice-stage st-${style}`;
  paintFlame(stage, F.hex);
  stage.innerHTML = `
    <div class="efx-backdrop"></div>
    <canvas class="efx-sparks"></canvas>
    <div class="efx-headline">ROLL INITIATIVE</div>
    <div class="efx-dice-row"></div>
    <div class="efx-order"></div>
    ${isGM ? `<button type="button" class="efx-gm-roll">Roll All Remaining</button>` : ""}`;
  root().appendChild(stage);
  stage._sparks = live.dsparks = new Sparks(stage.querySelector(".efx-sparks"));
  stage._slots = new Map(); stage._L = L; stage._colors = S.colors;

  const row = stage.querySelector(".efx-dice-row");
  for (const d of dice) {
    const mine = isGM || d.owners.includes(game.user.id);
    const slot = document.createElement("div");
    slot.className = `efx-slot${mine ? " mine" : ""}`;
    slot.style.width = `${size * 1.05}px`;
    slot.innerHTML = `
      <div class="efx-aura"></div>
      <div class="efx-scene3d" style="width:${size}px;height:${size}px;perspective:${L * 9}px">
        <div class="efx-spin"><div class="efx-die ${mine ? "gm" : ""}"></div></div>
      </div>
      <div class="efx-res">${mine ? '<span class="hint">Click the die</span>' : '<span class="hint dim">Waiting...</span>'}</div>
      <div class="efx-name">${esc(d.name)}</div>
      <div class="efx-player">${esc(d.player)}</div>`;
    row.appendChild(slot);
    const die = slot.querySelector(".efx-die");
    const skin = d.owners?.includes(game.user.id) ? game.user.id : d.owners?.[0];
    const look = skin ? dsnLook(skin) : null;
    const front = buildDie(die, L, S.die, look);
    const spin = slot.querySelector(".efx-spin");
    const rest = randMatrix();                               // resting orientation while it idles
    die.style.transform = `matrix3d(${rest.join()})`;
    const idle = spin.animate([{ transform: `rotateX(${TILT}deg) rotateY(0deg)` }, { transform: `rotateX(${TILT}deg) rotateY(360deg)` }],
      { duration: IDLE_MS, iterations: Infinity });
    idle.currentTime = rand(0, IDLE_MS);
    const info = { id: d.id, el: slot, die, spin, scene: slot.querySelector(".efx-scene3d"), front, prev: rest, idle, anim: null, pending: false, done: false, look };
    stage._slots.set(d.id, info);
    if (mine) slot.addEventListener("click", () => requestRoll(info));
  }

  if (isGM) {
    stage.querySelector(".efx-gm-roll").addEventListener("click", () => {
      let i = 0;
      for (const id of GM.pcs.keys()) if (!GM.rolled.has(id)) setTimeout(() => gmRollOne(id, game.user.id), 250 * i++);
    });
    const onKey = ev => { if (ev.key === "Escape" && stageEl()) { removeEventListener("keydown", onKey); broadcast({ action: "close" }); } };
    addEventListener("keydown", onKey);
  }
}

function requestRoll(info) {
  if (info.pending || info.done) return;
  info.pending = true;
  info.el.classList.add("charging");
  try { info.idle.updatePlaybackRate(3.4); } catch (e) { /* ignore */ }   // spin faster in place while the roll is resolved
  if (game.user.isGM) gmRollOne(info.id, game.user.id);
  else game.socket.emit(SOCKET, { action: "rollRequest", id: info.id, userId: game.user.id });
}

async function playRolled({ id, nat, total }) {
  const stage = stageEl(); const info = stage?._slots.get(id);
  if (!info || info.done) return;
  info.done = true; info.pending = false;
  const { el, die, spin, scene, front } = info, sparks = stage._sparks, colors = stage._colors;
  el.classList.remove("charging"); el.classList.add("rolling");
  const resEl = el.querySelector(".efx-res"); resEl.innerHTML = "";
  const rect = () => centerOf(scene);
  try { play(CONFIG.sounds?.dice); } catch (e) { /* ignore */ }

  const trail = setInterval(() => {
    const [x, y] = rect();
    sparks.burst(x, y, { n: 3, speed: 150, life: [.3, .6], size: [1.5, 3], gravity: -60, colors });
  }, 55);

  // The die never leaves its spot: the wrapper spins it around its own vertical axis (picking up
  // speed, then slowing down) while the die itself turns from its resting pose to the rolled face.
  const target = front[nat - 1], D = 1900;
  let a0 = 0;
  try { a0 = (info.idle.effect.getComputedTiming().progress ?? 0) * 360; info.idle.cancel(); } catch (e) { /* ignore */ }
  const wind = a0 + 300, endA = Math.ceil((wind + 3.2 * 360) / 360) * 360;
  const anim = spin.animate([
    { transform: `rotateX(${TILT}deg) rotateY(${a0}deg)`, offset: 0, easing: "cubic-bezier(.45,0,1,1)" },
    { transform: `rotateX(${TILT - 10}deg) rotateY(${wind}deg)`, offset: .2, easing: "cubic-bezier(.12,.6,.22,1)" },
    { transform: `rotateX(0deg) rotateY(${endA}deg)`, offset: 1 }
  ], { duration: D, fill: "forwards" });
  const turn = die.animate([{ transform: `matrix3d(${info.prev.join()})` }, { transform: `matrix3d(${target.join()})` }],
    { duration: D, easing: "cubic-bezier(.25,.6,.25,1)", fill: "forwards" });
  info.anim?.cancel(); info.anim = anim;
  await anim.finished.catch(() => {});
  clearInterval(trail);
  if (!stageEl()) return;
  die.style.transform = `matrix3d(${target.join()})`; turn.cancel();
  spin.style.transform = "none"; anim.cancel();
  scene.animate([{ transform: "scale(1)" }, { transform: "scale(1.07)", offset: .4 }, { transform: "scale(1)" }], { duration: 380, easing: "ease-out" });

  const [cx, cy] = rect(), mod = Math.round(total) - nat;
  el.classList.remove("rolling"); el.classList.add("landed");
  const ring = document.createElement("div"); ring.className = "efx-ring"; scene.appendChild(ring); setTimeout(() => ring.remove(), 900);
  sparks.burst(cx, cy, { n: 36, speed: 520, life: [.4, 1], size: [2, 4.5], gravity: 600, colors });
  if (nat === 20) {
    el.classList.add("crit");
    sparks.burst(cx, cy, { n: 160, speed: 900, life: [.6, 1.6], size: [2, 6], gravity: 500, colors: ["255,230,120", "255,190,40", "255,255,230"] });
    flash(stage, "gold");
  } else if (nat === 1) {
    el.classList.add("fumble");
    sparks.burst(cx, cy, { n: 70, speed: 380, life: [.6, 1.4], size: [3, 6], gravity: 250, colors: ["200,20,10", "90,0,0"] });
    flash(stage, "red");
  }
  resEl.innerHTML = `<span class="nat">${nat}</span><span class="sum">${mod >= 0 ? "+" : "−"} ${Math.abs(mod)} = <b>${Math.round(total)}</b></span>`;
  info.prev = target;
}

function flash(stage, kind) {
  const f = document.createElement("div"); f.className = `efx-screenflash ${kind}`; stage.appendChild(f);
  setTimeout(() => f.remove(), 700);
}

function playOrder({ order = [], style = "fire", flame = DEFAULT_FLAME } = {}) {
  let stage = stageEl();
  if (!stage) { showDice({ dice: [], style, flame }); stage = stageEl(); }
  const el = stage.querySelector(".efx-order");
  const n = order.length;
  el.innerHTML = `<h2>INITIATIVE ORDER</h2><div class="efx-cards" style="--n:${Math.max(1, n)}">` + order.map((r, i) => {
    const dy = Math.round(-Math.sin((n > 1 ? i / (n - 1) : .5) * Math.PI) * 16);   // gentle arch across the row
    return `<div class="efx-card${r.pc ? " pc" : ""}" style="--i:${i};--dy:${dy}px">
      <img src="${esc(r.img ?? "icons/svg/mystery-man.svg")}" alt="">
      <span class="rk">${i + 1}</span><span class="nm">${esc(r.name)}</span><span class="tot">${Math.round(r.total)}</span></div>`;
  }).join("") + `</div>`;
  stage.classList.add("ordered");
  stage._sparks?.burst(innerWidth / 2, innerHeight * 0.3, { n: 90, speed: 700, life: [.5, 1.3], size: [2, 5], gravity: 450, colors: stage._colors });
}
