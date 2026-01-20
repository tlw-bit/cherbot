// Cherbot (Discord.js v14) — clean + stable
// NO getcode (so it won't clash with Verifier)
// Adds: /stats, /xpreset, /givexp (mods only)
// Adds: Main raffles + mini raffles + mains left + /roll

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
    GatewayIntentBits.MessageContent, // XP + prefix + raffle
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

// -------------------- @gamba mention helper --------------------
function gambaMention() {
  const rid = String(config.gambaRoleId || "").trim();
  return rid ? `<@&${rid}>` : "";
}

// -------------------- Raffle storage + helpers --------------------
function ensureRaffleData() {
  if (!data.raffles) data.raffles = {}; // guildId:channelId -> raffle
  if (!data.raffleReservations) data.raffleReservations = {}; // guildId -> userId -> { remaining, expiresAt }
  if (!data.miniThreads) data.miniThreads = {}; // threadId -> { mainGuildId, tickets, title, createdAt }
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
      claims: {}, // "1" -> userId
      lastBoardMessageId: null,
      lastMainsLeftAnnounced: null,
      createdAt: Date.now(),
    };
    saveData(data);
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
  for (const uid of Object.values(raffle.claims)) {
    if (uid === userId) c++;
  }
  return c;
}

function isRaffleFull(raffle) {
  return raffle.max > 0 && Object.keys(raffle.claims).length >= raffle.max;
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
    const uid = raffle.claims[String(i)];
    lines.push(`${i}. ${uid ? `<@${uid}>` : "_(available)_"}`);
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

// -------- Mini reservations + mains left --------
function getMainRaffleChannel(guild) {
  const id = String(config.raffleCreateChannelId || "").trim();
  if (!id) return null;
  return guild.channels.cache.get(id) || null;
}

function reservedRemainingTotal(guildId) {
  ensureRaffleData();
  const g = data.raffleReservations[guildId];
  if (!g) return 0;

  let total = 0;
  const now = Date.now();

  for (const [userId, r] of Object.entries(g)) {
    if (!r || now > r.expiresAt || r.remaining <= 0) {
      delete g[userId];
      continue;
    }
    total += Number(r.remaining) || 0;
  }

  saveData(data);
  return total;
}

function computeMainsLeft(mainRaffle, reservedTotal) {
  const claimed = Object.keys(mainRaffle.claims || {}).length;
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

// -------------------- Level role helpers --------------------
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
    25: `🕺 DANGER: ${userMention} is now **Dancefloor Menace**. Everyone in radius is at risk.`,
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

    const content = message.content.trim();

    // Optional prefix command
    if (content.toLowerCase() === "!code") {
      return message.reply(`🧾 Cherbot code: **${makeToyCode()}**`);
    }

    // IMPORTANT: Cherbot must NEVER respond to !getcode
    if (content.toLowerCase() === "!getcode") return;

    const isMod = message.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
    const inMainRaffleChannel = String(message.channel.id) === String(config.raffleCreateChannelId);
    const inMiniCreateChannel = String(message.channel.id) === String(config.miniCreateChannelId);

    // -------------------- MAIN RAFFLE START (mods only, main raffle channel only) --------------------
    // "!10 slots 50coins per" or "!10 slots" (defaults FREE)
    const startMatch = content.match(/^!(\d+)\s+slots(?:\s+(.+))?$/i);
    if (startMatch && inMainRaffleChannel) {
      if (!isMod) {
        await message.reply("❌ Mods only.").catch(() => {});
        return;
      }

      const max = Number(startMatch[1]);
      const priceText = (startMatch[2]?.trim() || "FREE");

      if (!Number.isFinite(max) || max < 1 || max > 500) {
        await message.reply("Pick a slot amount between 1 and 500.").catch(() => {});
        return;
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

    // -------------------- MINI CREATE (mods only, mini create channel only) --------------------
    // Command format:
    // !mini golden cracked egg | tickets 4 | price 85 coins
    const miniCreateMatch = content.match(/^!mini\s+(.+)$/i);
    if (miniCreateMatch && inMiniCreateChannel) {
      if (!isMod) {
        await message.reply("❌ Mods only.").catch(() => {});
        return;
      }

      const parts = miniCreateMatch[1].split("|").map(s => s.trim()).filter(Boolean);
      const title = parts[0] || "mini";

      const ticketsPart = parts.find(p => /^tickets\s+\d+$/i.test(p));
      const tickets = ticketsPart ? Number(ticketsPart.match(/\d+/)[0]) : 1;

      const pricePart = parts.find(p => /^price\s+/i.test(p));
      const priceText = pricePart ? pricePart.replace(/^price\s+/i, "").trim() : "";

      if (!Number.isFinite(tickets) || tickets < 1 || tickets > 50) {
        await message.reply("Tickets must be between 1 and 50.").catch(() => {});
        return;
      }

      // Create a thread in the mini channel
      const threadName = `${title} – ${tickets} tickets`;
      const thread = await message.channel.threads.create({
        name: threadName.slice(0, 100),
        autoArchiveDuration: 1440,
        reason: "Mini raffle created",
      }).catch(() => null);

      if (!thread) {
        await message.reply("❌ Could not create the mini thread. Check permissions.").catch(() => {});
        return;
      }

      // Store mini metadata
      ensureRaffleData();
      data.miniThreads[thread.id] = {
        guildId: message.guild.id,
        tickets,
        title,
        createdAt: Date.now(),
      };
      saveData(data);

      // Start a mini raffle inside the thread (slots = tickets)
      const miniRaffle = getRaffle(message.guild.id, thread.id);
      miniRaffle.active = true;
      miniRaffle.max = tickets;
      miniRaffle.priceText = priceText ? `MINI • ${priceText}` : "MINI";
      miniRaffle.claims = {};
      miniRaffle.lastBoardMessageId = null;
      miniRaffle.createdAt = Date.now();
      saveData(data);

      const ping = gambaMention();
      if (ping) await thread.send(ping).catch(() => {});
      await postOrUpdateBoard(thread, miniRaffle);
      await thread.send(`📝 Type numbers to claim. Example: \`1\` or \`1 2\``).catch(() => {});

      // Announce reservation in main raffle channel
      const mainCh = getMainRaffleChannel(message.guild);
      if (mainCh) {
        const mainRaffle = getRaffle(message.guild.id, mainCh.id);
        const reservedTotal = reservedRemainingTotal(message.guild.id);
        const left = computeMainsLeft(mainRaffle, reservedTotal);

        const announce =
          `🎲 Mini raffle created: **${title}** (**${tickets}** slots reserved)\n` +
          `✅ **${tickets} slots reserved for mini** (Total reserved right now: **${reservedTotal}**)`;

        await mainCh.send(`${announce}\n${ping ? ping : ""}`.trim()).catch(() => {});
        await announceMainsLeftIfChanged(message.guild, mainRaffle);
      }

      await message.reply(`✅ Mini thread created: <#${thread.id}>`).catch(() => {});
      return;
    }

    // -------------------- MINI DRAW (mods only, run inside a mini thread) --------------------
    if (/^!minidraw$/i.test(content)) {
      if (!isMod) {
        await message.reply("❌ Mods only.").catch(() => {});
        return;
      }

      // Must be a thread, and must be registered mini
      ensureRaffleData();
      const meta = data.miniThreads?.[message.channel.id];
      if (!meta) {
        await message.reply("This isn’t a registered mini thread.").catch(() => {});
        return;
      }

      const miniRaffle = getRaffle(message.guild.id, message.channel.id);
      if (!miniRaffle.max) {
        await message.reply("Mini raffle has no slots set.").catch(() => {});
        return;
      }

      const claimedNums = Object.entries(miniRaffle.claims);
      if (claimedNums.length === 0) {
        await message.reply("No one has claimed any mini slots.").catch(() => {});
        return;
      }

      // Pick a random claimed slot
      const pick = claimedNums[randInt(0, claimedNums.length - 1)];
      const winningNumber = pick[0];
      const winnerId = pick[1];

      // Grant reservation to winner for MAIN raffle claims
      const minutes = Number(config.miniClaimWindowMinutes ?? 10);
      const tickets = Number(meta.tickets || 1);

      setReservation(message.guild.id, winnerId, tickets, minutes);

      // Announce in main raffle channel
      const mainCh = getMainRaffleChannel(message.guild);
      if (mainCh) {
        const mainRaffle = getRaffle(message.guild.id, mainCh.id);
        const reservedTotal = reservedRemainingTotal(message.guild.id);
        const left = computeMainsLeft(mainRaffle, reservedTotal);

        const ping = gambaMention();
        await mainCh.send(
          `🏆 Mini winner: <@${winnerId}> (won mini slot **#${winningNumber}**)\n` +
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

    // -------------------- FREE/UNCLAIM --------------------
    const freeMatch = content.match(/^free(?:\s+(\d+))?$/i);
    if (freeMatch) {
      const raffle = getRaffle(message.guild.id, message.channel.id);
      if (!raffle.active) {
        await message.reply("No active raffle in this channel/thread.").catch(() => {});
        return;
      }

      const numArg = freeMatch[1] ? Number(freeMatch[1]) : null;

      // Free your own (removes all your slots)
      if (numArg == null) {
        const before = countUserClaims(raffle, message.author.id);
        if (before === 0) {
          await message.reply("You don’t currently have any claimed numbers.").catch(() => {});
          return;
        }

        for (const [num, uid] of Object.entries(raffle.claims)) {
          if (uid === message.author.id) delete raffle.claims[num];
        }
        saveData(data);

        await postOrUpdateBoard(message.channel, raffle);

        // mains left update if this is the main raffle channel
        if (inMainRaffleChannel) {
          await announceMainsLeftIfChanged(message.guild, raffle);
        }

        await message.reply(`🗑️ Freed **${before}** slot(s) you owned.`).catch(() => {});
        return;
      }

      // Free specific slot (mods only)
      if (!isMod) {
        await message.reply("❌ Only mods can free a specific slot number. Use `free` to free your own.").catch(() => {});
        return;
      }

      if (numArg < 1 || numArg > raffle.max) {
        await message.reply(`Pick a number between 1 and ${raffle.max}.`).catch(() => {});
        return;
      }

      if (!raffle.claims[String(numArg)]) {
        await message.reply(`Slot **#${numArg}** is already available.`).catch(() => {});
        return;
      }

      delete raffle.claims[String(numArg)];
      saveData(data);

      await postOrUpdateBoard(message.channel, raffle);

      if (inMainRaffleChannel) {
        await announceMainsLeftIfChanged(message.guild, raffle);
      }

      await message.reply(`🧹 Slot **#${numArg}** is now available.`).catch(() => {});
      return;
    }

    // -------------------- REST (claim all remaining) --------------------
    if (/^rest$/i.test(content)) {
      const raffle = getRaffle(message.guild.id, message.channel.id);
      if (!raffle.active) {
        await message.reply("No active raffle in this channel/thread.").catch(() => {});
        return;
      }

      let filled = 0;
      for (let i = 1; i <= raffle.max; i++) {
        const key = String(i);
        if (!raffle.claims[key]) {
          raffle.claims[key] = message.author.id;
          filled++;
        }
      }

      if (filled === 0) {
        await message.reply("Nothing left to claim. All slots are taken.").catch(() => {});
        return;
      }

      saveData(data);
      await postOrUpdateBoard(message.channel, raffle);

      if (inMainRaffleChannel) {
        await announceMainsLeftIfChanged(message.guild, raffle);
      }

      await message.reply(`✅ You claimed the rest: **${filled}** slot(s).`).catch(() => {});

      if (isRaffleFull(raffle)) {
        raffle.active = false;
        saveData(data);
        await message.channel.send("✅ **FULL** — all slots have been claimed. Mods can now roll the winner 🎲").catch(() => {});
      }
      return;
    }

    // -------------------- CLAIM NUMBERS (single or multiple in one message) --------------------
    const nums = content.match(/\d+/g)?.map(n => Number(n)) ?? [];
    const looksLikeNumberClaim = nums.length > 0 && content.replace(/[0-9,\s]/g, "") === "";

    if (looksLikeNumberClaim) {
      const raffle = getRaffle(message.guild.id, message.channel.id);
      if (!raffle.active) {
        // ignore outside raffles
      } else {
        const uniqueNums = [...new Set(nums)];
        const invalid = uniqueNums.filter(n => n < 1 || n > raffle.max);
        if (invalid.length) {
          await message.reply(`Pick numbers between 1 and ${raffle.max}. Invalid: ${invalid.join(", ")}`).catch(() => {});
          return;
        }

        const res = getReservation(message.guild.id, message.author.id);
        const freeMode = isFreeRaffle(raffle);
        const alreadyCount = countUserClaims(raffle, message.author.id);

        // FREE main raffle: 1 per person (unless they have a mini reservation)
        if (freeMode && alreadyCount >= 1 && !res) {
          await message.reply(`This is a **FREE** raffle: you can only claim **1** slot. Use \`free\` to change it.`).catch(() => {});
          return;
        }

        // Allow rules:
        // - mini winner: up to reservation.remaining
        // - paid raffle: unlimited (all numbers in one message)
        // - free raffle: up to 1
        let allowed;
        if (res) allowed = res.remaining;
        else if (freeMode) allowed = 1;
        else allowed = uniqueNums.length;

        const toTry = uniqueNums.slice(0, allowed);

        // Prevent over-claiming MAINS left (respect reserved)
        if (inMainRaffleChannel) {
          const reservedTotal = reservedRemainingTotal(message.guild.id);
          const mainsLeft = computeMainsLeft(raffle, reservedTotal);
          if (!res && toTry.length > mainsLeft) {
            await message.reply(`Only **${mainsLeft}** main slot(s) left (mini reserves included).`).catch(() => {});
            return;
          }
        }

        const claimed = [];
        const taken = [];
        for (const n of toTry) {
          const key = String(n);
          if (raffle.claims[key]) taken.push(n);
          else {
            raffle.claims[key] = message.author.id;
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

        if (inMainRaffleChannel) {
          await announceMainsLeftIfChanged(message.guild, raffle);
        }

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

        return; // IMPORTANT: no XP for raffle claim messages
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

    const isMod = interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild);

    // ---------- /roll (dice + raffle winner ping) ----------
    if (interaction.commandName === "roll") {
      const sides = Number(interaction.options.getString("die", true)); // 4/6/8/10/20/50
      const result = randInt(1, sides);

      const raffle = getRaffle(interaction.guildId, interaction.channelId);

      // If active raffle exists here and slots match die, treat as raffle draw
      if (raffle?.active && raffle.max === sides) {
        const winnerUserId = raffle.claims[String(result)] || null;

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
    // ---------- END /roll ----------

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

    if (interaction.commandName === "rolemenu") {
      // Keep your existing rolemenu code if you have it registered, otherwise ignore
      return interaction.editReply({ content: "Rolemenu not configured here." }).catch(() => {});
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
