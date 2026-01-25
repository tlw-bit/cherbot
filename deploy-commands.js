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

  // ✅ Everything raffle-related lives under /raffle
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
