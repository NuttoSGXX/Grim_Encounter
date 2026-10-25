# Grim Encounter

**v1.4.0** · Foundry VTT V13–V14 · dnd5e system · © DM Bank

**Not for sale** (this edition includes the canvas token-selection system, the board-token list, Inspiration re-rolls and the full Dice So Nice d20).

Discord: https://discord.gg/XWfgWKpxJp

---

A GM-only cinematic **Start Encounter** tool for **Foundry VTT v13 or v14** and the **dnd5e** system, in the black-and-red style of the Grim modules.

Pick a scene and a flame colour, press **Start Encounter**. The screen is taken over by a full-screen fire cinematic, everyone is moved to the scene, the tokens are added to Foundry's **native Combat**, every player rolls their own 3D d20 for initiative at the same time, the order is announced as a row of cards, and combat starts automatically.

## Install

Requirements: Foundry VTT v13 or v14, dnd5e 5.0.0 or newer (tested on v14; v13 with dnd5e 5.3.x supported).
Recommended: **Dice So Nice** (dice look) and **Grim Core** (shared theme for all Grim modules). With any Grim Core theme (Crimson included), the launcher, the initiative-roll screen (rune streams, headline, names, glow, sparks, backdrop) and the order cards all change colour with it, live. The headline and "Initiative Order" title follow Core too; only the fire intro uses the flame colour you picked.

1. Unzip the file you received. You get a folder named `grim-encounter`.
2. Move the `grim-encounter` folder into Foundry's `Data/modules/` (find the location under Setup → Configuration → User Data Path).
3. Check that `Data/modules/grim-encounter/module.json` exists. Do not rename the folder, and do not nest it inside a second folder.
4. Restart Foundry and enable the module under Manage Modules in your world.

Players install nothing; only the machine hosting the game needs the files. On The Forge, upload the zip with the Import Wizard.

**Updating:** this module has no update button inside Foundry. New versions are posted on Discord: delete the old `grim-encounter` folder and put the new one in its place. Your world's settings are kept.

## Using it

1. Click the **Grim Encounter** flame button in the **Token controls** (GM only). The launcher is a small floating panel; **grab its header and drag** it anywhere (the position is remembered on your machine). `Esc` or `×` closes it.
2. Choose the **Scene** (it defaults to the scene you are viewing), the **Flame** colour, which **players** join, and which **tokens** join as enemies. Under **On the board (N)** the launcher lists every non-player token of the scene (hostile first, then neutral, friendly, secret; hidden ones are marked). Click a chip to tick or untick it. With **Follow canvas** on (default), clicking, shift-clicking or drag-selecting tokens on the canvas ticks the same chips, and clicking a chip selects that token on the canvas too; with nothing selected, the visible hostile tokens are ticked. Turn it off and only the list decides. **All** ticks or clears every visible token (hidden ones are never ticked this way). Player-owned tokens never count as enemies. Players are **always ticked** by default; untick anyone who should not join. **Reinforcements:** when a fight is already running, tokens that already hold an initiative keep it, only new ones roll, and the combat is not restarted. From the API: `launch({ sceneId, actorIds, foeIds })` or `selected: true` for the canvas selection.
**Player-controlled NPC tokens** (a Find Familiar, a summoned beast, any NPC-type actor that a player owns) are not characters, so they get their own row, **Player-controlled**, listing each such token on the scene. They are ticked by default; untick one to leave it out. Each ticked token gets its own die column, named after the token, and the owning player rolls it (the GM can too), exactly like a player character. Swapping and re-rolling work the same; Inspiration only shows for actors that have it. From the API: `launch({ sceneId, actorIds, petIds })` (omit `petIds` to include all of them).
3. **Preview** plays only the cinematic on your screen (no scene change, no combat). **Start Encounter** runs the real thing.

From a macro: `game.modules.get("grim-encounter").api.open()`

### What happens after Start

1. The fire cinematic plays for everyone; the scene is swapped while the screen is covered.
2. A real `Combat` is found or created for that scene and the selected tokens are added.
3. NPCs and hidden combatants roll initiative silently.
4. One 3D d20 appears per player character (character and player name under it). Before the roll every die **idles, spinning slowly in place**. Each player clicks their own die; everyone can roll at the same time. The GM can click any die or use **Roll All Remaining**.
5. On click the die **spins faster where it is** (it never bounces or tumbles across the screen) and settles on the rolled face. A natural 20 / natural 1 gets its own effect.
6. The initiative order is announced as tall arched cards, highest on the left, up to 15 across. Player cards have a glowing frame, NPC cards a plain one. Combat then starts automatically; there are no buttons.
7. `Esc` (GM) cancels the overlay if something goes wrong.

### Heroic Inspiration re-roll

Under a finished die, a player whose character has **Heroic Inspiration** (dnd5e) sees a gold **✦ Inspiration** button. Pressing it spends the Inspiration (the sheet's checkbox is cleared), a flash of light sweeps the column, the runes run backwards in gold and the die spins backwards until the player clicks it to roll again. The old result is discarded; the new roll is the real one. The GM keeps a free **Reroll** button. If you want players to have a free Reroll too, turn on **Players may re-roll without Inspiration** (world setting).

Players only ever see the cinematic and their own dice; they cannot open the launcher.

## Flame colour

The Inferno cinematic comes in any colour: seven presets (Ember, Crimson, Gold, Emerald, Azure, Violet, Rose) and a custom colour picker. The colour you used last is remembered on your machine. The same colour carries into the dice screen (backdrop, glow, default die).

## Dice So Nice

If Dice So Nice is active, each player's initiative d20 is drawn by **Dice So Nice itself** with **their own saved look**: Theme / colorset, **Dice Preset** (the Standard, Spectrum, Foundry VTT and Dot families), texture, material (metal, glass...), outline, edge and number font. The die is built and lit by Dice So Nice's own renderer, so it matches the dice that player throws at the table. Requires Dice So Nice 6.x (tested with 6.4.2, which needs Foundry v14).

- Presets that ship as 3D models (GLB) have no readable faces, so they, and anything that cannot be read safely, use the built-in canvas die painted with the player's colours. The fallback is automatic and silent: a missing or changed Dice So Nice never breaks the encounter.
- A player who never customised their dice, or a table without Dice So Nice, gets the default die in the flame colour.
- The initiative d20s and the +d8 bonus die all use the full renderer (the +d8 takes the player's d8 look, or their global look). The +d4 option was removed.
- If a die ever drops back to the simple canvas die, run `game.modules.get("grim-encounter").api.dsn.debug().full` in the console: `lastError` says why.
- Settings (per user): **Use Dice So Nice dice look** (colours) and **Render the full Dice So Nice d20** (presets, textures, themes). Turn the second one off on a weak machine.

No chat roll is created for this, so Dice So Nice does not throw a second set of dice across the screen. Initiative is rolled with the real dnd5e initiative formula and written to the Combat.

If a die does not match what a player sees in Dice So Nice, run this in the console and send the output:

```js
game.modules.get("grim-encounter").api.dsn.debug()
```

## Grim Core

With **Grim Core** active, the launcher panel and the cards / buttons on the full-screen stage follow Grim Core's theme (Crimson, Ash, Amethyst, Abyss or a custom accent) for the GM and every player. A theme change in Grim Core recolours them straight away, without a reload. On a light theme (Amethyst, or Custom on light) the cards stay dark and keep light text. Untick Grim Encounter under "Modules that follow" in Grim Core to keep the Crimson look. Without Grim Core the Crimson look is used. The flame colour is separate and is picked in the launcher.

## Settings

- **Encounter stinger sound** (world): an audio file played when the encounter starts.
- **Use Dice So Nice dice look** and **Render the full Dice So Nice d20** (per user).
- **Players may re-roll without Inspiration** (world): off by default.
- Running text and timings: `STYLES` at the top of `scripts/main.js`. Only list players in the order: `SHOW_NPC_IN_ORDER = false`.
- Reduced motion (OS setting) is respected for the heaviest effects.

## Troubleshooting

- **Nothing happens when I press Start:** pick a scene first (the field is required). Check the browser console (F12) for `grim-encounter` messages.
- **A player has no die:** the character needs a token in the destination scene, and a non-GM user must own the character.
- **Overlay stuck:** the GM can press `Esc`.
- **Fonts:** Grenze, Cinzel, Spectral and Noto Sans Runic are bundled in `fonts/` (SIL OFL 1.1); nothing is loaded from the internet.

## Terms of use

© 2026 DM Bank. All rights reserved.

- This edition is not for sale.
- Do not resell, share or redistribute this module or its files.
- You may use it as a tool for paid D&D games (commissions) and for livestreams.

The bundled fonts are licensed under the SIL Open Font License 1.1 (see the files in `fonts/`).

## Contact / support

Discord: https://discord.gg/XWfgWKpxJp
