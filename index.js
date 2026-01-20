// Cherbot (Discord.js v14) — clean + stable
// NO getcode (so it won't clash with Verifier)
// Adds: /stats, /xpreset, /givexp (mods only)
// Adds: MAIN raffle + MINI raffles + @gamba ping + mains-left + split + total + /roll
// Adds: /giveaway start/end/reroll with join button + winner channel + sweeper

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
    GatewayIntentBits.MessageContent, // XP + prefix command + raffles
    GatewayIntentBits.GuildMembers,   // role ops + join/leave logs
  ],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  ensureGiveawayData();
  ensureRaffleData();

  // Giveaway sweeper (ends giveaways on time, survives restarts)
  setInterval(() => giveawaySweep(client).catch(() => {}), 30 * 1000);
});

// -------------------- Data storage --------------------
const DATA_FILE = path.join(__dirname, "data.json");

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return {
      users: {},
      selfRoles: [],
      giveaways: {},
      raffles: {},
      raffleReservations: {},
      miniThreads: {},
      pendingMiniReserves: {}, // guildId -> number of mains reserved for minis not drawn yet
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return parsed || {};
  } catch {
    return {
      users: {},
      selfRoles: [],
      giveaways: {},
      raffles: {},
      raffleReservations: {},
      miniThreads: {},
      pendingMiniReserves: {},
    };
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
  if (!data.users) data.users = {};
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

function gambaMention() {
  const rid = String(config.gambaRoleId || "").trim();
  return rid ? `<@&${rid}>` : "";
}

// -------------------- Giveaway helpers --------------------
function ensureGiveawayData() {
  if (!data.giveaways) data.giveaways = {}; // messageId -> giveaway object
}

function parseDurationToMs(input) {
  // supports: 10m, 2h, 1d
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

async function endGiveawayByMessageId(guild, messageId, { reroll = false } = {}) {
  ensureGiveawayData();
  const g = data.giveaways[messageId];
  if (!g) return { ok: false, reason: "Giveaway not found in data.json." };

  // Normal end: don’t end twice
  if (g.ended && !reroll) return { ok: false, reason: "Giveaway already ended." };

  const participants = Array.isArray(g.participants) ? g.participants : [];
  const winners = pickWinnersFrom(participants, Number(g.winners) || 1);

  // Mark ended if not already
  g.ended = true;
  g.endedAt = Date.now();
  g.lastWinners = winners;
  data.giveaways[messageId] = g;
  saveData(data);

  const prize = g.prize || "Giveaway";
  const winnerText = winners.length
    ? winners.map(id => `<@${id}>`).join(", ")
    : "_No valid entries_";

  const embed = new EmbedBuilder()
    .setTitle(reroll ? "🔁 Giveaway Reroll" : "🏁 Giveaway Ended")
   .setDescription(
  `**Prize:** ${prize}\n` +
  `**Winners:** ${winners}\n` +
  `**Ends:** <t:${Math.floor(endsAt / 1000)}:R>\n` +
  `**Entries:** **0**\n\n` +
  `Click the button below to enter!`
)
    .setTimestamp();

  // Announce winners in WINNER channel (fallback to giveaway channel)
  const winnerChId = String(config.giveawayWinnerChannelId || "").trim();
  const giveawayChId = String(g.channelId || "").trim();

  const winnerCh = winnerChId ? await guild.channels.fetch(winnerChId).catch(() => null) : null;
  const giveawayCh = giveawayChId ? await guild.channels.fetch(giveawayChId).catch(() => null) : null;

  const announceCh =
    (winnerCh && winnerCh.isTextBased() && winnerCh.type !== ChannelType.GuildVoice) ? winnerCh :
    (giveawayCh && giveawayCh.isTextBased() && giveawayCh.type !== ChannelType.GuildVoice) ? giveawayCh :
    null;

  if (announceCh) {
    await announceCh.send({
      content: winners.length ? winnerText : "",
      embeds: [embed],
    }).catch(() => {});
  }

  // Disable the join button on the ORIGINAL giveaway message (in giveaway channel)
  if (giveawayCh && giveawayCh.isTextBased()) {
    try {
      const msg = await giveawayCh.messages.fetch(messageId);

      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`giveaway:enter:${messageId}`)
          .setLabel("Giveaway Ended")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );

      await msg.edit({ components: [disabledRow] }).catch(() => {});
    } catch {}
  }

  return { ok: true, winners };
}

async function giveawaySweep(client) {
  ensureGiveawayData();
  const now = Date.now();

  for (const [messageId, g] of Object.entries(data.giveaways)) {
    if (!g || g.ended) continue;
    if (!g.endsAt || now < g.endsAt) continue;

    const guild = client.guilds.cache.get(g.guildId);
    if (!guild) continue;

    await endGiveawayByMessageId(guild, messageId).catch(() => {});
  }
}

// -------------------- Raffle / Mini storage --------------------
function ensureRaffleData() {
  if (!data.raffles) data.raffles = {}; // key guildId:channelId -> raffle
  if (!data.raffleReservations) data.raffleReservations = {}; // guildId -> userId -> { remaining, expiresAt }
  if (!data.miniThreads) data.miniThreads = {}; // threadId -> { guildId, tickets, countedAtCreate }
  if (!data.pendingMiniReserves) data.pendingMiniReserves = {}; // guildId -> number
}

function raffleKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

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

  // Migration: if older data stored string userIds, convert to array
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
  return (
    t === "free" ||
    t === "0" ||
    t.includes("0 coin") ||
    t.includes("0coin") ||
    t.includes("giveaway") ||
    t.includes("gift")
  );
}

function countUserClaims(raffle, userId) {
  let c = 0;
  for (const owners of Object.values(raffle.claims || {})) {
    if (!owners) continue;
    if (Array.isArray(owners) && owners.includes(userId)) c++;
  }
  return c;
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

function parseCoinPrice(raffle) {
  const t = String(raffle.priceText || "");
  const m = t.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function formatBoardText(raffle) {
  const full = isRaffleFull(raffle) || !raffle.active;
  const status = full ? " ✅ **FULL / CLOSED**" : "";
  const header =
    `🎟️ Raffle: **${raffle.max} slots**` +
    (raffle.priceText ? ` (**${raffle.priceText}**)` : "") +
    status;

  const lines = [];
  for (let i = 1; i <= raffle.max; i++) {
    const owners = raffle.claims[String(i)];
    if (!owners || owners.length === 0) {
      lines.push(`${i}. _(available)_`);
    } else if (owners.length === 1) {
      lines.push(`${i}. <@${owners[0]}>`);
    } else {
      lines.push(`${i}. <@${owners[0]}> + <@${owners[1]}>`);
    }
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

// -------------------- Mains left + reservations --------------------
function getMainRaffleChannel(guild) {
  const id = String(config.raffleCreateChannelId || "").trim();
  if (!id) return null;
  return guild.channels.cache.get(id) || null;
}

function getPendingMiniReserve(guildId) {
  ensureRaffleData();
  return Number(data.pendingMiniReserves[guildId] || 0);
}

function addPendingMiniReserve(guildId, amount) {
  ensureRaffleData();
  const cur = Number(data.pendingMiniReserves[guildId] || 0);
  data.pendingMiniReserves[guildId] = Math.max(0, cur + Number(amount || 0));
  saveData(data);
}

function reservedRemainingTotal(guildId) {
  ensureRaffleData();

  // Active winner reservations
  const g = data.raffleReservations[guildId];
  let total = 0;
  const now = Date.now();

  if (g) {
    for (const [userId, r] of Object.entries(g)) {
      if (!r || now > r.expiresAt || r.remaining <= 0) {
        delete g[userId];
        continue;
      }
      total += Number(r.remaining) || 0;
    }
  }

  // Pending reserves from minis that exist but not drawn yet
  total += getPendingMiniReserve(guildId);

  saveData(data);
  return total;
}

function computeMainsLeft(mainRaffle, reservedTotal) {
  const claimed = countClaimedSlots(mainRaffle);
  return Math.max(0, (Number(mainRaffle.max) || 0) - claimed - reservedTotal);
}

async function announceMainsLeftIfChanged(guild, mainRaffle) {
  if (!guild || !mainRaffle?.max) return;
  const ch = getMainRaffleChannel(guild);
  if (!ch) return;

  const reservedTotal = reservedRemainingTotal(guild.id);
  const left = computeMainsLeft(mainRaffle, reservedTotal);

  if (mainRaffle.lastMainsLeftAnnounced === left) return;

  mainRaffle.lastMainsLeftAnnounced = left;
  saveData(data);

  await ch.send(`📌 **${left} MAINS LEFT**`).catch(() => {});
}

function getReservation(guildId, userId) {
  ensureRaffleData();
  const g = data.raffleReservations[guildId];
  if (!g || !g[userId]) return null;

  const r = g[userId];
  if (Date.now() > r.expiresAt || r.remaining <= 0) {
    delete g[userId];
    saveData(data);
    return null;
  }
  return r;
}

function setReservation(guildId, userId, remaining, minutes) {
  ensureRaffleData();
  if (!data.raffleReservations[guildId]) data.raffleReservations[guildId] = {};
  data.raffleReservations[guildId][userId] = {
    remaining,
    expiresAt: Date.now() + minutes * 60 * 1000,
  };
  saveData(data);
}

function useReservation(guildId, userId, used) {
  const r = getReservation(guildId, userId);
  if (!r) return null;
  r.remaining -= used;
  if (r.remaining <= 0) {
    delete data.raffleReservations[guildId][userId];
  }
  saveData(data);
  return r;
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
  let leveledTo = null;

  while (userObj.xp >= xpNeeded(userObj.level)) {
    userObj.xp -= xpNeeded(userObj.level);
    userObj.level += 1;
    leveledTo = userObj.level;

    if (guild && channel && userDiscord) {
      await announceLevelUp(guild, channel, userDiscord, userObj.level);
    }

    if (member) {
      await applyLevelRoles(member, userObj.level);
    }
  }

  return leveledTo;
}

// -------------------- Optional harmless prefix command --------------------
function makeToyCode() {
  return "cher-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// -------------------- Prefix commands + XP + raffles --------------------
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    ensureRaffleData();

    const content = message.content.trim();
    const isMod = message.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
    const inMainRaffleChannel = String(message.channel.id) === String(config.raffleCreateChannelId);
    const inMiniCreateChannel = String(message.channel.id) === String(config.miniCreateChannelId);

    // Optional prefix command
    if (content.toLowerCase() === "!code") {
      return message.reply(`🧾 Cherbot code: **${makeToyCode()}**`);
    }
    // IMPORTANT: Cherbot must NEVER respond to !getcode
    if (content.toLowerCase() === "!getcode") return;

    // -------------------- MAIN RAFFLE START --------------------
    // "!10 slots 50coins per" or "!10 slots"
    const startMatch = content.match(/^!(\d+)\s+slots(?:\s+(.+))?$/i);
    if (startMatch && inMainRaffleChannel) {
      if (!isMod) return message.reply("❌ Mods only.").catch(() => {});
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
      await announceMainsLeftIfChanged(message.guild, raffle);

      await message.reply(`✅ Raffle started: **${max} slots** (**${priceText}**). Type numbers to claim.`).catch(() => {});
      return;
    }

    // -------------------- MINI CREATE (message-based) --------------------
    // Formats:
    // !mini 4x - 50 coins        => tickets=4, miniSlots=default (6), mainTicketPrice=50
    // !mini 4x 4 - 50 coins      => tickets=4, miniSlots=4, mainTicketPrice=50
    const miniMatch = content.match(/^!mini\s+(\d+)\s*x(?:\s+(\d+))?\s*-\s*(\d+)\s*(?:c|coins?)$/i);
    if (miniMatch && inMiniCreateChannel) {
      if (!isMod) return message.reply("❌ Mods only.").catch(() => {});

      const tickets = Number(miniMatch[1]);
      const miniSlots = Number(miniMatch[2] || (config.miniDefaultSlots ?? 6));
      const mainTicketPrice = Number(miniMatch[3]);

      if (!Number.isFinite(tickets) || tickets < 1 || tickets > 50) {
        return message.reply("Tickets must be between 1 and 50.").catch(() => {});
      }
      if (!Number.isFinite(miniSlots) || miniSlots < 2 || miniSlots > 100) {
        return message.reply("Mini slots must be between 2 and 100.").catch(() => {});
      }
      if (!Number.isFinite(mainTicketPrice) || mainTicketPrice < 0 || mainTicketPrice > 1000000) {
        return message.reply("Mini price looks wrong.").catch(() => {});
      }

      const pot = tickets * mainTicketPrice;
      const perSlotExact = pot / miniSlots;
      const perSlot = Math.round(perSlotExact); // nearest whole number

      const title = `Mini for ${tickets} ticket(s)`;
      const threadName = `${title} – ${miniSlots} slots`;

      const thread = await message.channel.threads.create({
        name: threadName.slice(0, 100),
        autoArchiveDuration: 1440,
        reason: "Mini raffle created",
      }).catch(() => null);

      if (!thread) {
        return message.reply("❌ Could not create the mini thread. Check permissions.").catch(() => {});
      }

      // Count these tickets as "reserved by minis" immediately (until draw happens)
      addPendingMiniReserve(message.guild.id, tickets);

      data.miniThreads[thread.id] = {
        guildId: message.guild.id,
        tickets,
        createdAt: Date.now(),
        countedAtCreate: true,
      };
      saveData(data);

      const miniRaffle = getRaffle(message.guild.id, thread.id);
      miniRaffle.active = true;
      miniRaffle.max = miniSlots;
      miniRaffle.priceText = `${tickets}x main @ ${mainTicketPrice}c = ${pot}c pot • ${perSlot}c/slot`;
      miniRaffle.claims = {};
      miniRaffle.lastBoardMessageId = null;
      miniRaffle.createdAt = Date.now();
      saveData(data);

      const ping = gambaMention();
      if (ping) await thread.send(ping).catch(() => {});
      await postOrUpdateBoard(thread, miniRaffle);

      await thread.send(
        `🧾 **Mini created**\n` +
        `🎟️ Prize: **${tickets}** main ticket(s) @ **${mainTicketPrice}c** each = **${pot}c** pot\n` +
        `🔢 Mini slots: **${miniSlots}** → **${perSlot}c per slot** (rounded)\n\n` +
        `Claim by typing numbers like: \`1\` or \`1 2 3\``
      ).catch(() => {});

      // Announce in main raffle channel
      const mainCh = getMainRaffleChannel(message.guild);
      if (mainCh) {
        const mainRaffle = getRaffle(message.guild.id, mainCh.id);

        const reservedTotal = reservedRemainingTotal(message.guild.id);
        const left = computeMainsLeft(mainRaffle, reservedTotal);

        await mainCh.send(
          `🎲 **Mini created**: ${title}\n` +
          `✅ **${tickets} main slot(s) reserved for this mini**\n` +
          `📌 **${left} MAINS LEFT**\n` +
          `${ping ? ping : ""}`.trim()
        ).catch(() => {});

        await announceMainsLeftIfChanged(message.guild, mainRaffle);
      }

      await message.reply(`✅ Mini thread created: <#${thread.id}>`).catch(() => {});
      return;
    }

    // -------------------- MINI DRAW (run inside mini thread) --------------------
    if (/^!minidraw$/i.test(content)) {
      if (!isMod) return message.reply("❌ Mods only.").catch(() => {});
      const meta = data.miniThreads?.[message.channel.id];
      if (!meta) return message.reply("This isn’t a registered mini thread.").catch(() => {});

      const miniRaffle = getRaffle(message.guild.id, message.channel.id);
      const claimedNums = Object.entries(miniRaffle.claims || {}).filter(([, owners]) => Array.isArray(owners) && owners.length > 0);
      if (claimedNums.length === 0) return message.reply("No one has claimed any mini slots.").catch(() => {});

      const pick = claimedNums[randInt(0, claimedNums.length - 1)];
      const winningNumber = pick[0];
      const owners = pick[1];
      const winnerId = owners?.[0]; // winner is slot owner
      if (!winnerId) return message.reply("Couldn’t pick a winner.").catch(() => {});

      const minutes = Number(config.miniClaimWindowMinutes ?? 10);
      const tickets = Number(meta.tickets || 1);

      // Remove the pending reserve now that the mini is drawn
      if (meta.countedAtCreate) {
        addPendingMiniReserve(message.guild.id, -tickets);
        meta.countedAtCreate = false;
        data.miniThreads[message.channel.id] = meta;
        saveData(data);
      }

      setReservation(message.guild.id, winnerId, tickets, minutes);

      const mainCh = getMainRaffleChannel(message.guild);
      if (mainCh) {
        const mainRaffle = getRaffle(message.guild.id, mainCh.id);
        const reservedTotal = reservedRemainingTotal(message.guild.id);
        const left = computeMainsLeft(mainRaffle, reservedTotal);

        const ping = gambaMention();
        await mainCh.send(
          `🏆 **Mini winner**: <@${winnerId}> (won mini slot **#${winningNumber}**)\n` +
          `🎟️ You can claim **${tickets}** main number(s) here.\n` +
          `⏳ You have **${minutes} minutes**. Type numbers like: \`2 5 6\`\n` +
          `📌 **${left} MAINS LEFT**\n` +
          `${ping ? ping : ""}`.trim()
        ).catch(() => {});

        await announceMainsLeftIfChanged(message.guild, mainRaffle);
      }

      await message.reply(`🎉 Winner: <@${winnerId}> (slot #${winningNumber})`).catch(() => {});
      return;
    }

    // -------------------- SPLIT (two names on one slot) --------------------
    // split 7 @user   OR  !split 7 @user
    const splitMatch = content.match(/^!?split\s+(\d+)\s+<@!?(\d+)>$/i);
    if (splitMatch) {
      const raffle = getRaffle(message.guild.id, message.channel.id);
      if (!raffle.active) return message.reply("No active raffle here.").catch(() => {});

      const n = Number(splitMatch[1]);
      const friendId = splitMatch[2];

      if (n < 1 || n > raffle.max) return message.reply(`Pick 1-${raffle.max}.`).catch(() => {});
      if (isFreeRaffle(raffle)) return message.reply("❌ Splits are only allowed on paid raffles.").catch(() => {});

      const owners = raffle.claims[String(n)];
      if (!owners || owners.length === 0) return message.reply(`Slot #${n} is not claimed yet.`).catch(() => {});
      if (owners.length >= 2) return message.reply(`Slot #${n} is already split.`).catch(() => {});
      if (owners[0] === friendId) return message.reply("They’re already on that slot.").catch(() => {});

      if (owners[0] !== message.author.id && !isMod) {
        return message.reply("❌ Only the slot owner (or a mod) can split it.").catch(() => {});
      }

      raffle.claims[String(n)] = [owners[0], friendId];
      saveData(data);

      await postOrUpdateBoard(message.channel, raffle);
      await message.reply(`✅ Slot **#${n}** split: <@${owners[0]}> + <@${friendId}> (half each).`).catch(() => {});
      return;
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

        owners.forEach(uid => participants.add(uid));

        if (price != null) {
          const share = price / owners.length;
          owners.forEach(uid => perUser.set(uid, (perUser.get(uid) || 0) + share));
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

      await message.channel.send(lines.join("\n")).catch(() => {});
      return;
    }

    // -------------------- FREE (unclaim) --------------------
    // free          => frees all your slots (or removes you from split slots)
    // free 7        => (mods) frees a specific slot
    const freeMatch = content.match(/^free(?:\s+(\d+))?$/i);
    if (freeMatch) {
      const raffle = getRaffle(message.guild.id, message.channel.id);
      if (!raffle.active) return message.reply("No active raffle here.").catch(() => {});

      const numArg = freeMatch[1] ? Number(freeMatch[1]) : null;

      if (numArg == null) {
        const before = countUserClaims(raffle, message.author.id);
        if (before === 0) return message.reply("You don’t have any claimed numbers.").catch(() => {});

        for (const [num, owners] of Object.entries(raffle.claims)) {
          if (Array.isArray(owners) && owners.includes(message.author.id)) {
            const next = owners.filter(uid => uid !== message.author.id);
            if (next.length === 0) delete raffle.claims[num];
            else raffle.claims[num] = next;
          }
        }
        saveData(data);
        await postOrUpdateBoard(message.channel, raffle);

        if (inMainRaffleChannel) await announceMainsLeftIfChanged(message.guild, raffle);

        await message.reply(`🗑️ Freed your slots.`).catch(() => {});
        return;
      }

      if (!isMod) return message.reply("❌ Only mods can free a specific slot.").catch(() => {});
      if (numArg < 1 || numArg > raffle.max) return message.reply(`Pick 1-${raffle.max}.`).catch(() => {});

      if (!raffle.claims[String(numArg)] || raffle.claims[String(numArg)].length === 0) {
        return message.reply(`Slot #${numArg} is already available.`).catch(() => {});
      }

      delete raffle.claims[String(numArg)];
      saveData(data);
      await postOrUpdateBoard(message.channel, raffle);

      if (inMainRaffleChannel) await announceMainsLeftIfChanged(message.guild, raffle);

      await message.reply(`🧹 Slot **#${numArg}** is now available.`).catch(() => {});
      return;
    }

    // -------------------- REST (claim all remaining slots) --------------------
    if (/^rest$/i.test(content)) {
      const raffle = getRaffle(message.guild.id, message.channel.id);
      if (!raffle.active) return message.reply("No active raffle here.").catch(() => {});

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
      if (inMainRaffleChannel) await announceMainsLeftIfChanged(message.guild, raffle);

      await message.reply(`✅ You claimed the rest: **${filled}** slot(s).`).catch(() => {});

      if (isRaffleFull(raffle)) {
        raffle.active = false;
        saveData(data);
        await message.channel.send("✅ **FULL** — all slots have been claimed. Mods can now roll the winner 🎲").catch(() => {});
      }
      return;
    }

    // -------------------- CLAIM NUMBERS (type numbers) --------------------
    const nums = content.match(/\d+/g)?.map(n => Number(n)) ?? [];
    const looksLikeNumberClaim = nums.length > 0 && content.replace(/[0-9,\s]/g, "") === "";

    if (looksLikeNumberClaim) {
      const raffle = getRaffle(message.guild.id, message.channel.id);
      if (raffle.active) {
        const uniqueNums = [...new Set(nums)];
        const invalid = uniqueNums.filter(n => n < 1 || n > raffle.max);
        if (invalid.length) {
          await message.reply(`Pick numbers between 1 and ${raffle.max}. Invalid: ${invalid.join(", ")}`).catch(() => {});
          return;
        }

        const res = getReservation(message.guild.id, message.author.id);
        const freeMode = isFreeRaffle(raffle);
        const alreadyCount = countUserClaims(raffle, message.author.id);

        // FREE raffle: 1 per person unless they have a mini reservation
        if (freeMode && alreadyCount >= 1 && !res) {
          await message.reply(`This is a **FREE** raffle: you can only claim **1** slot. Use \`free\` to change it.`).catch(() => {});
          return;
        }

        let allowed;
        if (res) allowed = res.remaining;
        else if (freeMode) allowed = 1;
        else allowed = uniqueNums.length;

        const toTry = uniqueNums.slice(0, allowed);

        // Respect mains-left in main channel to prevent overselling (includes mini pending + winner reservations)
        if (inMainRaffleChannel && !res) {
          const reservedTotal = reservedRemainingTotal(message.guild.id);
          const mainsLeft = computeMainsLeft(raffle, reservedTotal);
          if (toTry.length > mainsLeft) {
            await message.reply(`Only **${mainsLeft}** main slot(s) left (mini reserves included).`).catch(() => {});
            return;
          }
        }

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

        if (res) useReservation(message.guild.id, message.author.id, claimed.length);

        await postOrUpdateBoard(message.channel, raffle);
        if (inMainRaffleChannel) await announceMainsLeftIfChanged(message.guild, raffle);

        const afterRes = getReservation(message.guild.id, message.author.id);
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
          await message.channel.send("✅ **FULL** — all slots have been claimed. Mods can now roll the winner 🎲").catch(() => {});
        }

        return; // no XP for raffle claim messages
      }
    }

    // -------------------- XP system --------------------
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
    // -------- Buttons --------
    if (interaction.isButton()) {
      const id = interaction.customId;

   // Giveaway join button + live counter update
if (id.startsWith("giveaway:enter:")) {
  ensureGiveawayData();
  const messageId = id.split(":")[2];
  const g = data.giveaways[messageId];

  if (!g) return interaction.reply({ content: "❌ This giveaway no longer exists.", ephemeral: true });
  if (g.ended) return interaction.reply({ content: "❌ This giveaway has ended.", ephemeral: true });

  if (!Array.isArray(g.participants)) g.participants = [];
  if (g.participants.includes(interaction.user.id)) {
    return interaction.reply({ content: "✅ You’re already entered!", ephemeral: true });
  }

  g.participants.push(interaction.user.id);
  data.giveaways[messageId] = g;
  saveData(data);

  // Update the giveaway message embed to show new entry count
  try {
    const giveawayChannelId = String(g.channelId || "").trim();


      // Selfrole button
      if (!id.startsWith("selfrole:")) return;

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

    if (["leaderboard", "rolemenu"].includes(interaction.commandName)) {
      await interaction.deferReply({ ephemeral: true });
    }

    if (interaction.commandName === "getcode") {
      return interaction.reply({ content: "❌ Use the Verifier bot for codes.", ephemeral: true });
    }

    const isMod = interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild);

    // ---------- /giveaway ----------
    if (interaction.commandName === "giveaway") {
      if (!isMod) return interaction.reply({ content: "❌ Mods only.", ephemeral: true });

      ensureGiveawayData();

      const sub = interaction.options.getSubcommand();

      if (sub === "start") {
        const prize = interaction.options.getString("prize", true);
        const durationStr = interaction.options.getString("duration", true);
        const winners = interaction.options.getInteger("winners", true);

        const ms = parseDurationToMs(durationStr);
        if (!ms) return interaction.reply({ content: "❌ Duration must look like `10m`, `2h`, or `1d`.", ephemeral: true });
        if (winners < 1 || winners > 50) return interaction.reply({ content: "❌ Winners must be 1–50.", ephemeral: true });

        const endsAt = Date.now() + ms;

        const embed = new EmbedBuilder()
          .setTitle("🎉 Giveaway Started")
          .setDescription(
            `**Prize:** ${prize}\n` +
            `**Winners:** ${winners}\n` +
            `**Ends:** <t:${Math.floor(endsAt / 1000)}:R>\n\n` +
            `Click the button below to enter!`
          )
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("giveaway:enter:pending")
            .setLabel("Join Giveaway")
            .setStyle(ButtonStyle.Success)
        );

        // Post in GIVEAWAY channel always
        const gwChannelId = String(config.giveawayChannelId || "").trim();
        const gwChannel = gwChannelId ? await interaction.guild.channels.fetch(gwChannelId).catch(() => null) : null;

        if (!gwChannel || !gwChannel.isTextBased()) {
          return interaction.reply({ content: "❌ Giveaway channel not found or not text-based. Check config.giveawayChannelId.", ephemeral: true });
        }

        const msg = await gwChannel.send({ embeds: [embed], components: [row] });

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`giveaway:enter:${msg.id}`)
            .setLabel("Join Giveaway")
            .setStyle(ButtonStyle.Success)
        );
        await msg.edit({ components: [row2] }).catch(() => {});

        data.giveaways[msg.id] = {
          guildId: interaction.guildId,
          channelId: gwChannel.id, // store the giveaway channel, not where slash was used
          prize,
          winners,
          endsAt,
          startedAt: Date.now(),
          ended: false,
          participants: [],
          hostId: interaction.user.id,
        };
        saveData(data);

        return interaction.reply({
          content: `✅ Giveaway started in <#${gwChannel.id}> (Message ID: \`${msg.id}\`)`,
          ephemeral: true
        });
      }

      if (sub === "end") {
        const messageId = interaction.options.getString("messageid", true);
        const result = await endGiveawayByMessageId(interaction.guild, messageId).catch(() => ({ ok: false, reason: "Failed to end giveaway." }));
        if (!result.ok) return interaction.reply({ content: `❌ ${result.reason}`, ephemeral: true });
        return interaction.reply({ content: "✅ Giveaway ended.", ephemeral: true });
      }

      if (sub === "reroll") {
        const messageId = interaction.options.getString("messageid", true);
        ensureGiveawayData();
        if (!data.giveaways[messageId]) return interaction.reply({ content: "❌ Giveaway not found.", ephemeral: true });

        const result = await endGiveawayByMessageId(interaction.guild, messageId, { reroll: true }).catch(() => ({ ok: false, reason: "Failed to reroll giveaway." }));
        if (!result.ok) return interaction.reply({ content: `❌ ${result.reason}`, ephemeral: true });
        return interaction.reply({ content: "✅ Rerolled winners.", ephemeral: true });
      }
    }

    // ---------- /roll ----------
    if (interaction.commandName === "roll") {
      const sides = Number(interaction.options.getString("die", true));
      const result = randInt(1, sides);

      const raffle = getRaffle(interaction.guildId, interaction.channelId);

      // Treat as raffle draw if slot count matches (even if raffle is closed/full)
      if (raffle?.max === sides && sides > 0) {
        const owners = raffle.claims[String(result)];
        const winnerUserId = owners?.[0] || null;

        const embed = new EmbedBuilder()
          .setTitle("🎲 Raffle draw")
          .setDescription(
            winnerUserId
              ? `Die: **d${sides}**\nWinning number: **#${result}**\nWinner: <@${winnerUserId}> 🎉`
              : `Die: **d${sides}**\nWinning number: **#${result}**\nWinner: _(unclaimed)_ 😬`
          )
          .setTimestamp();

        return interaction.reply({
          content: winnerUserId ? `<@${winnerUserId}>` : "",
          embeds: [embed],
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("🎲 Roll")
        .setDescription(`Die: **d${sides}**\nResult: **${result}**`)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // ---------- MOD COMMANDS ----------
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

      if (amount === 0) return interaction.reply({ content: "Amount must not be 0.", ephemeral: true });

      const u = ensureUser(target.id);
      u.xp = Math.max(0, u.xp + amount);
      saveData(data);

      const member = await interaction.guild.members.fetch(target.id).catch(() => null);

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
      const entries = Object.entries(data.users || {})
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

console.log("Bot starting...");
console.log("Token present?", Boolean(token), "Length:", token.length);

client.login(token).catch(console.error);


