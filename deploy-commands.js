const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const config = require("./config.json");

const commands = [
  new SlashCommandBuilder()
    .setName("level")
    .setDescription("View your level (or someone else's).")
    .addUserOption(opt => opt.setName("user").setDescription("User to check").setRequired(false)),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Shows the top 10 users by level/XP."),

  new SlashCommandBuilder()
    .setName("role")
    .setDescription("Self-assign roles")
    .addSubcommand(sub =>
      sub.setName("add")
        .setDescription("Add a self-assignable role")
        .addRoleOption(opt => opt.setName("role").setDescription("Role").setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("remove")
        .setDescription("Remove a self-assignable role")
        .addRoleOption(opt => opt.setName("role").setDescription("Role").setRequired(true))
    ),

  new SlashCommandBuilder()
    .setName("roleadmin")
    .setDescription("Admin: manage self-assignable roles list")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(sub =>
      sub.setName("allow")
        .setDescription("Allow a role to be self-assigned")
        .addRoleOption(opt => opt.setName("role").setDescription("Role").setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("disallow")
        .setDescription("Disallow a role from being self-assigned")
        .addRoleOption(opt => opt.setName("role").setDescription("Role").setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("list")
        .setDescription("List allowed self-assignable roles")
    ),

  new SlashCommandBuilder()
    .setName("rolemenu")
    .setDescription("Admin: post a button role menu for allowed roles")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption(opt =>
      opt.setName("title")
        .setDescription("Menu title")
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName("description")
        .setDescription("Menu description")
        .setRequired(false)
    )
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

(async () => {
  try {
    console.log("Deploying slash commands...");
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands }
    );
    console.log("✅ Slash commands deployed.");
  } catch (err) {
    console.error(err);
  }
})();
