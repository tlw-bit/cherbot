// deploy-commands.js (RAFFLES + GIVEAWAYS ONLY)
// Registers slash commands to ONE guild (guild commands update fast)

const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const config = require("./config.json");

// FORCE: env token only (prevents config.json accidentally overriding)
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
  // /free (mods can free specific slot, users can free their own slots)
  new SlashCommandBuilder()
    .setName("free")
    .setDescription("Free raffle slot(s)")
    .addIntegerOption((opt) =>
      opt
        .setName("slot")
        .setDescription("Slot number to free (mods only). Leave blank to free your own slots.")
        .setRequired(false)
        .setMinValue(1)
    ),

  // /giveaway (mods only)
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Giveaway commands (mods only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("start")
        .setDescription("Start a giveaway")
        .addStringOption((opt) => opt.setName("prize").setDescription("Prize name").setRequired(true))
        .addStringOption((opt) => opt.setName("duration").setDescription("Duration like 10m, 2h, 1d").setRequired(true))
        .addIntegerOption((opt) =>
          opt
            .setName("winners")
            .setDescription("Number of winners (1–50)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(50)
        )
        .addUserOption((opt) => opt.setName("sponsor").setDescription("Who is sponsoring this giveaway?").setRequired(false))
        .addBooleanOption((opt) => opt.setName("ping").setDescription("Ping the giveaway role? (default: true)").setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName("end")
        .setDescription("End a giveaway early")
        .addStringOption((opt) => opt.setName("messageid").setDescription("Giveaway message ID").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("reroll")
        .setDescription("Reroll winners for a finished giveaway")
        .addStringOption((opt) => opt.setName("messageid").setDescription("Giveaway message ID").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List active giveaways (mods only)")
    ),

  // /assign (mods only) - supports optional split user2
  new SlashCommandBuilder()
    .setName("assign")
    .setDescription("Assign a raffle slot to a user (mods only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((opt) =>
      opt.setName("slot").setDescription("Slot number to assign").setRequired(true).setMinValue(1)
    )
    .addUserOption((opt) => opt.setName("user").setDescription("User to receive this slot").setRequired(true))
    .addUserOption((opt) => opt.setName("user2").setDescription("Optional second user (split, paid raffles only)").setRequired(false)),

  // /roll (d4..d500)
  new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Roll a die (d4, d6, d8, d10, d20, d50, d100, d200, d500)")
    .addStringOption((opt) =>
      opt
        .setName("die")
        .setDescription("Which die?")
        .setRequired(true)
        .addChoices(
          { name: "d4", value: "4" },
          { name: "d6", value: "6" },
          { name: "d8", value: "8" },
          { name: "d10", value: "10" },
          { name: "d20", value: "20" },
          { name: "d50", value: "50" },
          { name: "d100", value: "100" },
          { name: "d200", value: "200" },
          { name: "d500", value: "500" }
        )
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
