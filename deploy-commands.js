// deploy-commands.js
// Registers slash commands for Cherbot

const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const config = require("./config.json");

// Token: from env first, fallback to config.json
const token = String(process.env.DISCORD_TOKEN || config.token || "").trim();
if (!token) {
  console.error("❌ No token found. Set DISCORD_TOKEN or add token to config.json");
  process.exit(1);
}

const clientId = config.clientId; // Cherbot application ID
const guildId = config.guildId;   // Your server ID (guild)

if (!clientId || !guildId) {
  console.error("❌ clientId or guildId missing in config.json");
  process.exit(1);
}

// -------------------- Command definitions --------------------
const commands = [
  new SlashCommandBuilder()
    .setName("level")
    .setDescription("View your level or another user's level")
    .addUserOption(opt =>
      opt.setName("user").setDescription("User to check").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the XP leaderboard"),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("View a user's XP and level (mods only)")
    .addUserOption(opt =>
      opt.setName("user").setDescription("User to inspect").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("xpreset")
    .setDescription("Reset or set a user's XP/level (mods only)")
    .addUserOption(opt =>
      opt.setName("user").setDescription("User to reset").setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName("level").setDescription("Level to set (default: 1)").setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("givexp")
    .setDescription("Give or remove XP from a user (mods only)")
    .addUserOption(opt =>
      opt.setName("user").setDescription("User to modify").setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName("amount").setDescription("XP amount (can be negative)").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("role")
    .setDescription("Add or remove a self-assignable role")
    .addSubcommand(sub =>
      sub.setName("add")
        .setDescription("Add a role")
        .addRoleOption(opt =>
          opt.setName("role").setDescription("Role").setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("remove")
        .setDescription("Remove a role")
        .addRoleOption(opt =>
          opt.setName("role").setDescription("Role").setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("roleadmin")
    .setDescription("Manage self-assignable roles (mods only)")
    .addSubcommand(sub =>
      sub.setName("allow")
        .setDescription("Allow a role")
        .addRoleOption(opt =>
          opt.setName("role").setDescription("Role").setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("disallow")
        .setDescription("Disallow a role")
        .addRoleOption(opt =>
          opt.setName("role").setDescription("Role").setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("list")
        .setDescription("List allowed roles")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("rolemenu")
    .setDescription("Post a self-role button menu")
    .addStringOption(opt =>
      opt.setName("title").setDescription("Menu title").setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName("description").setDescription("Menu description").setRequired(false)
    )
];

// -------------------- Deploy --------------------
// -------------------- Deploy --------------------
console.log("DISCORD_TOKEN env present?", Boolean(process.env.DISCORD_TOKEN));
console.log("token variable present?", Boolean(token));
console.log("clientId:", clientId ? "set" : "missing");
console.log("guildId:", guildId ? "set" : "missing");

const rest = new REST({ version: "10" });
rest.setToken(token);

(async () => {
  try {
    console.log("🚀 Deploying slash commands...");

    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands.map(cmd => cmd.toJSON()) }
    );

    console.log("✅ Slash commands deployed successfully.");
  } catch (error) {
    console.error("❌ Failed to deploy commands:", error);
  }
})();


