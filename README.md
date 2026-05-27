# 🔍 Cherbot — Murder Mystery Module

Adds a fully self-contained murder mystery game to your existing Cherbot.

---

## Files

| File | What it does |
|---|---|
| `mystery.js` | All game logic. Drop this next to your `index.js`. |
| `register.js` | Registers **all** slash commands (existing + new `/mystery`). Run once after adding the module. |
| `PATCH_INDEX.md` | The exact two-line change needed in your `index.js`. |

---

## Setup (3 steps)

### 1. Add `CLIENT_ID` to your environment

Your `.env` (or hosting env vars) needs:
```
DISCORD_TOKEN=your-bot-token
CLIENT_ID=your-bot-application-id   ← add this
```
Find `CLIENT_ID` in the [Discord Developer Portal](https://discord.com/developers/applications) → your app → **General Information → Application ID**.

---

### 2. Apply the two-line patch to `index.js`

Open `index.js`. Find this section inside `interactionCreate`:

```js
// ---------- Slash Commands ----------
if (!interaction.isChatInputCommand()) return;
const name = interaction.commandName;
```

**Add these two lines immediately after:**

```js
const mysteryHandled = await mystery.handleInteraction(interaction, client);
if (mysteryHandled) return;
```

Also add this near the top of `index.js` with your other `require` statements:

```js
const mystery = require("./mystery.js");
```

---

### 3. Register commands

```bash
node register.js
```

> ⚠️ This overwrites **all** global slash commands. That's why `register.js` includes all your existing Cherbot commands too — so nothing gets wiped.
> 
> Global registration takes up to **1 hour** to propagate. For instant testing add your guild ID and use `Routes.applicationGuildCommands(clientId, guildId)` instead.

---

## Commands

| Command | What it does |
|---|---|
| `/mystery start` | Starts a new game, randomises murderer/weapon/room |
| `/mystery search [room]` | Searches a room, reveals a clue |
| `/mystery accuse [suspect] [weapon] [room]` | Makes a final accusation |
| `/mystery hint` | Gives a hint (needs 3+ rooms searched) |
| `/mystery summary` | Lists all clues found so far |
| `/mystery vote [suspect]` | Votes for a suspect |
| `/mystery tallyvotes` | Shows the current vote standings |
| `/mystery toggleevents` | Turns atmospheric random messages on/off (mods only) |

---

## Notes

- **Multiple servers**: game state is isolated per guild — different servers can play simultaneously with no conflict.
- **Random events**: after `/mystery start`, the bot sends an atmospheric message every 5 minutes. Toggle with `/mystery toggleevents`.
- **No extra files**: no new JSON data file needed — mystery state lives in memory and resets on bot restart, which is intentional (each `/mystery start` begins a fresh case anyway).
- **Existing commands untouched**: the patch is additive; nothing in your raffle/giveaway logic changes.
