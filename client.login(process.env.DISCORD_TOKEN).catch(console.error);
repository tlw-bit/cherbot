// Cherbot (Discord.js v14) — clean + stable
// NO getcode (so it won't clash with Verifier)
// Adds: /stats, /xpreset, /givexp (mods only)

const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const config = require("./config.json");

// -------------------- Client --------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // XP + prefix command
    GatewayIntentBits.GuildMembers,   // role ops + join/leave logs
  ],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// -------------------- Data storage --------------------
const DATA_FILE = path.join(__dirname, "data.json");

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { users: {}, selfRoles: [] };
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { users: {}, selfRoles: [] };
  }
}

function saveData(obj) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), "utf8");
}

let data = loadData();

// -------------------- Helpers --------------------
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function xpNeeded(level) {
  return 100 + (level - 1) * 50;
}

function ensureUser(userId) {
  if (!data.users[userId]) data.users[userId] = { xp: 0, level: 1, lastXpAt: 0 };
  return data.users[userId];
}

function getLogChannel(guild) {
  const id = config.logChannelId;
  if (!id) return null;
  return guild.channels.cache.get(id) || null;
}

function logEmbed(guild, embed) {
  const ch = getLogChannel(guild);
  if (!ch) return;
  ch.send({ embeds: [embed] }).catch(() => {});
}

function getLevelRoleIdsSorted() {
  const map = config.levelRoles || {};
  return Object.entries(map)
    .map(([lvl, roleId]) => ({ lvl: Number(lvl), roleId }))
    .filter((x) => Number.isFinite(x.lvl) && typeof x.roleId === "string" && x.roleId.length > 0)
    .sort((a, b) => a.lvl - b.lvl);
}

function cringeLevelUpLine(level, userMention) {
  const lines = {
    2:  `🚧 ${userMention} unlocked **Pool’s Closed**. Lifeguard is imaginary.`,
    5:  `🪑 ${userMention} is now **Chair Rotator (PRO)**. Spin responsibly.`,
    8:  `🧢 ${userMention} achieved **Fake HC Member**. Badge? Never heard of it.`,
    12: `🧃 ${userMention} unlocked **HC Member (Trust Me)**. Source: “trust me”.`,
    16: `🪙 🚨 WARNING: ${userMention} has reached **Coin Beggar** status.`,
    20: `🚪 ${userMention} promoted to **Club NX Bouncer**. Pay: exposure.`,
    25: `🕺 DANGER: ${userMention} is now a **Dancefloor Menace**. Everyone in radius is at risk.`,
    30: `🪙 ${userMention} is now **Definitely Legit**. Nothing to see here.`,
    40: `🌱 INTERVENTION: ${userMention} unlocked **Touch Grass Challenge Failed**.`,
    50: `🏨 FINAL FORM: ${userMention} became **Hotel Legend (Unemployed)**. The hotel owns you now.`,
  };

  return lines[level] || `✨ ${userMention} leveled up to **Level ${level}**.`;
}

async function announceLevelUp(guild, fallbackChannel, user, newLevel) {
  const userMention = `<@${user.id}>`;
  const line = cringeLevelUpLine(newLevel, userMention);

  // Post to level-up channel if set, else fallback
  const levelUpId = config.levelUpChannelId;
  let postedChannel = null;

  if (levelUpId) {
    const ch = guild.channels.cache.get(levelUpId);
    if (ch) {
      postedChannel = ch;
      await ch.send({ content: line }).catch(() => {});
    }
  }

  if (!postedChannel && fallbackChannel) {
    postedChannel = fallbackChannel;
    await fallbackChannel.send({ content: line }).catch(() => {});
  }

  // Log to modlog
  if (config.logChannelId) {
    const embed = new EmbedBuilder()
      .setTitle("✨ Level Up")
      .setDescription(line)
      .addFields({ name: "Level", value: String(newLevel), inline: true })
      .setTimestamp();
    logEmbed(guild, embed);
  }
}

async function applyLevelRoles(member, level) {
  const pairs = getLevelRoleIdsSorted();
  if (!pairs.length) return;

  const me = member.guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;

  // Find highest eligible level role
  const eligible = pairs.filter((p) => p.lvl <= level);
  if (!eligible.length) return;

  const targetRoleId = eligible[eligible.length - 1].roleId;
  const targetRole = member.guild.roles.cache.get(targetRoleId);
  if (targetRole) {
    await member.roles.add(targetRole).catch(() => {});
  }
}

// Removes *all* configured level roles
async function removeAllLevelRoles(member) {
  const pairs = getLevelRoleIdsSorted();
  if (!pairs.length) return;

  const me = member.guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;

  for (const { roleId } of pairs) {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId).catch(() => {});
    }
  }
}

// Level up logic used for XP gain
async function processLevelUps({ guild, channel, userObj, userDiscord, member }) {
  let leveledTo = null;

  while (userObj.xp >= xpNeeded(userObj.level)) {
    userObj.xp -= xpNeeded(userObj.level);
    userObj.level += 1;
    leveledTo = userObj.level;

    // Announce (normal leveling only)
    if (guild && channel && userDiscord) {
      await announceLevelUp(guild, channel, userDiscord, userObj.level);
    }

    if (member) {
      await applyLevelRoles(member, userObj.level);
    }
  }

  return leveledTo; // null if no level up
}

// -------------------- Optional harmless prefix command --------------------
function makeToyCode() {
  return "cher-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// -------------------- Prefix commands + XP --------------------
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    // Optional prefix command
    if (message.content.trim().toLowerCase() === "!code") {
      return message.reply(`🧾 Cherbot code: **${makeToyCode()}**`);
    }

    // IMPORTANT: Cherbot must NEVER respond to !getcode
    if (message.content.trim().toLowerCase() === "!getcode") return;

    // XP system
    const xpMin = Number(config.xpMin ?? 10);
    const xpMax = Number(config.xpMax ?? 20);
    const cooldownSeconds = Number(config.cooldownSeconds ?? 60);

    const userObj = ensureUser(message.author.id);
    const now = Date.now();
    if (now - (userObj.lastXpAt || 0) < cooldownSeconds * 1000) return;

    const gained = randInt(xpMin, xpMax);
    userObj.lastXpAt = now;
    userObj.xp += gained;

    const member = await message.guild.members.fetch(message.author.id).catch(() => null);

    await processLevelUps({
      guild: message.guild,
      channel: message.channel,
      userObj,
      userDiscord: message.author,
      member,
    });

    saveData(data);
  } catch (err) {
    console.error("messageCreate error:", err);
  }
});

// -------------------- Join/Leave logs (optional) --------------------
client.on("guildMemberAdd", (member) => {
  if (!config.logChannelId) return;
  const embed = new EmbedBuilder()
    .setTitle("✅ Member Joined")
    .setColor(0x57F287)
    .setDescription(`<@${member.user.id}> joined the server.`)
    .addFields(
      { name: "User", value: member.user.tag, inline: true },
      { name: "ID", value: member.user.id, inline: true }
    )
    .setTimestamp();

  logEmbed(member.guild, embed);
});

client.on("guildMemberRemove", (member) => {
  if (!config.logChannelId) return;
  const embed = new EmbedBuilder()
    .setTitle("🚪 Member Left")
    .setColor(0xED4245)
    .setDescription(`<@${member.user.id}> left the server.`)
    .addFields(
      { name: "User", value: member.user.tag, inline: true },
      { name: "ID", value: member.user.id, inline: true }
    )
    .setTimestamp();

  logEmbed(member.guild, embed);
});

// -------------------- Self-role menu helpers --------------------
function buildRoleMenuComponents(guild, roleIds) {
  const roles = roleIds
    .map((id) => guild.roles.cache.get(id))
    .filter(Boolean)
    .slice(0, 25);

  const rows = [];
  for (let i = 0; i < roles.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const role of roles.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`selfrole:${role.id}`)
          .setLabel(role.name.slice(0, 80))
          .setStyle(ButtonStyle.Secondary)
      );
    }
    rows.push(row);
  }
  return rows;
}

// -------------------- Interactions (buttons + slash commands) --------------------
client.on("interactionCreate", async (interaction) => {
  try {
    // -------- Buttons (self roles) --------
    if (interaction.isButton()) {
      const id = interaction.customId;
      if (!id.startsWith("selfrole:")) return;

      const roleId = id.split(":")[1];
      if (!data.selfRoles.includes(roleId)) {
        return interaction.reply({ content: "❌ That role is no longer self-assignable.", ephemeral: true });
      }

      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) return interaction.reply({ content: "❌ Role not found.", ephemeral: true });

      const me = interaction.guild.members.me;
      if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return interaction.reply({ content: "❌ I need **Manage Roles** permission.", ephemeral: true });
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const already = member.roles.cache.has(roleId);

      try {
        if (already) await member.roles.remove(role);
        else await member.roles.add(role);

        if (config.logChannelId) {
          const embed = new EmbedBuilder()
            .setTitle("🎭 Role Toggle")
            .setDescription(`${interaction.user} ${already ? "removed" : "added"} ${role}`)
            .setTimestamp();
          logEmbed(interaction.guild, embed);
        }

        return interaction.reply({
          content: `${already ? "Removed" : "Added"} ${role} ${already ? "from" : "to"} you.`,
          ephemeral: true
        });
      } catch {
        return interaction.reply({ content: "❌ I couldn’t change that role. Check my role position.", ephemeral: true });
      }
    }

    // -------- Slash Commands --------
    if (!interaction.isChatInputCommand()) return;

    // Defer only the slower ones
    if (["leaderboard", "rolemenu"].includes(interaction.commandName)) {
      await interaction.deferReply({ ephemeral: true });
    }

    // Cherbot must never be your verifier
    if (interaction.commandName === "getcode") {
      return interaction.reply({ content: "❌ Use the Verifier bot for codes.", ephemeral: true });
    }

    // ---------- MOD COMMANDS ----------
    const isMod = interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild);

    if (interaction.commandName === "stats") {
      if (!isMod) return interaction.reply({ content: "❌ Mods only.", ephemeral: true });

      const target = interaction.options.getUser("user", true);
      const u = ensureUser(target.id);
      const lastXp = u.lastXpAt ? `<t:${Math.floor(u.lastXpAt / 1000)}:R>` : "Never";

      const embed = new EmbedBuilder()
        .setTitle("📊 User Stats")
        .addFields(
          { name: "User", value: `${target}`, inline: true },
          { name: "Level", value: String(u.level), inline: true },
          { name: "XP", value: `${u.xp} / ${xpNeeded(u.level)}`, inline: true },
          { name: "Last XP Gain", value: lastXp, inline: false }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === "xpreset") {
      if (!isMod) return interaction.reply({ content: "❌ Mods only.", ephemeral: true });

      const target = interaction.options.getUser("user", true);
      const newLevel = interaction.options.getInteger("level") ?? 1;

      if (newLevel < 1) return interaction.reply({ content: "Level must be 1 or higher.", ephemeral: true });

      data.users[target.id] = { level: newLevel, xp: 0, lastXpAt: 0 };
      saveData(data);

      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (member) {
        await removeAllLevelRoles(member);
        await applyLevelRoles(member, newLevel);
      }

      return interaction.reply({
        content: `🔄 Reset **${target.tag}** to **Level ${newLevel}** (XP = 0).`,
        ephemeral: true
      });
    }

    if (interaction.commandName === "givexp") {
      if (!isMod) return interaction.reply({ content: "❌ Mods only.", ephemeral: true });

      const target = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);

      if (amount === 0) {
        return interaction.reply({ content: "Amount must not be 0.", ephemeral: true });
      }

      const u = ensureUser(target.id);
      u.xp = Math.max(0, u.xp + amount); // allow negative but don't go below 0
      saveData(data);

      const member = await interaction.guild.members.fetch(target.id).catch(() => null);

      // For mod-awarded XP: we level up silently (no cringe spam)
      // We still apply roles correctly.
      let leveledTo = null;
      while (u.xp >= xpNeeded(u.level)) {
        u.xp -= xpNeeded(u.level);
        u.level += 1;
        leveledTo = u.level;
      }
      saveData(data);

      if (member) {
        await removeAllLevelRoles(member);
        await applyLevelRoles(member, u.level);
      }

      return interaction.reply({
        content:
          `✅ Updated **${target.tag}** by **${amount} XP**.\n` +
          `Now: **Level ${u.level}**, **${u.xp} / ${xpNeeded(u.level)} XP**` +
          (leveledTo ? `\n(Leveled up to **${leveledTo}**)` : ""),
        ephemeral: true
      });
    }
    // ---------- END MOD COMMANDS ----------

    // ---------- Normal user commands ----------
    if (interaction.commandName === "level") {
      const target = interaction.options.getUser("user") || interaction.user;
      const u = ensureUser(target.id);

      const embed = new EmbedBuilder()
        .setTitle("📈 Level")
        .addFields(
          { name: "User", value: `${target}`, inline: true },
          { name: "Level", value: `${u.level}`, inline: true },
          { name: "XP", value: `${u.xp} / ${xpNeeded(u.level)}`, inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === "leaderboard") {
      const entries = Object.entries(data.users)
        .map(([id, u]) => ({ id, level: u.level, xp: u.xp }))
        .sort((a, b) => (b.level - a.level) || (b.xp - a.xp))
        .slice(0, 10);

      const lines = await Promise.all(entries.map(async (e, i) => {
        const user = await client.users.fetch(e.id).catch(() => null);
        const name = user ? user.tag : e.id;
        return `**${i + 1}.** ${name} — Level **${e.level}** (${e.xp} XP)`;
      }));

      const embed = new EmbedBuilder()
        .setTitle("🏆 Leaderboard")
        .setDescription(lines.join("\n") || "No data yet.")
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === "roleadmin") {
      const sub = interaction.options.getSubcommand();

      if (sub === "list") {
        const roles = data.selfRoles
          .map((id) => interaction.guild.roles.cache.get(id))
          .filter(Boolean)
          .map((r) => `${r}`);

        return interaction.reply({
          content: roles.length ? `Allowed roles:\n${roles.join("\n")}` : "No self-assignable roles set yet.",
          ephemeral: true
        });
      }

      const role = interaction.options.getRole("role", true);

      if (sub === "allow") {
        if (!data.selfRoles.includes(role.id)) data.selfRoles.push(role.id);
        saveData(data);
        return interaction.reply({ content: `✅ Allowed ${role} to be self-assigned.`, ephemeral: true });
      }

      if (sub === "disallow") {
        data.selfRoles = data.selfRoles.filter((id) => id !== role.id);
        saveData(data);
        return interaction.reply({ content: `✅ Disallowed ${role}.`, ephemeral: true });
      }
    }

    if (interaction.commandName === "role") {
      const sub = interaction.options.getSubcommand();
      const role = interaction.options.getRole("role", true);

      if (!data.selfRoles.includes(role.id)) {
        return interaction.reply({ content: "❌ That role is not self-assignable.", ephemeral: true });
      }

      const me = interaction.guild.members.me;
      if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return interaction.reply({ content: "❌ I need the Manage Roles permission.", ephemeral: true });
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);

      try {
        if (sub === "add") {
          await member.roles.add(role);
          return interaction.reply({ content: `✅ Added ${role} to you.`, ephemeral: true });
        }
        if (sub === "remove") {
          await member.roles.remove(role);
          return interaction.reply({ content: `✅ Removed ${role} from you.`, ephemeral: true });
        }
      } catch {
        return interaction.reply({ content: "❌ I couldn’t change that role. Check my role position.", ephemeral: true });
      }
    }

    if (interaction.commandName === "rolemenu") {
      const title = interaction.options.getString("title") || "Pick your roles";
      const desc = interaction.options.getString("description") || "Click a button to toggle a role.";

      const allowed = data.selfRoles.slice();
      const rows = buildRoleMenuComponents(interaction.guild, allowed);

      if (!rows.length) {
        return interaction.editReply({ content: "No allowed roles yet. Use `/roleadmin allow` first." });
      }

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(desc)
        .setTimestamp();

      await interaction.channel.send({ embeds: [embed], components: rows });
      return interaction.editReply({ content: "✅ Role menu posted." });
    }

  } catch (err) {
    console.error("interactionCreate error:", err);
    if (interaction?.isRepliable?.()) {
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: "❌ Something went wrong.", ephemeral: true });
        } else {
          await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true });
        }
      } catch {}
    }
  }
});

// -------------------- Login --------------------
const token = (process.env.DISCORD_TOKEN || config.token || "").trim();

if (!token) {
  console.error("❌ No Discord token found.");
  process.exit(1);
}


