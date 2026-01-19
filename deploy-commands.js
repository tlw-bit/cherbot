// deploy-commands.js
// Registers slash commands for Cherbot

const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const config = require("./config.json");

const token = String(process.env.DISCORD_TOKEN || config.token || "").trim();

console.log("token length:", token.length);
console.log("token starts:", token.slice(0, 6));
console.log("token ends:", token.slice(-6));

if (!token) {
  console.error("❌ No token found. Set DISCORD_TOKEN or add token to config.json");
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
  .setName("giveaway")
  .setDescription("Giveaway commands (mods only)")
  .addSubcommand(sub =>
    sub.setName("start")
      .setDescription("Start a giveaway")
      .addStringOption(opt => opt.setName("prize").setDescription("Prize").setRequired(true))
      .addStringOption(opt => opt.setName("duration").setDescription("Duration like 10m, 2h, 1d").setRequired(true))
      .addIntegerOption(opt => opt.setName("winners").setDescription("Number of winners").setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName("end")
      .setDescription("End a giveaway early")
      .addStringOption(opt => opt.setName("messageid").setDescription("Giveaway message ID").setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName("reroll")
      .setDescription("Reroll winners for a finished giveaway")
      .addStringOption(opt => opt.setName("messageid").setDescription("Giveaway message ID").setRequired(true))
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("givexp")
    .setDescription("Give or remove XP from a user (mods only)")
    .addUserOption(opt => opt.setName("user").setDescription("User to modify").setRequired(true))
    .addIntegerOption(opt => opt.setName("amount").setDescription("XP amount (can be negative)").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
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
