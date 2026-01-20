const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const config = require("./config.json");

// FORCE: env token only (prevents config.json accidentally overriding)
const token = String(process.env.DISCORD_TOKEN || "").trim();

console.log("token length:", token.length);
console.log("token starts:", token.slice(0, 6));
console.log("token ends:", token.slice(-6));

if (!token) {
  console.error("❌ No DISCORD_TOKEN env var found.");
  process.exit(1);
}


const clientId = config.clientId;
const guildId = config.guildId;

if (!clientId || !guildId) {
  console.error("❌ clientId or guildId missing in config.json");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("level")
    .setDescription("View your level or another user's level")
    .addUserOption(opt => opt.setName("user").setDescription("User to check").setRequired(false)),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the XP leaderboard"),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("View a user's XP and level (mods only)")
    .addUserOption(opt => opt.setName("user").setDescription("User to inspect").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("xpreset")
    .setDescription("Reset or set a user's XP/level (mods only)")
    .addUserOption(opt => opt.setName("user").setDescription("User to reset").setRequired(true))
    .addIntegerOption(opt => opt.setName("level").setDescription("Level to set (default: 1)").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("givexp")
    .setDescription("Give or remove XP from a user (mods only)")
    .addUserOption(opt => opt.setName("user").setDescription("User to modify").setRequired(true))
    .addIntegerOption(opt => opt.setName("amount").setDescription("XP amount (can be negative)").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // ✅ /roll added
  new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Roll a die (d4, d6, d8, d10, d20, d50)")
    .addStringOption(opt =>
      opt.setName("die")
        .setDescription("Which die?")
        .setRequired(true)
        .addChoices(
          { name: "d4", value: "4" },
          { name: "d6", value: "6" },
          { name: "d8", value: "8" },
          { name: "d10", value: "10" },
          { name: "d20", value: "20" },
          { name: "d50", value: "50" }
        )
    ),
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("🚀 Deploying slash commands...");
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log("✅ Slash commands deployed successfully.");
  } catch (err) {
    console.error("❌ Failed to deploy commands:", err);
  }
})();
