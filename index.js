// Cherbot (Discord.js v14) — clean + stable
// NO getcode (so it won't clash with Verifier)
// Adds: /stats, /xpreset, /givexp (mods only)
// Adds: MAIN raffle (threads) + MINI raffles + @gamba ping + mains-left + split + total + /roll
// Adds: Giveaways (separate system) with join button + sweep auto-end

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
  ChannelType,
} = require("discord.js");

const config = require("./config.json");

// -------------------- Client --------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // XP + prefix + raffles
    GatewayIntentBits.GuildMembers,
  ],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  ensureGiveawayData();
  ensureRaffleData();
console.log("RAFFLE IDs:", config.raffleCreateChannelId, config.miniCreateChannelId);

  // giveaway sweep every 30s
  setInterval(() => giveawaySweep(client).catch(() => {}), 30 * 1000);
});

// -------------------- Data storage --------------------
const DATA_FILE = path.join(__dirname, "data.json");

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { users: {}, selfRoles: [], giveaways: {}, raffles: {}, reservations: {}, miniThreads: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!parsed.users) parsed.users = {};
    if (!parsed.selfRoles) parsed.selfRoles = [];
    if (!parsed.giveaways) parsed.giveaways = {};
    if (!parsed.raffles) parsed.raffles = {};
    if (!parsed.reservations) parsed.reservations = {};
    if (!parsed.miniThreads) parsed.miniThreads = {};
    return parsed;
  } catch {
    return { users: {}, selfRoles: [], giveaways: {}, raffles: {}, reservations: {}, miniThreads: {} };
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

function isModMember(member) {
  return Boolean(member?.permissions?.has(PermissionsBitField.Flags.ManageGuild));
}

function gambaMention() {
  const rid = String(config.gambaRoleId || "").trim();
  return rid ? `<@&${rid}>` : "";
}

// XP allow/block (optional)
function shouldAwardXp(channelId) {
  const allowed = Array.isArray(config.xpAllowedChannelIds) ? config.xpAllowedChannelIds.map(String) : [];
  const blocked = Array.isArray(config.xpBlockedChannelIds) ? config.xpBlockedChannelIds.map(String) : [];
  if (blocked.includes(String(channelId))) return false;
  if (allowed.length > 0 && !allowed.includes(String(channelId))) return false;
  return true;
}

// -------------------- Log channel helpers (optional) --------------------
function getLogChannel(guild) {
  const id = String(config.logChannelId || "").trim();
  if (!id) return null;
  return guild.channels.cache.get(id) || null;
}

function logEmbed(guild, embed) {
  const ch = getLogChannel(guild);
  if (!ch) return;
  ch.send({ embeds: [embed] }).catch(() => {});
}

// -------------------- Level roles helpers --------------------
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

  const levelUpId = String(config.levelUpChannelId || "").trim();
  let postedChannel = null;

  if (levelUpId) {
    const ch = guild.channels.cache.get(levelUpId);
    if (ch) {
      postedChannel = ch;
      await ch.send({ content: line }).catch(() => {});
    }
  }

  if (!postedChannel && fallbackChannel) {
    await fallbackChannel.send({ content: line }).catch(() => {});
  }

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

  const eligible = pairs.filter((p) => p.lvl <= level);
  if (!eligible.length) return;

  const targetRoleId = eligible[eligible.length - 1].roleId;
  const targetRole = member.guild.roles.cache.get(targetRoleId);
  if (targetRole) {
    await member.roles.add(targetRole).catch(() => {});
  }
}

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

async function processLevelUps({ guild, channel, userObj, userDiscord, member }) {
  while (userObj.xp >= xpNeeded(userObj.level)) {
    userObj.xp -= xpNeeded(userObj.level);
    userObj.level += 1;

    if (guild && channel && userDiscord) {
      await announceLevelUp(guild, channel, userDiscord, userObj.level);
    }
    if (member) await applyLevelRoles(member, userObj.level);
  }
}

// -------------------- Optional harmless prefix command --------------------
function makeToyCode() {
  return "cher-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// -------------------- Giveaway helpers --------------------
function ensureGiveawayData() {
  if (!data.giveaways) data.giveaways = {}; // messageId -> giveaway
}

function parseDurationToMs(input) {
  const s = String(input || "").trim().toLowerCase();
  const m = s.match(/^(\d+)\s*([mhd])$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return null;

  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  if (unit === "d") return n * 24 * 60 * 60 * 1000;
  return null;
}

function pickWinnersFrom(array, count) {
  const pool = [...new Set(array)];
  const winners = [];
  while (pool.length && winners.length < count) {
    const idx = randInt(0, pool.length - 1);
    winners.push(pool.splice(idx, 1)[0]);
  }
  return winners;
}

async function endGiveawayByMessageId(client, messageId, { reroll = false } = {}) {
  ensureGiveawayData();
  const g = data.giveaways[messageId];
  if (!g) return { ok: false, reason: "Giveaway not found." };
  if (g.ended && !reroll) return { ok: false, reason: "Giveaway already ended." };

  const guild = client.guilds.cache.get(g.guildId);
  if (!guild) return { ok: false, reason: "Guild not available." };

  const gwChannel = await guild.channels.fetch(g.channelId).catch(() => null);
  if (!gwChannel || !gwChannel.isTextBased()) return { ok: false, reason: "Giveaway channel not found." };

  const participants = Array.isArray(g.participants) ? g.participants : [];
  const winners = pickWinnersFrom(participants, Number(g.winners) || 1);

  g.ended = true;
  g.endedAt = Date.now();
  g.lastWinners = winners;
  data.giveaways[messageId] = g;
  saveData(data);

  const prize = g.prize || "Giveaway";
  const winnerText = winners.length ? winners.map((id) => `<@${id}>`).join(", ") : "_No valid entries_";

  const embed = new EmbedBuilder()
    .setTitle(reroll ? "🔁 Giveaway Reroll" : "🏁 Giveaway Ended")
    .setDescription(`**Prize:** ${prize}\n**Winners:** ${winnerText}`)
    .setTimestamp();

  // announce in winner channel if set
  const winnerChannelId = String(config.giveawayWinnerChannelId || "").trim();
  const winCh = winnerChannelId ? await guild.channels.fetch(winnerChannelId).catch(() => null) : null;

  const targetCh = (winCh && winCh.isTextBased()) ? winCh : gwChannel;

  await targetCh.send({ content: winners.length ? winnerText : "", embeds: [embed] }).catch(() => {});

  // disable button on original giveaway message
  try {
    const msg = await gwChannel.messages.fetch(messageId);
    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`giveaway:enter:${messageId}`)
        .setLabel("Giveaway Ended")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );
    await msg.edit({ components: [disabledRow] }).catch(() => {});
  } catch {}

  return { ok: true, winners };
}

async function giveawaySweep(client) {
  ensureGiveawayData();
  const now = Date.now();

  for (const [messageId, g] of Object.entries(data.giveaways)) {
    if (!g || g.ended) continue;
    if (!g.endsAt || now < g.endsAt) continue;
    await endGiveawayByMessageId(client, messageId).catch(() => {});
  }
}

// -------------------- Raffle / Mini storage --------------------
function ensureRaffleData() {
  if (!data.raffles) data.raffles = {};         // key -> raffle
  if (!data.reservations) data.reservations = {}; // mainKey -> userId -> {remaining, expiresAt}
  if (!data.miniThreads) data.miniThreads = {}; // miniThreadId -> { mainKey, tickets }
}

function raffleKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

// raffle object per thread/channel
function getRaffle(guildId, channelId) {
  ensureRaffleData();
  const key = raffleKey(guildId, channelId);
  if (!data.raffles[key]) {
    data.raffles[key] = {
      active: false,
      max: 0,
      priceText: "",
      claims: {}, // "1" -> ["userId"] or ["userId","userId2"]
      lastBoardMessageId: null,
      lastMainsLeftAnnounced: null,
      createdAt: Date.now(),
    };
    saveData(data);
  }

  // migrate string -> array
  const r = data.raffles[key];
  if (r?.claims && typeof r.claims === "object") {
    for (const [num, v] of Object.entries(r.claims)) {
      if (typeof v === "string") r.claims[num] = [v];
    }
  }
  return data.raffles[key];
}

function isFreeRaffle(raffle) {
  const t = String(raffle.priceText || "").trim().toLowerCase();
  if (!t) return true;
  return t === "free" || t === "0" || t.includes("0 coin") || t.includes("0coin");
}

function parseCoinPrice(raffle) {
  const t = String(raffle.priceText || "");
  const m = t.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function countClaimedSlots(raffle) {
  let claimed = 0;
  for (const owners of Object.values(raffle.claims || {})) {
    if (Array.isArray(owners) && owners.length > 0) claimed++;
  }
  return claimed;
}

function isRaffleFull(raffle) {
  return raffle.max > 0 && countClaimedSlots(raffle) >= raffle.max;
}

function countUserClaims(raffle, userId) {
  let c = 0;
  for (const owners of Object.values(raffle.claims || {})) {
    if (Array.isArray(owners) && owners.includes(userId)) c++;
  }
  return c;
}

function formatBoardText(raffle) {
  const closed = !raffle.active || isRaffleFull(raffle);
  const status = closed ? " ✅ **FULL / CLOSED**" : "";
  const header = `🎟️ Raffle: **${raffle.max} slots**${raffle.priceText ? ` (**${raffle.priceText}**)` : ""}${status}`;

  const lines = [];
  for (let i = 1; i <= raffle.max; i++) {
    const owners = raffle.claims[String(i)];
    if (!owners || owners.length === 0) lines.push(`${i}. _(available)_`);
    else if (owners.length === 1) lines.push(`${i}. <@${owners[0]}>`);
    else lines.push(`${i}. <@${owners[0]}> + <@${owners[1]}>`);
  }
  return `${header}\n\n${lines.join("\n")}`.slice(0, 1900);
}

async function postOrUpdateBoard(channel, raffle) {
  const text = formatBoardText(raffle);

  if (raffle.lastBoardMessageId) {
    const msg = await channel.messages.fetch(raffle.lastBoardMessageId).catch(() => null);
    if (msg) {
      await msg.edit({ content: text }).catch(() => {});
      return;
    }
  }

  const posted = await channel.send({ content: text }).catch(() => null);
  if (posted) {
    raffle.lastBoardMessageId = posted.id;
    saveData(data);
  }
}

// -------------------- Reservations (per main raffle thread) --------------------
function getReservation(mainKey, userId) {
  ensureRaffleData();
  const bucket = data.reservations[mainKey];
  if (!bucket || !bucket[userId]) return null;

  const r = bucket[userId];
  if (Date.now() > r.expiresAt || r.remaining <= 0) {
    delete bucket[userId];
    saveData(data);
    return null;
  }
  return r;
}

function setReservation(mainKey, userId, remaining, minutes) {
  ensureRaffleData();
  if (!data.reservations[mainKey]) data.reservations[mainKey] = {};
  data.reservations[mainKey][userId] = {
    remaining,
    expiresAt: Date.now() + minutes * 60 * 1000,
  };
  saveData(data);
}

function useReservation(mainKey, userId, used) {
  const r = getReservation(mainKey, userId);
  if (!r) return null;
  r.remaining -= used;
  if (r.remaining <= 0) delete data.reservations[mainKey][userId];
  saveData(data);
  return r;
}

function reservedTotal(mainKey) {
  ensureRaffleData();
  const bucket = data.reservations[mainKey];
  if (!bucket) return 0;

  const now = Date.now();
  let total = 0;

  for (const [uid, r] of Object.entries(bucket)) {
    if (!r || now > r.expiresAt || r.remaining <= 0) {
      delete bucket[uid];
      continue;
    }
    total += Number(r.remaining) || 0;
  }
  saveData(data);
  return total;
}

function computeMainsLeft(mainRaffle, mainKey) {
  const reserved = reservedTotal(mainKey);
  const claimed = countClaimedSlots(mainRaffle);
  return Math.max(0, (Number(mainRaffle.max) || 0) - claimed - reserved);
}

async function announceMainsLeftIfChanged(channel, mainRaffle, mainKey) {
  const left = computeMainsLeft(mainRaffle, mainKey);
  if (mainRaffle.lastMainsLeftAnnounced === left) return;
  mainRaffle.lastMainsLeftAnnounced = left;
  saveData(data);
  await channel.send(`📌 **${left} MAINS LEFT**`).catch(() => {});
}
// -------------------- Prefix commands + XP + raffles --------------------
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    // ...your raffle + XP code here...

  } catch (err) {
    console.error("messageCreate error:", err);
  }
});
// -------------------- Interactions (buttons + slash commands) --------------------
client.on("interactionCreate", async (interaction) => {
  try {
    // ---------- Buttons ----------
    if (interaction.isButton()) {
      const id = interaction.customId;

      // Giveaway join button
      if (id.startsWith("giveaway:enter:")) {
        ensureGiveawayData();

        const messageId = id.split(":")[2];
        const g = data.giveaways?.[messageId];

        if (!g) return interaction.reply({ content: "❌ This giveaway no longer exists.", ephemeral: true });
        if (g.ended) return interaction.reply({ content: "❌ This giveaway has ended.", ephemeral: true });

        if (!Array.isArray(g.participants)) g.participants = [];
        if (g.participants.includes(interaction.user.id)) {
          return interaction.reply({ content: "✅ You’re already entered!", ephemeral: true });
        }

        g.participants.push(interaction.user.id);
        data.giveaways[messageId] = g;
        saveData(data);

        return interaction.reply({
          content: `✅ Entered! Entries: **${g.participants.length}**`,
          ephemeral: true
        });
      }

      // Self-role buttons
      if (id.startsWith("selfrole:")) {
        const roleId = id.split(":")[1];

        if (!data.selfRoles?.includes(roleId)) {
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

          return interaction.reply({
            content: `${already ? "Removed" : "Added"} ${role} ${already ? "from" : "to"} you.`,
            ephemeral: true
          });
        } catch {
          return interaction.reply({
            content: "❌ I couldn’t change that role. Check my role position.",
            ephemeral: true
          });
        }
      }

      return;
    }

    // ---------- Slash Commands ----------
    if (!interaction.isChatInputCommand()) return;

    const isMod = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);

    // ✅ Your slash command handlers (/giveaway, /roll, etc) go here.

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

      // Self-role buttons
      if (id.startsWith("selfrole:")) {
        const roleId = id.split(":")[1];

        if (!data.selfRoles?.includes(roleId)) {
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

          return interaction.reply({
            content: `${already ? "Removed" : "Added"} ${role} ${already ? "from" : "to"} you.`,
            ephemeral: true
          });
        } catch {
          return interaction.reply({
            content: "❌ I couldn’t change that role. Check my role position.",
            ephemeral: true
          });
        }
      }

      return;
    }

    // ---------- Slash Commands ----------
    if (!interaction.isChatInputCommand()) return;

    // IMPORTANT: define isMod for interactions here, NOT using message
    const isMod = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);

    // Your /giveaway /roll /level /leaderboard /stats /xpreset /givexp handling
    // should be inside here (the slash command code you had before).

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

    // -------------------- Channel context helpers --------------------
    const raffleCreateId = String(config.raffleCreateChannelId || "").trim();
    const miniCreateId = String(config.miniCreateChannelId || "").trim();

    const inMainRaffleChannel =
      String(message.channel.id) === raffleCreateId ||
      String(message.channel.parentId || "") === raffleCreateId;

    const isThread =
      message.channel.type === ChannelType.PublicThread ||
      message.channel.type === ChannelType.PrivateThread ||
      Boolean(message.channel.isThread?.());

    const isThreadInRaffleCreate =
      isThread && String(message.channel.parentId || "") === raffleCreateId;

    const isMod = Boolean(
      message.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)
    );

    ensureRaffleData();
    ensureGiveawayData();

    const content = message.content.trim();

    // -------------------- Optional prefix command --------------------
    if (content.toLowerCase() === "!code") {
      return message.reply(`🧾 Cherbot code: **${makeToyCode()}**`).catch(() => {});
    }
    if (content.toLowerCase() === "!getcode") return;

    // ✅ EVERYTHING ELSE (raffle start, mini, draw, split, total, free, rest, claims, XP)
    // stays here exactly as you already have it.

    // (leave the rest of your existing messageCreate code untouched below this line)

  } catch (err) {
    console.error("messageCreate error:", err);
  }
});

    // ---------- Buttons ----------
    if (interaction.isButton()) {
      const id = interaction.customId;

      // Giveaway join button
      if (id.startsWith("giveaway:enter:")) {
        ensureGiveawayData();

        const messageId = id.split(":")[2];
        const g = data.giveaways?.[messageId];

        if (!g) return interaction.reply({ content: "❌ This giveaway no longer exists.", ephemeral: true });
        if (g.ended) return interaction.reply({ content: "❌ This giveaway has ended.", ephemeral: true });

        if (!Array.isArray(g.participants)) g.participants = [];
        if (g.participants.includes(interaction.user.id)) {
          return interaction.reply({ content: "✅ You’re already entered!", ephemeral: true });
        }

        g.participants.push(interaction.user.id);
        data.giveaways[messageId] = g;
        saveData(data);

        return interaction.reply({
          content: `✅ Entered! Entries: **${g.participants.length}**`,
          ephemeral: true
        });
      }

      // Self-role buttons
      if (id.startsWith("selfrole:")) {
        const roleId = id.split(":")[1];

        if (!data.selfRoles?.includes(roleId)) {
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

          return interaction.reply({
            content: `${already ? "Removed" : "Added"} ${role} ${already ? "from" : "to"} you.`,
            ephemeral: true
          });
        } catch {
          return interaction.reply({
            content: "❌ I couldn’t change that role. Check my role position.",
            ephemeral: true
          });
        }
      }

      return; // ignore other buttons
    }

    // ---------- Slash Commands ----------
    if (!interaction.isChatInputCommand()) return;

    const isMod = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);

    // Defer slow ones
    if (["leaderboard", "rolemenu"].includes(interaction.commandName)) {
      await interaction.deferReply({ ephemeral: true });
    }

    // Now you keep your existing slash command logic BELOW:
    // /giveaway, /roll, /level, /leaderboard, /stats, /xpreset, /givexp, etc.
    //
    // IMPORTANT:
    // If you already have those slash command handlers elsewhere, DO NOT paste them twice,
    // just move them into this block (or tell me and I’ll merge it cleanly).

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

    // -------------------- Channel context helpers --------------------
    const raffleCreateId = String(config.raffleCreateChannelId || "").trim();
    const miniCreateId = String(config.miniCreateChannelId || "").trim();

    const inMainRaffleChannel =
      String(message.channel.id) === raffleCreateId ||
      String(message.channel.parentId || "") === raffleCreateId;

    const inMiniCreateChannel =
      String(message.channel.id) === miniCreateId ||
      String(message.channel.parentId || "") === miniCreateId;

    const isThread =
      message.channel.type === ChannelType.PublicThread ||
      message.channel.type === ChannelType.PrivateThread ||
      Boolean(message.channel.isThread?.());

    const isThreadInRaffleCreate = isThread && String(message.channel.parentId || "") === raffleCreateId;

    const isMod = Boolean(
      message.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)
    );

    ensureRaffleData();

    const content = message.content.trim();

    // -------------------- MAIN RAFFLE START --------------------
    // Use inside a thread under raffleCreate channel
    const startMatch = content.match(/^!(\d+)\s+slots(?:\s+(.+))?$/i);
    if (startMatch && inMainRaffleChannel) {
      if (!isMod) return message.reply("❌ Mods only.").catch(() => {});
      if (!isThreadInRaffleCreate) {
        return message.reply("❌ Start the raffle **inside the thread** (not the parent channel).").catch(() => {});
      }

      const max = Number(startMatch[1]);
      const priceText = (startMatch[2]?.trim() || "FREE");

      if (!Number.isFinite(max) || max < 1 || max > 500) {
        return message.reply("Pick a slot amount between 1 and 500.").catch(() => {});
      }

      const raffle = getRaffle(message.guild.id, message.channel.id);
      raffle.active = true;
      raffle.max = max;
      raffle.priceText = priceText;
      raffle.claims = {};
      raffle.lastBoardMessageId = null;
      raffle.lastMainsLeftAnnounced = null;
      raffle.createdAt = Date.now();
      saveData(data);

      const ping = gambaMention();
      if (ping) await message.channel.send(ping).catch(() => {});

      await postOrUpdateBoard(message.channel, raffle);

      await message.reply(
        `✅ Raffle started: **${max} slots** (**${priceText}**).\nType numbers to claim like: \`1\` or \`2 5 6\``
      ).catch(() => {});
      return;
    }

    // -------------------- MINI CREATE --------------------
    // Must be run INSIDE a main raffle thread (under raffleCreate channel)
    // !mini 4x - 50 coins           => default mini slots (6)
    // !mini 4x 4 - 50 coins         => 4-slot mini
    const miniMatch = content.match(/^!mini\s+(\d+)\s*x(?:\s+(\d+))?\s*-\s*(\d+)\s*(?:c|coins?)$/i);
    if (miniMatch && inMainRaffleChannel) {
      if (!isMod) return message.reply("❌ Mods only.").catch(() => {});
      if (!isThreadInRaffleCreate) {
        return message.reply("❌ Run `!mini ...` **inside the main raffle thread**.").catch(() => {});
      }

      const tickets = Number(miniMatch[1]);
      const miniSlots = Number(miniMatch[2] || (config.miniDefaultSlots ?? 6));
      const mainTicketPrice = Number(miniMatch[3]);

      if (!Number.isFinite(tickets) || tickets < 1 || tickets > 50) {
        return message.reply("Tickets must be 1–50.").catch(() => {});
      }
      if (!Number.isFinite(miniSlots) || miniSlots < 2 || miniSlots > 100) {
        return message.reply("Mini slots must be 2–100.").catch(() => {});
      }
      if (!Number.isFinite(mainTicketPrice) || mainTicketPrice < 0 || mainTicketPrice > 1000000) {
        return message.reply("Price looks wrong.").catch(() => {});
      }

      const pot = tickets * mainTicketPrice;
      const perSlotExact = pot / miniSlots;
      const perSlot = Math.round(perSlotExact); // nearest whole number

      // Create mini thread in the mini create channel
      const miniCreateChannel = miniCreateId
        ? await message.guild.channels.fetch(miniCreateId).catch(() => null)
        : null;

      if (!miniCreateChannel || !miniCreateChannel.isTextBased()) {
        return message.reply("❌ miniCreateChannelId is wrong or not text-based.").catch(() => {});
      }

      const mainKey = raffleKey(message.guild.id, message.channel.id);

      const miniThread = await miniCreateChannel.threads.create({
        name: `${message.channel.name} - ${tickets} ticket(s) (${miniSlots} slots)`.slice(0, 100),
        autoArchiveDuration: 1440,
        reason: "Mini raffle created",
      }).catch(() => null);

      if (!miniThread) {
        return message.reply("❌ I couldn't create the mini thread (check permissions).").catch(() => {});
      }

      data.miniThreads[miniThread.id] = { mainKey, tickets, createdAt: Date.now() };
      saveData(data);

      const miniRaffle = getRaffle(message.guild.id, miniThread.id);
      miniRaffle.active = true;
      miniRaffle.max = miniSlots;
      miniRaffle.priceText = `${tickets}x main @ ${mainTicketPrice}c = ${pot}c pot • ${perSlot}c/slot (exact ${perSlotExact.toFixed(2)}c)`;
      miniRaffle.claims = {};
      miniRaffle.lastBoardMessageId = null;
      miniRaffle.createdAt = Date.now();
      saveData(data);

      const ping = gambaMention();
      if (ping) await miniThread.send(ping).catch(() => {});
      await postOrUpdateBoard(miniThread, miniRaffle);

      await miniThread.send(
        `🎲 **Mini created**\n` +
        `🎟️ Prize: **${tickets}** main ticket(s)\n` +
        `💰 Main ticket price: **${mainTicketPrice}c** → Pot: **${pot}c**\n` +
        `🔢 Mini slots: **${miniSlots}** → **${perSlot}c per slot**\n\n` +
        `Claim by typing numbers like: \`1\` or \`1 2 3\``
      ).catch(() => {});

      // Announce in main raffle thread
      await message.channel.send(
        `🎲 **Mini created:** <#${miniThread.id}>\n` +
        `✅ **${tickets} main slot(s) reserved for this mini**\n` +
        `${ping ? ping : ""}`.trim()
      ).catch(() => {});

      return message.reply(`✅ Mini thread created: <#${miniThread.id}>`).catch(() => {});
    }

    // -------------------- MINI DRAW (inside mini thread) --------------------
    if (/^!minidraw$/i.test(content)) {
      if (!isMod) return message.reply("❌ Mods only.").catch(() => {});

      const meta = data.miniThreads?.[message.channel.id];
      if (!meta) return message.reply("This isn’t a registered mini thread.").catch(() => {});

      const miniRaffle = getRaffle(message.guild.id, message.channel.id);
      const claimedEntries = Object.entries(miniRaffle.claims || {})
        .filter(([, owners]) => Array.isArray(owners) && owners.length > 0);

      if (claimedEntries.length === 0) {
        return message.reply("No one has claimed any mini slots.").catch(() => {});
      }

      const pick = claimedEntries[randInt(0, claimedEntries.length - 1)];
      const winningNumber = pick[0];
      const owners = pick[1];
      const winnerId = owners?.[0];

      if (!winnerId) return message.reply("Couldn’t pick a winner.").catch(() => {});

      const minutes = Number(config.miniClaimWindowMinutes ?? 10);
      const tickets = Number(meta.tickets || 1);
      const mainKey = meta.mainKey;

      const mainThreadId = mainKey.split(":")[1];
      const mainThread = await message.guild.channels.fetch(mainThreadId).catch(() => null);
      if (!mainThread || !mainThread.isTextBased()) {
        return message.reply("Main raffle thread not found.").catch(() => {});
      }

      setReservation(mainKey, winnerId, tickets, minutes);

      const ping = gambaMention();
      await mainThread.send(
        `🏆 **Mini winner:** <@${winnerId}> (won mini slot **#${winningNumber}**)\n` +
        `🎟️ Claim **${tickets}** main number(s) in this thread.\n` +
        `⏳ You have **${minutes} minutes**. Type numbers like: \`2 5 6\`\n` +
        `${ping ? ping : ""}`.trim()
      ).catch(() => {});

      await message.reply(`🎉 Winner: <@${winnerId}> (slot #${winningNumber}). Tagged in the main thread.`).catch(() => {});
      return;
    }

    // -------------------- SPLIT (paid raffles only) --------------------
    const splitMatch = content.match(/^!?split\s+(\d+)\s+<@!?(\d+)>$/i);
    if (splitMatch) {
      const raffle = getRaffle(message.guild.id, message.channel.id);
      if (!raffle.max) return message.reply("No raffle found here.").catch(() => {});

      const n = Number(splitMatch[1]);
      const friendId = splitMatch[2];

      if (n < 1 || n > raffle.max) return message.reply(`Pick 1-${raffle.max}.`).catch(() => {});
      if (isFreeRaffle(raffle)) return message.reply("❌ Split is only for paid raffles.").catch(() => {});

      const owners = raffle.claims[String(n)];
      if (!owners || owners.length === 0) return message.reply(`Slot #${n} is not claimed yet.`).catch(() => {});
      if (owners.length >= 2) return message.reply(`Slot #${n} is already split.`).catch(() => {});
      if (owners[0] !== message.author.id && !isMod) return message.reply("❌ Only the slot owner (or a mod) can split it.").catch(() => {});
      if (owners[0] === friendId) return message.reply("They’re already on that slot.").catch(() => {});

      raffle.claims[String(n)] = [owners[0], friendId];
      saveData(data);

      await postOrUpdateBoard(message.channel, raffle);
      return message.reply(`✅ Slot **#${n}** split: <@${owners[0]}> + <@${friendId}> (half each).`).catch(() => {});
    }

    // -------------------- TOTAL (mods only) --------------------
    if (/^total$/i.test(content)) {
      if (!isMod) return message.reply("❌ Mods only.").catch(() => {});
      const raffle = getRaffle(message.guild.id, message.channel.id);
      if (!raffle.max) return message.reply("No raffle found here.").catch(() => {});

      const price = parseCoinPrice(raffle);
      const perUser = new Map();
      const participants = new Set();
      let claimedSlots = 0;

      for (const owners of Object.values(raffle.claims || {})) {
        if (!owners || owners.length === 0) continue;
        claimedSlots++;
        owners.forEach((uid) => participants.add(uid));

        if (price != null) {
          const share = price / owners.length;
          owners.forEach((uid) => perUser.set(uid, (perUser.get(uid) || 0) + share));
        }
      }

      const lines = [];
      lines.push(`🎟️ Slots claimed: **${claimedSlots}/${raffle.max}**`);
      lines.push(`👥 Participants: **${participants.size}**`);

      if (price == null) {
        lines.push(`⚠️ Couldn’t read ticket price from the raffle text.`);
      } else {
        let grand = 0;
        for (const [uid, amt] of perUser.entries()) {
          const rounded = Math.round(amt);
          grand += rounded;
          lines.push(`• <@${uid}>: **${rounded}c**`);
        }
        lines.push(`💰 Total: **${grand}c**`);
      }

      return message.channel.send(lines.join("\n")).catch(() => {});
    }

    // -------------------- FREE --------------------
    const freeMatch = content.match(/^free(?:\s+(\d+))?$/i);
    if (freeMatch) {
      const raffle = getRaffle(message.guild.id, message.channel.id);
      if (!raffle.max) return message.reply("No raffle found here.").catch(() => {});

      const numArg = freeMatch[1] ? Number(freeMatch[1]) : null;

      if (numArg == null) {
        const before = countUserClaims(raffle, message.author.id);
        if (before === 0) return message.reply("You don’t have any claimed numbers.").catch(() => {});

        for (const [num, owners] of Object.entries(raffle.claims)) {
          if (Array.isArray(owners) && owners.includes(message.author.id)) {
            const next = owners.filter((uid) => uid !== message.author.id);
            if (next.length === 0) delete raffle.claims[num];
            else raffle.claims[num] = next;
          }
        }
        saveData(data);
        await postOrUpdateBoard(message.channel, raffle);
        return message.reply(`🗑️ Freed your slots.`).catch(() => {});
      }

      if (!isMod) return message.reply("❌ Only mods can free a specific slot number.").catch(() => {});
      if (numArg < 1 || numArg > raffle.max) return message.reply(`Pick 1-${raffle.max}.`).catch(() => {});

      if (!raffle.claims[String(numArg)] || raffle.claims[String(numArg)].length === 0) {
        return message.reply(`Slot #${numArg} is already available.`).catch(() => {});
      }

      delete raffle.claims[String(numArg)];
      saveData(data);
      await postOrUpdateBoard(message.channel, raffle);
      return message.reply(`🧹 Slot **#${numArg}** is now available.`).catch(() => {});
    }

    // -------------------- REST --------------------
    if (/^rest$/i.test(content)) {
      const raffle = getRaffle(message.guild.id, message.channel.id);
      if (!raffle.active || !raffle.max) return message.reply("No active raffle here.").catch(() => {});

      let filled = 0;
      for (let i = 1; i <= raffle.max; i++) {
        const key = String(i);
        const owners = raffle.claims[key];
        if (!owners || owners.length === 0) {
          raffle.claims[key] = [message.author.id];
          filled++;
        }
      }

      if (filled === 0) return message.reply("Nothing left to claim.").catch(() => {});
      saveData(data);

      await postOrUpdateBoard(message.channel, raffle);
      await message.reply(`✅ You claimed the rest: **${filled}** slot(s).`).catch(() => {});

      if (isRaffleFull(raffle)) {
        raffle.active = false;
        saveData(data);
        await message.channel.send("✅ **FULL** — all slots claimed. Mods can now `/roll` the winner 🎲").catch(() => {});
      }
      return;
    }

    // -------------------- CLAIM NUMBERS --------------------
    const nums = content.match(/\d+/g)?.map((n) => Number(n)) ?? [];
    const looksLikeNumberClaim =
      nums.length > 0 && content.replace(/[0-9,\s]/g, "") === "";

    if (looksLikeNumberClaim) {
      const raffle = getRaffle(message.guild.id, message.channel.id);
      if (raffle.active && raffle.max > 0) {
        const uniqueNums = [...new Set(nums)];
        const invalid = uniqueNums.filter((n) => n < 1 || n > raffle.max);
        if (invalid.length) {
          await message.reply(`Pick numbers between 1 and ${raffle.max}. Invalid: ${invalid.join(", ")}`).catch(() => {});
          return;
        }

        const mainKey = raffleKey(message.guild.id, message.channel.id);
        const res = getReservation(mainKey, message.author.id);
        const freeMode = isFreeRaffle(raffle);

        const alreadyCount = countUserClaims(raffle, message.author.id);
        if (freeMode && alreadyCount >= 1 && !res) {
          await message.reply("This is a **FREE** raffle: you can only claim **1** slot. Use `free` to change it.").catch(() => {});
          return;
        }

        const allowed = res ? res.remaining : uniqueNums.length;
        const toTry = uniqueNums.slice(0, allowed);

        const claimed = [];
        const taken = [];

        for (const n of toTry) {
          const key = String(n);
          const owners = raffle.claims[key];
          if (owners && owners.length > 0) taken.push(n);
          else {
            raffle.claims[key] = [message.author.id];
            claimed.push(n);
          }
        }

        if (!claimed.length) {
          await message.reply(`❌ None claimed. Taken: ${taken.length ? taken.join(", ") : "all requested slots were taken"}`).catch(() => {});
          return;
        }

        saveData(data);
        if (res) useReservation(mainKey, message.author.id, claimed.length);

        await postOrUpdateBoard(message.channel, raffle);

        const afterRes = getReservation(mainKey, message.author.id);
        const extra = afterRes
          ? `\nMini allowance left: **${afterRes.remaining}** (expires <t:${Math.floor(afterRes.expiresAt / 1000)}:R>)`
          : "";

        await message.reply(
          `✅ Claimed: **${claimed.join(", ")}**` +
          (taken.length ? `\nAlready taken: ${taken.join(", ")}` : "") +
          extra
        ).catch(() => {});

        if (isRaffleFull(raffle)) {
          raffle.active = false;
          saveData(data);
          await message.channel.send("✅ **FULL** — all slots claimed. Mods can now `/roll` the winner 🎲").catch(() => {});
        }

        return; // no XP for claim-only messages
      }
    }

    // -------------------- XP system --------------------
    if (!shouldAwardXp(message.channel.id)) return;

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
