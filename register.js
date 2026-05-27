// ===================== register.js =====================
// Registers ALL slash commands for Cherbot — including the mystery module.
// Run once (or whenever you add/change commands):
//   node register.js
//
// Requires: DISCORD_TOKEN and CLIENT_ID in your environment (or .env file).

require("dotenv").config();
const { REST, Routes, ApplicationCommandOptionType } = require("discord.js");
const { SUSPECT_CHOICES, WEAPON_CHOICES, ROOM_CHOICES } = require("./mystery.js");

const token    = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error("❌  Set DISCORD_TOKEN and CLIENT_ID in your environment / .env file.");
  process.exit(1);
}

// ---------------------------------------------------------------
// Add YOUR EXISTING commands here too so they don't get wiped.
// The commands below are Cherbot's existing set PLUS the new
// /mystery command. Edit this list to match what you already have.
// ---------------------------------------------------------------
const commands = [
  // ── Existing Cherbot commands ──────────────────────────────
  {
    name: "giveaway",
    description: "Create a timed giveaway (mods only)",
    options: [
      { name: "prize",    description: "What are you giving away?",         type: ApplicationCommandOptionType.String,  required: true },
      { name: "duration", description: "Duration e.g. 10m, 2h, 1d",        type: ApplicationCommandOptionType.String,  required: true },
      { name: "winners",  description: "Number of winners (default 1)",     type: ApplicationCommandOptionType.Integer, required: false },
    ],
  },
  {
    name: "raffle",
    description: "Raffle system",
    options: [
      {
        name: "help", description: "Show raffle help",
        type: ApplicationCommandOptionType.Subcommand, options: [],
      },
      {
        name: "start", description: "Start a main raffle in this thread",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: "slots",    description: "Total slots (1–500)",        type: ApplicationCommandOptionType.Integer, required: true },
          { name: "price",    description: "Slot price e.g. 50c (omit for free)", type: ApplicationCommandOptionType.String,  required: false },
          { name: "duration", description: "Auto-close timer e.g. 2h",   type: ApplicationCommandOptionType.String,  required: false },
        ],
      },
      {
        name: "mini", description: "Create a mini-raffle thread",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: "tickets",       description: "Main tickets for winner",   type: ApplicationCommandOptionType.Integer, required: true },
          { name: "mainslotprice", description: "Main slot price in coins",  type: ApplicationCommandOptionType.Integer, required: true },
          { name: "minislots",     description: "Number of mini slots",      type: ApplicationCommandOptionType.Integer, required: false },
        ],
      },
      {
        name: "minidraw", description: "Draw the mini winner (inside mini thread)",
        type: ApplicationCommandOptionType.Subcommand, options: [],
      },
      {
        name: "claim", description: "Claim slot numbers",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: "numbers", description: 'Slot numbers e.g. "5 12 27"', type: ApplicationCommandOptionType.String, required: true },
        ],
      },
      {
        name: "rest", description: "Claim all remaining available slots",
        type: ApplicationCommandOptionType.Subcommand, options: [],
      },
      {
        name: "remove", description: "Remove your claimed slots (or a specific slot — mods only)",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: "slot", description: "Specific slot to clear (mods only)", type: ApplicationCommandOptionType.Integer, required: false },
        ],
      },
      {
        name: "split", description: "Split a slot with another user",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: "slot", description: "Slot number to split",  type: ApplicationCommandOptionType.Integer, required: true },
          { name: "user", description: "User to split with",    type: ApplicationCommandOptionType.User,    required: true },
        ],
      },
    ],
  },
  {
    name: "roll",
    description: "Roll the raffle winner (mods or thread owner only)",
  },
  {
    name: "completedraffles",
    description: "List recent completed raffles (mods only)",
  },

  // ── NEW: Mystery game ──────────────────────────────────────
  {
    name: "mystery",
    description: "Murder mystery game",
    options: [
      {
        name: "start",
        description: "Start a new murder mystery game",
        type: ApplicationCommandOptionType.Subcommand,
        options: [],
      },
      {
        name: "search",
        description: "Search a room for clues",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "room",
            description: "Which room to search?",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: ROOM_CHOICES,
          },
        ],
      },
      {
        name: "accuse",
        description: "Make your accusation to solve the case",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "suspect",
            description: "Who did it?",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: SUSPECT_CHOICES,
          },
          {
            name: "weapon",
            description: "What weapon?",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: WEAPON_CHOICES,
          },
          {
            name: "room",
            description: "In which room?",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: ROOM_CHOICES,
          },
        ],
      },
      {
        name: "hint",
        description: "Get a hint (requires 3+ clues found)",
        type: ApplicationCommandOptionType.Subcommand,
        options: [],
      },
      {
        name: "summary",
        description: "Review all clues discovered so far",
        type: ApplicationCommandOptionType.Subcommand,
        options: [],
      },
      {
        name: "vote",
        description: "Vote for who you think the murderer is",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "suspect",
            description: "Your vote",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: SUSPECT_CHOICES,
          },
        ],
      },
      {
        name: "tallyvotes",
        description: "Show the current vote tally",
        type: ApplicationCommandOptionType.Subcommand,
        options: [],
      },
      {
        name: "toggleevents",
        description: "Toggle random atmospheric events on/off (mods only)",
        type: ApplicationCommandOptionType.Subcommand,
        options: [],
      },
    ],
  },
];

// ---------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------
const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log(`⏳  Registering ${commands.length} commands…`);
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log("✅  All commands registered globally. (May take up to 1 hour to appear everywhere.)");
  } catch (err) {
    console.error("❌  Registration failed:", err);
    process.exit(1);
  }
})();
