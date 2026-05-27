// deploy-commands.js — guild-only slash deploy (updates fast)
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const config = require("./config.json");

const token = String(process.env.DISCORD_TOKEN || "").trim();
if (!token) {
  console.error("❌ No DISCORD_TOKEN env var found.");
  process.exit(1);
}

const clientId = String(config.clientId || "").trim();
const guildId = String(config.guildId || "").trim();
if (!clientId || !guildId) {
  console.error("❌ clientId or guildId missing in config.json");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("completedraffles")
    .setDescription("List the most recent completed raffles (mods only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Create a giveaway (mods only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) => opt.setName("prize").setDescription("Prize").setRequired(true))
    .addStringOption((opt) => opt.setName("duration").setDescription("10m, 2h, 1d").setRequired(true))
    .addIntegerOption((opt) =>
      opt.setName("winners").setDescription("Number of winners").setRequired(true).setMinValue(1).setMaxValue(50)
    ),

  new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Roll the winner for a FULL raffle (main or mini). Mods/host only."),

  new SlashCommandBuilder()
    .setName("raffle")
    .setDescription("Raffle commands")
    .addSubcommand((sub) =>
      sub.setName("help").setDescription("Show raffle help & examples")
    )
    .addSubcommand((sub) =>
      sub
        .setName("start")
        .setDescription("Start a MAIN raffle in the current thread (mods/host only)")
        .addIntegerOption((opt) =>
          opt.setName("slots").setDescription("Total slots (1–500)").setRequired(true).setMinValue(1).setMaxValue(500)
        )
        .addStringOption((opt) =>
          opt.setName("price").setDescription("Example: 50c (leave blank for FREE)").setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName("duration").setDescription("Optional timer: 10m / 2h / 1d").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("mini")
        .setDescription("Create a MINI for this main thread (mods/host only)")
        .addIntegerOption((opt) =>
          opt.setName("tickets").setDescription("Main tickets reserved (1–50)").setRequired(true).setMinValue(1).setMaxValue(50)
        )
        .addIntegerOption((opt) =>
          opt.setName("mainslotprice").setDescription("Main ticket price in coins").setRequired(true).setMinValue(0).setMaxValue(1000000)
        )
        .addIntegerOption((opt) =>
          opt.setName("minislots").setDescription("Mini slots (2–100). Default from config.").setRequired(false).setMinValue(2).setMaxValue(100)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("minidraw").setDescription("Draw the mini winner (mods/host only) (use inside the mini thread)")
    )
    .addSubcommand((sub) =>
      sub
        .setName("claim")
        .setDescription("Claim specific slot numbers in this raffle")
        .addStringOption((opt) =>
          opt.setName("numbers").setDescription("Example: 5 12 27").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("rest").setDescription("Claim remaining available slots (up to your limit)")
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove your slots, or remove a specific slot (mods only)")
        .addIntegerOption((opt) =>
          opt.setName("slot").setDescription("Slot number (mods only). Leave blank to remove your own.").setRequired(false).setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("split")
        .setDescription("Split a PAID slot with another user (owner or mods)")
        .addIntegerOption((opt) =>
          opt.setName("slot").setDescription("Slot number").setRequired(true).setMinValue(1)
        )
        .addUserOption((opt) =>
          opt.setName("user").setDescription("User to split with").setRequired(true)
        )
    ),

  // ── Murder Mystery ──
  new SlashCommandBuilder()
    .setName("mystery")
    .setDescription("Murder mystery game")
    .addSubcommand((sub) =>
      sub.setName("start").setDescription("Start a new murder mystery game")
    )
    .addSubcommand((sub) =>
      sub
        .setName("search")
        .setDescription("Search a room for clues")
        .addStringOption((opt) =>
          opt
            .setName("room")
            .setDescription("Which room to search?")
            .setRequired(true)
            .addChoices(
              { name: "Kitchen",       value: "Kitchen"       },
              { name: "Dining Room",   value: "Dining Room"   },
              { name: "Lounge",        value: "Lounge"        },
              { name: "Hall",          value: "Hall"          },
              { name: "Study",         value: "Study"         },
              { name: "Library",       value: "Library"       },
              { name: "Billiard Room", value: "Billiard Room" },
              { name: "Conservatory",  value: "Conservatory"  },
              { name: "Ballroom",      value: "Ballroom"      }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("accuse")
        .setDescription("Make your accusation to solve the case")
        .addStringOption((opt) =>
          opt
            .setName("suspect")
            .setDescription("Who did it?")
            .setRequired(true)
            .addChoices(
              { name: "Miss Scarlett",   value: "Miss Scarlett"   },
              { name: "Colonel Mustard", value: "Colonel Mustard" },
              { name: "Mrs. White",      value: "Mrs. White"      },
              { name: "Reverend Green",  value: "Reverend Green"  },
              { name: "Mrs. Peacock",    value: "Mrs. Peacock"    },
              { name: "Professor Plum",  value: "Professor Plum"  }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName("weapon")
            .setDescription("What weapon?")
            .setRequired(true)
            .addChoices(
              { name: "Revolver",     value: "Revolver"     },
              { name: "Dagger",       value: "Dagger"       },
              { name: "Lead Piping",  value: "Lead Piping"  },
              { name: "Rope",         value: "Rope"         },
              { name: "Spanner",      value: "Spanner"      },
              { name: "Candlestick",  value: "Candlestick"  }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName("room")
            .setDescription("In which room?")
            .setRequired(true)
            .addChoices(
              { name: "Kitchen",       value: "Kitchen"       },
              { name: "Dining Room",   value: "Dining Room"   },
              { name: "Lounge",        value: "Lounge"        },
              { name: "Hall",          value: "Hall"          },
              { name: "Study",         value: "Study"         },
              { name: "Library",       value: "Library"       },
              { name: "Billiard Room", value: "Billiard Room" },
              { name: "Conservatory",  value: "Conservatory"  },
              { name: "Ballroom",      value: "Ballroom"      }
            )
        )
    )
    .addSubcommand((sub) =>
      sub.setName("hint").setDescription("Get a hint (requires 3+ rooms searched)")
    )
    .addSubcommand((sub) =>
      sub.setName("summary").setDescription("Review all clues discovered so far")
    )
    .addSubcommand((sub) =>
      sub
        .setName("vote")
        .setDescription("Vote for who you think the murderer is")
        .addStringOption((opt) =>
          opt
            .setName("suspect")
            .setDescription("Your vote")
            .setRequired(true)
            .addChoices(
              { name: "Miss Scarlett",   value: "Miss Scarlett"   },
              { name: "Colonel Mustard", value: "Colonel Mustard" },
              { name: "Mrs. White",      value: "Mrs. White"      },
              { name: "Reverend Green",  value: "Reverend Green"  },
              { name: "Mrs. Peacock",    value: "Mrs. Peacock"    },
              { name: "Professor Plum",  value: "Professor Plum"  }
            )
        )
    )
    .addSubcommand((sub) =>
      sub.setName("tallyvotes").setDescription("Show the current vote tally")
    )
    .addSubcommand((sub) =>
      sub.setName("toggleevents").setDescription("Toggle random atmospheric events on/off (mods only)")
    ),

].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("🚀 Deploying slash commands to guild:", guildId);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log("✅ Slash commands deployed successfully.");
  } catch (err) {
    console.error("❌ Failed to deploy commands:", err?.rawError || err?.message || err);
    process.exit(1);
  }
})();
