/**
 * Grim Encounter  –  Foundry VTT V13-V14 / dnd5e
 * GM-only launcher -> pick scene, party and flame colour -> cinematic intro -> tokens added to the
 * real Combat -> NPCs roll silently -> one column per player, behind it a stream of runes, where each
 * player clicks their die (skinned with Dice So Nice when present). The GM can add advantage,
 * disadvantage or +1d8, re-roll, and swap results; Alert characters may swap once.
 * The GM presses Begin Combat -> order announced as cards -> combat starts. Follows Grim Core's theme.
 */
import { Die, Loop, DEFAULT_LOOK } from "./dice3d.js";
import { DsnDie, dsnDiceAvailable, dsnDiceDebug } from "./dsn-dice.js";

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
  game.settings.register(ID, "dsnFull", {
    name: "Render the full Dice So Nice d20",
    hint: "On: the initiative d20 is drawn by Dice So Nice itself, so the player's Theme, Dice Preset, texture, material and font all show (not just the colours). Falls back to the simple die automatically if anything is missing. Needs \"Use Dice So Nice dice look\".",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.settings.register(ID, "freeReroll", {
    name: "Players may re-roll without Inspiration",
    hint: "Off (default): only the GM can re-roll a finished initiative; a player re-rolls by spending Heroic Inspiration. On: players get a free Reroll button too.",
    scope: "world", config: true, type: Boolean, default: false
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
    dsn: { look: dsnLook, debug: (id) => ({ ...dsnDebug(id), full: dsnDiceDebug() }) },
    syncTheme: syncGrimCore,
    preview: { intro: playIntro, dice: showDice, rolled: playRolled, inspired: playInspired, order: playOrder, close: closeAll, decorate: decorateLauncher }
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
      checked: true   // players are always ticked; the GM unticks anyone who should not join
    }));
  const preset = FLAMES.find(f => f.hex === last);
  const flames = FLAMES.map(f => ({ ...f, checked: f.hex === (preset?.hex ?? DEFAULT_FLAME) }));
  return { scenes, actors, flames, custom: { hex: last, set: !preset, checked: !preset }, flameName: preset?.name ?? "Custom", hasScenes: scenes.length > 0 };
}

/** A token whose actor belongs to a player: these only ever join through the Players list, never as enemies. */
const isPlayerToken = t => !!t?.actor?.hasPlayerOwner;

/**
 * NPC-type actors that a player owns (a Find Familiar, a summoned beast, a companion token...). They are not characters, so they
 * are not in the Players list; each of their tokens on the scene gets its own die, rolled by the owning player.
 */
const isPetToken = t => !!t?.actorId && !!t.actor?.hasPlayerOwner && t.actor.type !== "character";
function petTokens(scene) { return scene.tokens.filter(isPetToken).sort((a, b) => a.name.localeCompare(b.name)); }

const DISPO_ORDER = { [-1]: 0, 0: 1, 1: 2, [-2]: 3 };   // hostile, neutral, friendly, secret
const DISPO_CLASS = { [-1]: "hostile", 0: "neutral", 1: "friendly", [-2]: "secret" };
const byDispo = (a, b) => ((DISPO_ORDER[a.disposition] ?? 9) - (DISPO_ORDER[b.disposition] ?? 9)) || (a.hidden - b.hidden) || a.name.localeCompare(b.name);

/** Every token on a scene that can join as a non-player combatant: hostile first, then neutral, friendly, secret. */
function boardTokens(scene) {
  return scene.tokens.filter(t => t.actorId && !isPlayerToken(t)).sort(byDispo);
}
/** The hostile tokens that are visible: what "Start" pulls in when nothing is selected. */
function foeTokens(scene) {
  return boardTokens(scene).filter(t => t.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE && !t.hidden);
}
/** Tokens the GM currently has selected on the canvas (only possible for the scene being viewed). */
function selectedTokens(scene) {
  if (!scene || canvas?.scene?.id !== scene.id) return [];
  return (canvas.tokens?.controlled ?? []).map(t => t.document).filter(d => d?.actorId && !isPlayerToken(d)).sort(byDispo);
}
const foeImg = t => {
  const src = t.texture?.src;
  return src && !/\.(webm|mp4|m4v)$/i.test(src) ? src : (t.actor?.img || "icons/svg/mystery-man.svg");
};

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
    const sc = this.form.querySelector('select[name="sceneId"]');
    if (sc && canvas?.scene && game.scenes.has(canvas.scene.id)) sc.value = canvas.scene.id;   // the scene the GM is looking at
    this.renderBoard(); this.syncPlayers();
    this._onControl = foundry.utils.debounce(() => { if (this.useSelected() && Date.now() - (this._uiAt ?? 0) > 400) this.applyTicks(); }, 80);
    Hooks.on("controlToken", this._onControl);
    this._onScene = foundry.utils.debounce(() => this.renderBoard(), 120);
    for (const h of ["canvasReady", "createToken", "deleteToken", "updateToken"]) Hooks.on(h, this._onScene);
    this.clampPos(); this.place(); this.bind();
    this._onResize = () => { this.clampPos(); this.place(); };
    addEventListener("resize", this._onResize);
  }

  async renderBody() {
    const render = foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
    this.form.innerHTML = await render(PANEL_TEMPLATE, await launcherContext());
    decorateLauncher(this.el);
  }

  /** Players always start ticked (even when a fight is already running); the GM unticks anyone who should not join. */
  syncPlayers() {
    this.form.querySelectorAll('input[name="actor"]').forEach(i => { i.checked = true; });
    this.syncCounts();
  }

  /** True while the list follows the canvas selection (and clicking a chip also selects that token on the canvas). */
  useSelected() { return !!this.form.querySelector('input[name="useSel"]')?.checked; }

  /**
   * The list of every token on the board (hostile first). A chip is ticked when the token is part of the encounter:
   * the tokens selected on the canvas when there are any ("Selected tokens" on), otherwise the visible hostile ones.
   * Hidden tokens are only ticked when you select them yourself. Click a chip to tick / untick it.
   */
  renderBoard() {
    const box = this.form.querySelector(".efx-foe-strip"); if (!box) return;
    const scene = game.scenes.get(this.form.querySelector('select[name="sceneId"]')?.value);
    box.replaceChildren();
    const tokens = scene ? boardTokens(scene) : [];
    if (!tokens.length) {
      const p = document.createElement("p"); p.className = "efx-foe-empty";
      p.textContent = scene ? "No tokens on this scene" : "Pick a scene to list its tokens";
      box.append(p);
    }
    for (const t of tokens) {
      const lab = document.createElement("label");
      lab.className = `efx-actor-mini efx-foe-mini d-${DISPO_CLASS[t.disposition] ?? "neutral"}` + (t.hidden ? " is-hidden" : "");
      lab.title = `${t.name}${t.hidden ? " (hidden)" : ""}`;
      lab.dataset.token = t.id;
      const inp = document.createElement("input");
      inp.type = "checkbox"; inp.name = "foe"; inp.value = t.id;
      const img = document.createElement("img"); img.src = foeImg(t); img.alt = t.name;
      img.addEventListener("error", () => { img.src = "icons/svg/mystery-man.svg"; }, { once: true });
      const nm = document.createElement("span"); nm.textContent = t.name;
      lab.append(inp, img, nm);
      if (t.hidden) { const eye = document.createElement("i"); eye.className = "fa-solid fa-eye-slash efx-foe-eye"; lab.append(eye); }
      box.append(lab);
    }
    this.renderPets(scene);
    this.applyTicks();
  }

  /** Player-owned NPC tokens (familiars, summons): always ticked like the players, untick one to leave it out. */
  renderPets(scene) {
    const strip = this.form.querySelector(".efx-pet-strip"), label = this.form.querySelector(".efx-pets-label");
    if (!strip) return;
    const keep = new Set([...strip.querySelectorAll('input[name="pet"]')].filter(i => !i.checked).map(i => i.value));   // remember unticked ones across re-renders
    strip.replaceChildren();
    const pets = scene ? petTokens(scene) : [];
    strip.hidden = label.hidden = !pets.length;
    for (const t of pets) {
      const lab = document.createElement("label");
      lab.className = "efx-actor-mini efx-pet-mini";
      lab.title = `${t.name}${t.actor?.name && t.actor.name !== t.name ? ` (${t.actor.name})` : ""}`;
      const inp = document.createElement("input");
      inp.type = "checkbox"; inp.name = "pet"; inp.value = t.id; inp.checked = !keep.has(t.id);
      const img = document.createElement("img"); img.src = foeImg(t); img.alt = t.name;
      img.addEventListener("error", () => { img.src = "icons/svg/mystery-man.svg"; }, { once: true });
      const nm = document.createElement("span"); nm.textContent = t.name;
      lab.append(inp, img, nm);
      strip.append(lab);
    }
  }

  /** Tick the chips that match the canvas selection (or, with nothing selected, the visible hostile tokens). */
  applyTicks() {
    const scene = game.scenes.get(this.form.querySelector('select[name="sceneId"]')?.value);
    let want = new Set();
    if (scene) {
      const picked = this.useSelected() ? selectedTokens(scene) : [];
      want = new Set((picked.length ? picked : foeTokens(scene)).map(t => t.id));
    }
    this.form.querySelectorAll('input[name="foe"]').forEach(i => { i.checked = want.has(i.value); });
    this.syncCounts();
  }

  /** Mirror a chip click onto the canvas so the token is selected / released there too. */
  mirrorToCanvas(tokenId, on) {
    try {
      const scene = game.scenes.get(this.form.querySelector('select[name="sceneId"]')?.value);
      if (!scene || canvas?.scene?.id !== scene.id || !this.useSelected()) return;
      const obj = canvas.tokens?.get(tokenId);
      if (!obj) return;
      this._uiAt = Date.now();   // our own selection change: the hook below must not undo the ticks
      if (on) obj.control({ releaseOthers: false }); else obj.release();
    } catch (e) { /* cosmetic */ }
  }

  syncCounts() {
    const n = name => this.form.querySelectorAll(`input[name="${name}"]:checked`).length;
    const set = (k, v) => { const el = this.form.querySelector(`[data-count="${k}"]`); if (el) el.textContent = v; };
    set("foe", n("foe")); set("pc", n("actor") + n("pet")); set("board", this.form.querySelectorAll('input[name="foe"]').length);
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
    el.addEventListener("change", e => {
      const n = e.target.name;
      if (n === "flame") this.flameLabel();
      else if (n === "sceneId") { this.renderBoard(); this.syncPlayers(); }
      else if (n === "useSel") this.applyTicks();
      else if (n === "hostile") {   // quick select: every visible token on / off (hidden ones only when you pick them)
        this.form.querySelectorAll('input[name="foe"]').forEach(i => {
          const on = e.target.checked && !i.closest(".is-hidden");
          if (i.checked !== on) { i.checked = on; this.mirrorToCanvas(i.value, on); }
        });
        this.syncCounts();
      } else if (n === "foe") { this.mirrorToCanvas(e.target.value, e.target.checked); this.syncCounts(); }
      else if (n === "actor" || n === "pet") this.syncCounts();
    });
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
    const sceneId = fd.get("sceneId"), actorIds = fd.getAll("actor"), foeIds = fd.getAll("foe"), petIds = fd.getAll("pet");
    await game.settings.set(ID, "flame", flame);
    this.close();
    launch({ sceneId, actorIds, foeIds, petIds, style, flame });
  }

  close() {
    removeEventListener("resize", this._onResize);
    Hooks.off("controlToken", this._onControl);
    for (const h of ["canvasReady", "createToken", "deleteToken", "updateToken"]) Hooks.off(h, this._onScene);
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
/*  Only the active GM's client rolls, writes initiative to the Combat  */
/*  and checks who may swap; everyone else just plays what it sends.   */
/* ------------------------------------------------------------------ */
const GM = {
  combatId: null, pcs: new Map(), part: new Set(), rewound: new Set(), results: new Map(), mods: new Map(), alertUsed: new Set(),
  finishing: false, swapping: false, style: "fire", flame: DEFAULT_FLAME
};

function broadcast(msg) { game.socket.emit(SOCKET, msg); onMessage(msg); }
const ownersOf = c => game.users.filter(u => !u.isGM && c.actor?.testUserPermission(u, "OWNER"));

/**
 * foeIds = the enemy tokens the GM ticked. Omit it (API use) and every *visible* hostile token is pulled;
 * hidden tokens are only ever added when they are named in foeIds.
 * selected: true = use the tokens selected on the canvas instead (when foeIds is omitted).
 */
async function launch({ sceneId, actorIds = [], foeIds = null, petIds = null, hostile = true, selected = false, style = "fire", flame = DEFAULT_FLAME }) {
  if (!game.user.isGM) return;
  if (!STYLES[style]) style = "fire";
  const scene = game.scenes.get(sceneId);
  if (!scene) return ui.notifications.error("Grim Encounter: scene not found.");
  flame = flameOf(flame).hex;
  const T = STYLES[style].t, t0 = Date.now();
  Object.assign(GM, { pcs: new Map(), part: new Set(), rewound: new Set(), results: new Map(), mods: new Map(), alertUsed: new Set(), finishing: false, swapping: false, combatId: null, style, flame });

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
    const { combat, picked } = await ensureCombat(scene, actorIds, petIds ?? petTokens(scene).map(t => t.id), foeIds ?? (selected ? selectedTokens(scene).map(t => t.id) : hostile ? foeTokens(scene).filter(t => !t.hidden).map(t => t.id) : []));
    GM.combatId = combat.id;

    // 3) NPCs (and hidden combatants) roll silently; player characters wait for their own die
    // A fight already running = reinforcements: enemies that already hold an initiative keep their place,
    // players are only rolled when they were ticked, and the combat is not restarted (see finishOrder).
    const reinforce = !!combat.started;
    const updates = [];
    for (const c of combat.combatants) {
      if (!picked.has(c.tokenId)) continue;   // not chosen for this encounter: leave it alone
      const owners = ownersOf(c);
      const isPC = owners.length && !c.hidden;
      if (!isPC && reinforce && c.initiative != null) continue;
      GM.part.add(c.id);
      if (isPC) {
        GM.pcs.set(c.id, { id: c.id, name: c.name, img: c.img, player: owners.map(u => u.name).join(", "), owners: owners.map(u => u.id), alert: hasAlert(c.actor), insp: hasInspiration(c.actor) });
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
  broadcast({ action: "dice", dice: [...GM.pcs.values()], mods: {}, style, flame: GM.flame });
}

async function ensureCombat(scene, actorIds, petIds, foeIds) {
  let combat = game.combats.find(c => c.scene?.id === scene.id);
  if (!combat) combat = await getDocumentClass("Combat").create({ scene: scene.id, active: true });
  if (!combat.active && typeof combat.activate === "function") await combat.activate();

  const wanted = new Set(actorIds), pets = new Set(petIds), foes = new Set(foeIds), found = new Set(), picked = new Set(), data = [];
  for (const t of scene.tokens) {
    const isPC = t.actorId && wanted.has(t.actorId);
    const isPet = pets.has(t.id) && isPetToken(t);
    const isFoe = foes.has(t.id) && !isPlayerToken(t);
    if (!isPC && !isPet && !isFoe) continue;
    if (isPC) found.add(t.actorId);
    picked.add(t.id);
    if (combat.combatants.some(c => c.tokenId === t.id)) continue;
    data.push({ tokenId: t.id, sceneId: scene.id, actorId: t.actorId, hidden: t.hidden });
  }
  if (data.length) await combat.createEmbeddedDocuments("Combatant", data);

  const missing = actorIds.filter(id => !found.has(id)).map(id => game.actors.get(id)?.name).filter(Boolean);
  if (missing.length) ui.notifications.warn(`No token in this scene for: ${missing.join(", ")}`);
  return { combat, picked };
}

/**
 * Roll a combatant's initiative. The system's own initiative formula is the starting point
 * (ability modifier, bonuses, tiebreaker); the GM's choices are layered on top of it:
 * advantage / disadvantage replaces the d20 with 2d20kh / 2d20kl, +1d4 and +1d8 are added.
 * Returns { d20: [each d20], nat: the kept d20, bonus: [{ faces, value }], total }.
 */
async function rollInit(c, mods = NO_MODS) {
  const base = c.getInitiativeRoll();
  let formula = base.formula;
  const keep = mods.adv ? "kh" : mods.dis ? "kl" : null;
  if (keep) formula = formula.replace(/\b\d*d20(k[hl]\d*)?/i, `2d20${keep}`);
  if (mods.d4) formula += " + 1d4";
  if (mods.d8) formula += " + 1d8";
  const roll = formula === base.formula ? base : new Roll(formula, base.data);
  await roll.evaluate();
  const d20 = roll.dice.find(d => d.faces === 20);
  const d20s = (d20?.results ?? []).map(r => r.result);
  const kept = d20?.results.find(r => r.active)?.result;
  const bonus = roll.dice.filter(d => d.faces === 4 || d.faces === 8).flatMap(d => d.results.map(r => ({ faces: d.faces, value: r.result })));
  const nat = clamp(kept ?? d20s[0] ?? Math.round(roll.total), 1, 20);
  return { d20: d20s.length ? d20s : [nat], nat, bonus, total: Math.round(roll.total * 100) / 100 };
}

async function gmRollOne(id, userId, reroll = false) {
  const combat = game.combats.get(GM.combatId);
  const c = combat?.combatants.get(id);
  const user = game.users.get(userId);
  if (!c || !user || !GM.pcs.has(id) || GM.finishing || GM.swapping) return;
  if (GM.results.has(id) && GM.results.get(id) === null) return;   // a roll for this die is already in flight
  if (!user.isGM && !c.actor?.testUserPermission(user, "OWNER")) return;
  // A finished die rolls again only for: the GM's Reroll button, a die rewound by Inspiration, or the free-reroll setting.
  if (GM.results.has(id)) {
    const ok = (reroll && (user.isGM || game.settings.get(ID, "freeReroll"))) || GM.rewound.has(id);
    if (!ok) return;
  }
  const prev = GM.results.get(id), wasRewound = GM.rewound.has(id);
  GM.results.set(id, null);   // in flight: a double click cannot start two rolls at once
  try {
    const r = await rollInit(c, GM.mods.get(id) ?? NO_MODS);
    await c.update({ initiative: r.total });
    GM.results.set(id, r); GM.rewound.delete(id);
    broadcast({ action: "rolled", id, result: r });
  } catch (err) {
    console.error(`${ID} | initiative roll failed`, err);
    if (prev) GM.results.set(id, prev); else GM.results.delete(id);
    if (wasRewound) GM.rewound.add(id);
    ui.notifications.error(`Grim Encounter: could not roll initiative for ${c.name}.`);
  }
}

/**
 * Spend Heroic Inspiration to roll again. The actor's Inspiration is used up, the finished result is thrown away
 * (the combatant has no initiative until the new roll) and the column rewinds until its die is rolled again.
 */
async function gmInspire(id, userId) {
  const combat = game.combats.get(GM.combatId);
  const c = combat?.combatants.get(id), user = game.users.get(userId);
  if (!c || !user || !GM.pcs.has(id) || GM.finishing || GM.swapping) return;
  const r = GM.results.get(id);
  if (!r || GM.rewound.has(id)) return;   // only a finished roll can be undone, and only once per Inspiration
  if (!user.isGM && !c.actor?.testUserPermission(user, "OWNER")) return;
  if (!hasInspiration(c.actor)) return;
  try {
    await c.actor.update({ "system.attributes.inspiration": false });
    await c.update({ initiative: null });
    GM.results.delete(id); GM.rewound.add(id);
    GM.pcs.get(id).insp = false;
    broadcast({ action: "inspired", id });
  } catch (err) {
    console.error(`${ID} | inspiration failed`, err);
    ui.notifications.error(`Grim Encounter: could not use Inspiration for ${c.name}.`);
  }
}

/**
 * Swap two rolled results. The GM may swap anyone; a player may swap once, from a character
 * of theirs that has the Alert feat, with another player character.
 */
async function gmSwap(a, b, userId) {
  const combat = game.combats.get(GM.combatId);
  const A = combat?.combatants.get(a), B = combat?.combatants.get(b), user = game.users.get(userId);
  const ra = GM.results.get(a), rb = GM.results.get(b);
  if (!A || !B || !user || a === b || !ra || !rb || GM.finishing || GM.swapping) return;
  const viaAlert = !user.isGM;
  if (viaAlert && (!A.actor?.testUserPermission(user, "OWNER") || !GM.pcs.get(a)?.alert || GM.alertUsed.has(a))) return;
  GM.swapping = true;
  try {
    await combat.updateEmbeddedDocuments("Combatant", [{ _id: a, initiative: rb.total }, { _id: b, initiative: ra.total }]);
    GM.results.set(a, rb); GM.results.set(b, ra);
    if (viaAlert) GM.alertUsed.add(a);
    broadcast({ action: "swapped", a, b, ra: rb, rb: ra, alertUsed: viaAlert });
    await sleep(calm() ? 200 : 1900);   // let the reels finish before anything else can happen
  } catch (err) {
    console.error(`${ID} | initiative swap failed`, err);
    ui.notifications.error("Grim Encounter: could not swap initiative.");
  } finally {
    GM.swapping = false;
  }
}

function beginCombat() {
  if (!game.user.isGM || GM.finishing || GM.swapping) return;
  if ([...GM.pcs.keys()].some(id => !GM.results.get(id))) return;
  GM.finishing = true;
  finishOrder(0);
}

async function finishOrder(wait) {
  await sleep(wait);
  const combat = game.combats.get(GM.combatId);
  if (!combat) return broadcast({ action: "close" });
  const order = combat.combatants.contents
    .filter(c => GM.part.has(c.id) && !c.hidden && (SHOW_NPC_IN_ORDER || GM.pcs.has(c.id)))
    .sort((a, b) => (b.initiative ?? -999) - (a.initiative ?? -999))
    .map(c => ({ name: c.name, img: (c.actor?.img && !/mystery-man/.test(c.actor.img) ? c.actor.img : c.img), total: Math.round((c.initiative ?? 0) * 100) / 100, pc: GM.pcs.has(c.id) }));
  broadcast({ action: "order", order, style: GM.style, flame: GM.flame });
  await sleep(1800 + order.length * 110 + 3200);
  try { if (!combat.started) await combat.startCombat(); ui.combat?.activate?.(); } catch (e) { console.warn(`${ID} |`, e); }
  broadcast({ action: "close" });
}

/* ------------------------------------------------------------------ */
/*  Socket / client                                                    */
/* ------------------------------------------------------------------ */
function onMessage(msg) {
  switch (msg.action) {
    case "intro": return playIntro(msg);
    case "dice": return showDice(msg);
    case "mods": return playMods(msg);
    case "rolled": return playRolled(msg);
    case "swapped": return playSwapped(msg);
    case "inspired": return playInspired(msg);
    case "order": return playOrder(msg);
    case "close": return closeStage();
    case "rollRequest":
      if (game.users.activeGM?.isSelf) gmRollOne(msg.id, msg.userId, !!msg.reroll);
      return;
    case "inspireRequest":
      if (game.users.activeGM?.isSelf) gmInspire(msg.id, msg.userId);
      return;
    case "swapRequest":
      if (game.users.activeGM?.isSelf) gmSwap(msg.a, msg.b, msg.userId);
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
    let palette = null, preset = "crimson";
    if (core?.active && typeof core.api?.palette === "function") {
      const theme = core.api.getTheme?.() ?? {};
      preset = theme.preset ?? "crimson";
      if (!(theme.off ?? []).includes(ID)) palette = core.api.palette();   // unticked under "Modules that follow": keep our own colours
    }
    // A light theme (Amethyst, or Custom on light) has dark text tokens; the cards stay dark, so give them light text.
    const light = palette && luma(palette.bone) < luma(palette.ink);
    // With Grim Core active the initiative stage (headline, order title, sparks, backdrop) always follows Core, Crimson included,
    // never the flame colour picked in the launcher (that one only colours the fire cinematic).
    const stage = !!palette;
    for (const el of targets) {
      for (const k of [...el.style].filter(n => n.startsWith("--ge-") || n.startsWith("--core-"))) el.style.removeProperty(k);   // forget a previous theme
      if (!palette) continue;
      for (const [key, value] of Object.entries(palette)) el.style.setProperty(`--ge-${key}`, value);
      if (palette["accent-soft"]) el.style.setProperty("--ge-soft", palette["accent-soft"]);
      if (light) {
        el.style.setProperty("--ge-card-bone", "#f4effa");
        el.style.setProperty("--ge-card-soft", `color-mix(in srgb, ${palette.ember} 55%, #ffffff)`);
      }
      if (stage && el.id === "efx-root") paintStage(el, palette);
    }
  } catch (e) { console.warn(`${ID} | Grim Core theme unavailable`, e); }
}
/**
 * The initiative stage (rune streams, headline, names, glow, sparks, backdrop) in Grim Core's colours.
 * The fire is authored orange, so the sparks and backdrop are turned to the theme's hue like a flame colour is.
 */
function paintStage(el, p) {
  const ember = p.ember, soft = p["accent-soft"] ?? ember, f = flameOf(ember);
  const set = (k, v) => el.style.setProperty(`--core-${k}`, v);
  set("acc", ember);
  set("hi", `color-mix(in srgb, ${ember} 78%, #ffffff)`);
  set("glow", ember);
  set("soft", `color-mix(in srgb, ${soft} 55%, #ffffff)`);
  set("bd1", `color-mix(in srgb, ${ember} 14%, rgba(0, 0, 0, .82))`);
  set("rot", `${f.rot}deg`); set("sat", f.sat.toFixed(2)); set("bri", f.bri.toFixed(2));
}
/** Relative brightness 0..1 of a #rrggbb colour (anything else counts as mid-grey). */
function luma(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m) return .5;
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
}
// Grim Core's theme changed during the session: recolour the panel and the stage without a reload.
Hooks.on("updateSetting", setting => { if (setting?.key === "grim-core.theme") setTimeout(syncGrimCore, 60); });
const live = { fx: new Set(), dsparks: null, run: 0 };
const track = fx => { live.fx.add(fx); return fx; };
function closeAll() {
  live.run++;
  const stage = root().querySelector(".efx-dice-stage");
  if (stage?._onResize) removeEventListener("resize", stage._onResize);
  if (stage?._onKey) removeEventListener("keydown", stage._onKey);
  Loop.clear();
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

/* ------------------------------------------------------------------ */
/*  Initiative stage                                                   */
/*  One column per player character. Behind each column runes stream   */
/*  past: down in the 1st, 3rd, 5th... column, up in the 2nd, 4th...   */
/*  The die (or dice) rolls in place; the GM can give advantage,       */
/*  disadvantage, +1d4 or +1d8 (Gift of Alacrity), re-roll a column,   */
/*  and swap two results. A character with the Alert feat may swap     */
/*  once with an ally. The GM starts combat when everyone is ready.    */
/* ------------------------------------------------------------------ */
const RUNE_GLYPHS = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ᛭";
const RUNE_LANES = 4;

/** The rune streams behind one column. Each lane holds its text twice so the loop is seamless. */
function runeLanes() {
  let html = "";
  for (let l = 0; l < RUNE_LANES; l++) {
    const text = Array.from({ length: 26 }, () => RUNE_GLYPHS[(Math.random() * RUNE_GLYPHS.length) | 0]).join("\n");
    const style = `--d:${rand(7, 15).toFixed(1)}s;--o:${rand(0.45, 1).toFixed(2)};--fs:${rand(13, 19).toFixed(0)}px;animation-delay:-${rand(0, 15).toFixed(1)}s`;
    html += `<span class="lane"><span class="lane-in" style="${style}"><b>${text}</b><b>${text}</b></span></span>`;
  }
  return html;
}

/** Runes run faster while that column's dice are in the air. */
function runeSpeed(info, rate) {
  try { info.el.querySelectorAll(".lane-in").forEach(l => l.getAnimations().forEach(a => a.updatePlaybackRate(rate))); } catch (e) { /* cosmetic */ }
}

const NO_MODS = Object.freeze({ adv: false, dis: false, d4: false, d8: false });
const stageEl = () => root().querySelector(".efx-dice-stage");

/** How many of each die a column shows for a set of modifiers (before the roll). */
const diceFor = (mods = NO_MODS) => ({ d20: mods.adv || mods.dis ? 2 : 1, d4: mods.d4 ? 1 : 0, d8: mods.d8 ? 1 : 0 });
/** ...and after the roll, straight from the result (an actor's own advantage also shows as two dice). */
const diceOf = (r) => ({ d20: Math.max(1, r.d20.length), d4: r.bonus.filter(b => b.faces === 4).length, d8: r.bonus.filter(b => b.faces === 8).length });

/** Does this actor currently hold Heroic Inspiration (dnd5e: system.attributes.inspiration)? */
function hasInspiration(actor) {
  try { return !!actor?.system?.attributes?.inspiration; } catch (e) { return false; }
}

/** Does this actor have the Alert feat (2024: swap initiative with a willing ally)? */
function hasAlert(actor) {
  try {
    return !!actor?.items?.some(i => i.type === "feat" && (i.system?.identifier === "alert" || /^alert$/i.test(String(i.name).trim())));
  } catch (e) { return false; }
}

/** The die look for a column: the owner's Dice So Nice colours when available, else Grim red. */
function skinFor(d) { return d.owners?.includes(game.user.id) ? game.user.id : d.owners?.[0]; }

/** Draw the d20 with the full Dice So Nice look (preset, texture, theme)? Needs DSN, the setting, and a working DSN scene. */
function useDsnDice() {
  try { return !!game.settings.get(ID, "dsn") && !!game.settings.get(ID, "dsnFull") && dsnOn() && dsnDiceAvailable(); } catch (e) { return false; }
}

function lookFor(d) {
  const skin = skinFor(d);
  const dsn = skin ? dsnLook(skin) : null;
  return dsn ? { body: dsn.bg[0], label: dsn.fg, edge: dsn.edge } : { ...DEFAULT_LOOK };
}

function showDice({ dice = [], mods = {}, style = "fire", flame = DEFAULT_FLAME } = {}) {
  if (!STYLES[style]) style = "fire";
  stageEl()?.remove(); live.dsparks?.stop();
  const F = flameOf(flame), n = dice.length, isGM = game.user.isGM;
  const stage = document.createElement("div");
  stage.className = `efx-dice-stage st-${style}${isGM ? " is-gm" : ""}`;
  paintFlame(stage, F.hex);
  if (!root().style.getPropertyValue("--core-acc")) stage.style.setProperty("--gen-accent", F.hex);   // with a Grim Core theme the stage accent comes from Core
  stage.style.setProperty("--gen-n", String(Math.max(1, n)));
  stage.innerHTML = `
    <div class="efx-backdrop"></div>
    <canvas class="efx-sparks"></canvas>
    <div class="efx-headline">INITIATIVE</div>
    <div class="gen-row"></div>
    <div class="efx-order"></div>
    ${isGM ? `<div class="gen-foot">
      <button type="button" class="gen-btn" data-act="roll-all">Roll All Remaining</button>
      <button type="button" class="gen-btn gen-begin" data-act="begin" disabled>Begin Combat</button>
    </div>` : ""}`;
  root().appendChild(stage);
  stage._sparks = live.dsparks = new Sparks(stage.querySelector(".efx-sparks"));
  stage._colors = STYLES[style].colors;
  stage._cols = new Map();
  stage._pick = null;   // column id whose owner is choosing someone to swap with

  const row = stage.querySelector(".gen-row");
  const canFree = isGM || !!game.settings.get(ID, "freeReroll");
  for (const d of dice) {
    const mine = isGM || d.owners.includes(game.user.id);
    const col = document.createElement("div");
    col.className = `gen-col${mine ? " mine" : ""}`;
    col.dataset.id = d.id;
    col.innerHTML = `
      <div class="gen-runes" aria-hidden="true">${runeLanes()}</div>
      <div class="gen-dice" ${mine ? 'role="button" tabindex="0"' : ""}><div class="gen-d20s"></div><div class="gen-bonus"></div></div>
      <div class="gen-res">${mine ? '<span class="hint">Click the die</span>' : '<span class="hint dim">Waiting...</span>'}</div>
      <div class="gen-name">${esc(d.name)}</div>
      <div class="gen-player">${esc(d.player)}</div>
      <div class="gen-mods">
        <button type="button" data-mod="adv">Adv</button><button type="button" data-mod="dis">Dis</button>
        <button type="button" data-mod="d8">+d8</button>
      </div>
      <div class="gen-acts">
        ${mine ? '<button type="button" class="gen-btn gen-small gen-insp" data-act="inspire" title="Spend Heroic Inspiration to roll again">✦ Inspiration</button>' : ""}
        ${canFree ? '<button type="button" class="gen-btn gen-small" data-act="reroll">Reroll</button>' : ""}
        <button type="button" class="gen-btn gen-small gen-swap" data-act="swap" title="Swap initiative">⇄ Swap</button>
      </div>
      <div class="gen-target">⇄</div>`;
    row.appendChild(col);
    const info = {
      id: d.id, name: d.name, el: col, mine, skin: skinFor(d), alert: !!d.alert, alertUsed: !!d.alertUsed, insp: !!d.insp, rewind: false,
      owners: d.owners ?? [], look: lookFor(d), mods: { ...NO_MODS, ...(mods[d.id] ?? {}) },
      dice: { d20: [], d4: [], d8: [] }, pending: false, rolled: false, busy: false, result: null
    };
    stage._cols.set(d.id, info);
    buildColumnDice(info, diceFor(info.mods));
    paintMods(info);
    if (mine) {
      const box = col.querySelector(".gen-dice");
      box.addEventListener("click", () => requestRoll(info));
      box.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); requestRoll(info); } });
    }
  }
  refreshActions(stage);

  stage.addEventListener("click", ev => {
    const colEl = ev.target.closest(".gen-col");
    const info = colEl ? stage._cols.get(colEl.dataset.id) : null;
    // picking a swap partner: any other rolled column
    if (stage._pick && info && colEl.classList.contains("is-target")) return sendSwap(stage, stage._pick, info.id);
    const mod = ev.target.closest("[data-mod]")?.dataset.mod;
    if (mod && info && isGM) return toggleMod(info, mod);
    const act = ev.target.closest("[data-act]")?.dataset.act;
    if (act === "reroll" && info && info.mine) return requestRoll(info, true);
    if (act === "inspire" && info && info.mine) return requestInspire(info);
    if (act === "swap" && info) return startPick(stage, info);
    if (act === "roll-all" && isGM) {
      let i = 0;
      for (const c of stage._cols.values()) if (!c.rolled && !c.pending) setTimeout(() => requestRoll(c), 250 * i++);
      return;
    }
    if (act === "begin" && isGM && allRolled(stage)) {
      stage.querySelector(".gen-begin").disabled = true;
      return beginCombat();
    }
  });

  const onKey = ev => {
    if (ev.key !== "Escape" || !stage.isConnected) return;
    if (stage._pick) return endPick(stage);
    if (isGM) { removeEventListener("keydown", onKey); broadcast({ action: "close" }); }
  };
  addEventListener("keydown", onKey);
  stage._onKey = onKey;
}

/** Replace a column's dice with fresh ones: `counts` = { d20, d4, d8 }. */
function buildColumnDice(info, counts) {
  for (const list of Object.values(info.dice)) list.forEach(d => d.destroy());
  info.dice = { d20: [], d4: [], d8: [] };
  const d20s = info.el.querySelector(".gen-d20s"), bonus = info.el.querySelector(".gen-bonus");
  d20s.replaceChildren(); bonus.replaceChildren();
  d20s.classList.toggle("two", counts.d20 > 1);
  for (let i = 0; i < counts.d20; i++) { const d = useDsnDice() ? new DsnDie("d20", info.look, info.skin) : new Die("d20", info.look); info.dice.d20.push(d); d20s.appendChild(d.el); }
  for (const k of ["d4", "d8"]) for (let i = 0; i < counts[k]; i++) { const d = useDsnDice() ? new DsnDie(k, info.look, info.skin) : new Die(k, info.look); info.dice[k].push(d); bonus.appendChild(d.el); }
}
const allDice = info => [...info.dice.d20, ...info.dice.d4, ...info.dice.d8];

function paintMods(info) {
  for (const b of info.el.querySelectorAll("[data-mod]")) b.classList.toggle("on", !!info.mods[b.dataset.mod]);
  info.el.classList.toggle("has-mods", Object.values(info.mods).some(Boolean));
}

/** GM only: flip one modifier and tell everyone. Advantage and disadvantage exclude each other. */
function toggleMod(info, key) {
  const mods = { ...info.mods, [key]: !info.mods[key] };
  if (key === "adv" && mods.adv) mods.dis = false;
  if (key === "dis" && mods.dis) mods.adv = false;
  GM.mods.set(info.id, mods);
  broadcast({ action: "mods", id: info.id, mods });
}

function playMods({ id, mods }) {
  const info = stageEl()?._cols.get(id);
  if (!info) return;
  info.mods = { ...NO_MODS, ...mods };
  paintMods(info);
  // A column that has not rolled yet shows the dice it is about to throw; a rolled one keeps its dice until a re-roll.
  if (!info.rolled && !info.pending) buildColumnDice(info, diceFor(info.mods));
}

const allRolled = stage => [...stage._cols.values()].every(c => c.rolled);

/** Which buttons each column shows, for this user, right now. */
function refreshActions(stage) {
  const isGM = game.user.isGM, busy = !!stage._busy;
  for (const c of stage._cols.values()) {
    const canSwap = c.rolled && !busy && (isGM || (c.owners.includes(game.user.id) && c.alert && !c.alertUsed));
    c.el.classList.toggle("can-swap", canSwap && [...stage._cols.values()].some(o => o !== c && o.rolled));
    c.el.classList.toggle("can-reroll", c.mine && c.rolled && !busy);
    c.el.classList.toggle("can-inspire", c.mine && c.insp && c.rolled && !c.busy && !busy && !stage._pick);
    c.el.classList.toggle("is-rolled", c.rolled);
  }
  const begin = stage.querySelector(".gen-begin");
  if (begin) begin.disabled = !allRolled(stage) || busy;
}

function requestRoll(info, reroll = false) {
  const stage = stageEl();
  if (!stage || info.pending || info.busy || stage._pick) return;
  if (info.rolled && !reroll) return;   // a finished die is rolled again only through Reroll / Inspiration
  info.pending = true;
  info.el.classList.add("charging");
  runeSpeed(info, 4);
  allDice(info).forEach(d => d.spin());
  if (game.user.isGM) gmRollOne(info.id, game.user.id, reroll);
  else game.socket.emit(SOCKET, { action: "rollRequest", id: info.id, userId: game.user.id, reroll });
}

/** Ask the GM client to spend this character's Heroic Inspiration. */
function requestInspire(info) {
  const stage = stageEl();
  if (!stage || !info.insp || !info.rolled || info.busy || info.pending || stage._busy || stage._pick) return;
  if (game.user.isGM) gmInspire(info.id, game.user.id);
  else game.socket.emit(SOCKET, { action: "inspireRequest", id: info.id, userId: game.user.id });
}

/**
 * Inspiration spent: a flash of light sweeps the column, the runes run backwards and the die spins backwards
 * until the player rolls it again. The result is wiped and the column counts as unrolled.
 */
function playInspired({ id }) {
  const stage = stageEl(), info = stage?._cols.get(id);
  if (!info) return;
  info.insp = false; info.rolled = false; info.result = null; info.rewind = true; info.pending = false; info.busy = false;
  info.el.classList.remove("crit", "fumble", "landed", "rolling", "charging", "is-rolled");
  info.el.classList.add("rewind", "inspired");
  setTimeout(() => info.el.classList.remove("inspired"), 1300);
  runeSpeed(info, 2.2);
  allDice(info).forEach(d => d.spin(true));
  allDice(info).forEach(d => d.el.classList.remove("is-dropped"));
  info.el.querySelector(".gen-res").innerHTML = `<span class="hint insp">${info.mine ? "Inspired — roll again" : "Inspired…"}</span>`;
  const [cx, cy] = centerOf(info.el.querySelector(".gen-d20s"));
  stage._sparks.burst(cx, cy, { n: 70, speed: 620, life: [.4, 1.1], size: [2, 5], gravity: -80, colors: ["255,236,150", "255,255,230", "255,200,80"] });
  const f = document.createElement("div"); f.className = "gen-insp-flash"; info.el.appendChild(f);
  setTimeout(() => f.remove(), 1200);
  refreshActions(stage);
}

/** Lay a result into a column: rebuild the dice if their number changed, then let each one land. */
async function landColumn(stage, info, r, { fromSpin = true } = {}) {
  const want = diceOf(r), have = { d20: info.dice.d20.length, d4: info.dice.d4.length, d8: info.dice.d8.length };
  if (want.d20 !== have.d20 || want.d4 !== have.d4 || want.d8 !== have.d8) {
    buildColumnDice(info, want);
    if (fromSpin) allDice(info).forEach(d => d.spin());
  }
  const d4s = r.bonus.filter(b => b.faces === 4), d8s = r.bonus.filter(b => b.faces === 8);
  const rolls = [
    ...info.dice.d20.map((d, i) => d.roll(r.d20[i] ?? r.nat)),
    ...info.dice.d4.map((d, i) => d.roll(d4s[i]?.value ?? 1)),
    ...info.dice.d8.map((d, i) => d.roll(d8s[i]?.value ?? 1))
  ];
  const sparks = stage._sparks, box = info.el.querySelector(".gen-dice");
  const trail = setInterval(() => { const [x, y] = centerOf(box); sparks.burst(x, y, { n: 3, speed: 150, life: [.3, .6], size: [1.5, 3], gravity: -60, colors: stage._colors }); }, 60);
  await Promise.all(rolls);
  clearInterval(trail);
  if (!stage.isConnected) return false;
  // with two d20s, dim the one that was not kept
  if (info.dice.d20.length === 2) {
    const keep = r.d20[0] === r.nat ? 0 : 1;
    info.dice.d20.forEach((d, i) => d.el.classList.toggle("is-dropped", i !== keep));
  }
  return true;
}

function resultHTML(r, note = "") {
  const bonusSum = r.bonus.reduce((t, b) => t + b.value, 0);
  const flat = Math.round(r.total - r.nat - bonusSum);
  let sum = `<b class="nat">${r.nat}</b>`;
  for (const b of r.bonus) sum += `<i>+</i><span class="bd">d${b.faces}: ${b.value}</span>`;
  if (flat) sum += `<i>${flat > 0 ? "+" : "−"}</i><span>${Math.abs(flat)}</span>`;
  return `<div class="gen-sum">${sum}</div><div class="gen-total">${Math.round(r.total)}</div>${note ? `<div class="gen-note">${note}</div>` : ""}`;
}

async function playRolled({ id, result }) {
  const stage = stageEl(), info = stage?._cols.get(id);
  if (!info || !result) return;
  info.pending = false; info.busy = true;
  info.el.classList.remove("charging", "crit", "fumble", "landed", "rewind", "inspired");
  info.rewind = false;
  info.el.classList.add("rolling");
  runeSpeed(info, 4);
  info.el.querySelector(".gen-res").innerHTML = "";
  try { play(CONFIG.sounds?.dice); } catch (e) { /* ignore */ }
  if (!allDice(info).some(d => d.state === "spin")) allDice(info).forEach(d => d.spin());
  if (!await landColumn(stage, info, result)) return;
  info.busy = false; info.rolled = true; info.result = result;
  info.el.classList.remove("rolling"); info.el.classList.add("landed");
  runeSpeed(info, 1);
  const [cx, cy] = centerOf(info.el.querySelector(".gen-d20s"));
  stage._sparks.burst(cx, cy, { n: 36, speed: 520, life: [.4, 1], size: [2, 4.5], gravity: 600, colors: stage._colors });
  if (result.nat === 20) {
    info.el.classList.add("crit");
    stage._sparks.burst(cx, cy, { n: 160, speed: 900, life: [.6, 1.6], size: [2, 6], gravity: 500, colors: ["255,230,120", "255,190,40", "255,255,230"] });
    flash(stage, "gold");
  } else if (result.nat === 1) {
    info.el.classList.add("fumble");
    stage._sparks.burst(cx, cy, { n: 70, speed: 380, life: [.6, 1.4], size: [3, 6], gravity: 250, colors: ["200,20,10", "90,0,0"] });
    flash(stage, "red");
  }
  info.el.querySelector(".gen-res").innerHTML = resultHTML(result);
  refreshActions(stage);
}

function flash(stage, kind) {
  const f = document.createElement("div"); f.className = `efx-screenflash ${kind}`; stage.appendChild(f);
  setTimeout(() => f.remove(), 700);
}

/* ---------- swapping ---------- */

function startPick(stage, info) {
  if (!info.el.classList.contains("can-swap")) return;
  if (stage._pick === info.id) return endPick(stage);
  endPick(stage);
  stage._pick = info.id;
  stage.classList.add("is-picking");
  info.el.classList.add("is-source");
  for (const c of stage._cols.values()) if (c !== info && c.rolled) c.el.classList.add("is-target");
}

function endPick(stage) {
  stage._pick = null;
  stage.classList.remove("is-picking");
  for (const c of stage._cols.values()) c.el.classList.remove("is-source", "is-target");
}

function sendSwap(stage, a, b) {
  endPick(stage);
  if (game.user.isGM) gmSwap(a, b, game.user.id);
  else game.socket.emit(SOCKET, { action: "swapRequest", a, b, userId: game.user.id });
}

/** Both columns' dice tumble down and fade; the other column's dice drop in from above, like a slot reel. */
async function playSwapped({ a, b, ra, rb, alertUsed }) {
  const stage = stageEl();
  const A = stage?._cols.get(a), B = stage?._cols.get(b);
  if (!A || !B) return;
  stage._busy = true; refreshActions(stage);
  if (alertUsed) A.alertUsed = true;
  const reel = async (info, r, other) => {
    const box = info.el.querySelector(".gen-dice"), res = info.el.querySelector(".gen-res");
    info.busy = true;
    info.el.classList.remove("crit", "fumble");
    runeSpeed(info, 6);
    allDice(info).forEach(d => d.spin());
    res.classList.add("gen-fade");
    box.classList.add("gen-drop-out");
    await sleep(calm() ? 0 : 650);
    if (!stage.isConnected) return;
    buildColumnDice(info, diceOf(r));
    allDice(info).forEach(d => d.spin());
    box.classList.remove("gen-drop-out");
    void box.offsetWidth;
    box.classList.add("gen-drop-in");
    const landed = landColumn(stage, info, r, { fromSpin: false });
    await sleep(calm() ? 0 : 750);
    box.classList.remove("gen-drop-in");
    if (!await landed) return;
    info.result = r; info.busy = false;
    runeSpeed(info, 1);
    if (r.nat === 20) info.el.classList.add("crit"); else if (r.nat === 1) info.el.classList.add("fumble");
    res.innerHTML = resultHTML(r, `⇄ ${esc(other.name)}`);
    res.classList.remove("gen-fade");
    const [cx, cy] = centerOf(box);
    stage._sparks.burst(cx, cy, { n: 40, speed: 480, life: [.4, 1], size: [2, 4.5], gravity: 600, colors: stage._colors });
  };
  await Promise.all([reel(A, ra, B), reel(B, rb, A)]);
  stage._busy = false; refreshActions(stage);
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
