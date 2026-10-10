# Grim Encounter

A GM-only cinematic **Start Encounter** tool for **Foundry VTT v14** and the **dnd5e** system, in the black-and-red style of the Grim modules.

Pick a scene and a flame colour, press **Start Encounter**. The screen is taken over by a full-screen fire cinematic, everyone is moved to the scene, the tokens are added to Foundry's **native Combat**, every player rolls their own 3D d20 for initiative at the same time, the order is announced as a row of cards, and combat starts automatically.

## Install

Manifest URL:

```
https://github.com/NuttoSGXX/Grim_Encounter/releases/latest/download/module.json
```

Requirements: Foundry VTT v14, dnd5e 6.0.0 or newer.
Recommended: **Dice So Nice** (dice look) and **Grim Core** (shared theme for all Grim modules).

## Using it

1. Click the **Grim Encounter** flame button in the **Token controls** (GM only). The launcher is a small floating panel; **grab its header and drag** it anywhere (the position is remembered on your machine). `Esc` or `×` closes it.
2. Choose the **Scene**, the **Flame** colour, which **players** join the combat, and whether **hostile tokens** of that scene are added.
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

Players only ever see the cinematic and their own dice; they cannot open the launcher.

## Flame colour

The Inferno cinematic comes in any colour: seven presets (Ember, Crimson, Gold, Emerald, Azure, Violet, Rose) and a custom colour picker. The colour you used last is remembered on your machine. The same colour carries into the dice screen (backdrop, glow, default die).

## Dice So Nice

If Dice So Nice is active, each player's initiative die is painted with **their own Dice So Nice d20 look**: colorset (or custom colours), texture, material (metal / chrome sheen, glass translucency), outline, edge and number font. A player who never customised their dice, or a table without Dice So Nice, gets a default die in the flame colour. Toggle: **Use Dice So Nice dice look** in Module Settings (per user).

No chat roll is created for this, so Dice So Nice does not throw a second set of dice across the screen. Initiative is rolled with the real dnd5e initiative formula and written to the Combat.

Dice So Nice has no public call for "this user's d20 colours", so the module reads the saved appearance from the user document, with guarded lookups and a built-in table for Dice So Nice's stock colorsets as a fallback. If a die does not match what a player sees in Dice So Nice, run this in the console and send the output:

```js
game.modules.get("grim-encounter").api.dsn.debug()
```

## Grim Core

With **Grim Core** active, the launcher panel and the cards / buttons on the full-screen stage follow Grim Core's theme (Crimson, Ash, Amethyst, Abyss or a custom accent) for the GM and every player. Without it the Crimson look is used. The flame colour is separate and is picked in the launcher.

## Settings

- **Encounter stinger sound** (world): an audio file played when the encounter starts.
- **Use Dice So Nice dice look** (per user).
- Running text and timings: `STYLES` at the top of `scripts/main.js`. Only list players in the order: `SHOW_NPC_IN_ORDER = false`.
- Reduced motion (OS setting) is respected for the heaviest effects.

## Troubleshooting

- **Nothing happens when I press Start:** pick a scene first (the field is required). Check the browser console (F12) for `grim-encounter` messages.
- **A player has no die:** the character needs a token in the destination scene, and a non-GM user must own the character.
- **Overlay stuck:** the GM can press `Esc`.
- **Fonts:** Grenze and Cinzel are bundled in `fonts/` (SIL OFL 1.1); nothing is loaded from the internet.

## Releasing (maintainers)

Create a GitHub Release with a tag like `v1.0.0` and publish it. The workflow patches `module.json`, zips `module.json scripts templates styles fonts`, and uploads `module.json` and `module.zip` to the release.

See `CHANGELOG.md` for version history.
