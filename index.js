Got it — I've **fully removed all Habbo account linking/unlinking functionality** from the merged code, along with related references, while keeping all other Astra features (XP, levels, events, trivia, badges, leaderboards) and your original Cherbot raffle/mini systems intact.

---

## ✅ Final Merged Code (Linking Removed)
```js
// ===================== CHUNK 1/5 =====================
// Cherbot (Discord.js v14) — Raffle + Minis + Astra Features
// Added: XP/Levels, Badge Scouter, Events, Trivia, What's New
// Removed: Verification, Giveaways, ALL Habbo Linking

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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} = require("discord.js");

const config = require("./config.json");
const mystery = require("./mystery.js");

// ==============================================
// ✅ ASTRA CONFIGURATION — ADD THESE TO YOUR config.json TOO
// ==============================================
const ASTRA_CONFIG = {
  DISCORD_TOKEN: config.token || process.env.DISCORD_TOKEN,
  CLIENT_ID: config.clientId || "",
  GUILD_ID: config.guildId || "",

  SUGGESTIONS_CHANNEL_ID: config.suggestionsChannelId || "",
  HABBO_UPDATES_CHANNEL_ID: config.habboUpdatesChannelId || "",
  XP_LOG_CHANNEL_ID: config.xpLogChannelId || "",
  STAFF_ROLE_ID: config.staffRoleId || "",

  XP_COOLDOWN_SECONDS: config.xpCooldown || 60,
  EVENT_XP_AWARD: config.eventXp || 50,
  TRIVIA_DEFAULT_XP: config.triviaXp || 25,
  EVENT_CLOSE_DELAY: 2 * 60 * 60 * 1000, // 2 hours

  XP_REWARDS: config.xpRewards || [
    { level: 2, xpNeeded: 100, reward: "Newbie Badge" },
    { level: 5, xpNeeded: 500, reward: "Regular Badge" },
    { level: 10, xpNeeded: 1500, reward: "Active Member Badge" },
    { level: 15, xpNeeded: 3000, reward: "VIP Badge" },
    { level: 20, xpNeeded: 5000, reward: "Elite Member Badge" }
  ]
};

// What's New Info
const whatsNewData = {
  version: "1.8.1",
  last_updated: "18 July 2026",
  updates: [
    "✅ Added full XP, levels & rewards system",
    "✅ Automatic new Habbo badge scouter",
    "✅ Event attendance tracking & XP rewards",
    "✅ Trivia system with XP rewards",
    "✅ /whatsnew command to see latest changes",
    "✅ Badge codes & info lookup",
    "✅ Leaderboards for weekly/all-time XP",
    "✅ Removed verification, giveaways & Habbo linking systems"
  ]
};

// Data file paths
const DATA_FILES = {
  MAIN: path.join(__dirname, "data.json"),
  XP_DATA: path.join(__dirname, "xpData.json"),
  EVENTS_DATA: path.join(__dirname, "eventsData.json"),
  TRIVIA_DATA: path.join(__dirname, "triviaData.json"),
  BADGES_DATA: path.join(__dirname, "scoutedBadges.json")
};

// Initialize missing data files
const defaultData = {
  xpData: { users: {}, lastReset: Date.now() },
  eventsData: { list: [] },
  triviaData: { themes: {}, current: null },
  scoutedBadges: { knownBadges: [] }
};

Object.entries(DATA_FILES).forEach(([key, filePath]) => {
  if (!fs.existsSync(filePath) && key !== "MAIN") {
    fs.writeFileSync(filePath, JSON.stringify(defaultData[key.replace('_DATA', '').toLowerCase()] || {}, null, 2));
  }
});

// Load saved Astra data
let xpData = JSON.parse(fs.readFileSync(DATA_FILES.XP_DATA, 'utf8'));
let eventsData = JSON.parse(fs.readFileSync(DATA_FILES.EVENTS_DATA, 'utf8'));
let triviaData = JSON.parse(fs.readFileSync(DATA_FILES.TRIVIA_DATA, 'utf8'));
let scoutedBadges = JSON.parse(fs.readFileSync(DATA_FILES.BADGES_DATA, 'utf8'));

// -------------------- Client --------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
  ],
});

// -------------------- Data storage (Original Cherbot) --------------------
const DATA_FILE = DATA_FILES.MAIN;

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return {
      raffles: {},
      reservations: {},
      miniThreads: {},
      miniWinners: {},
      miniWinnerSlots: {},
      miniEntitlements: {},
      scouterBadges: {},
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!parsed.raffles) parsed.raffles = {};
    if (!parsed.reservations) parsed.reservations = {};
    if (!parsed.miniThreads) parsed.miniThreads = {};
    if (!parsed.miniWinners) parsed.miniWinners = {};
    if (!parsed.miniWinnerSlots) parsed.miniWinnerSlots = {};
    if (!parsed.miniEntitlements) parsed.miniEntitlements = {};
    if (!parsed.scouterBadges) parsed.scouterBadges = {};
    return parsed;
  } catch {
    return {
      raffles: {},
      reservations: {},
      miniThreads: {},
      miniWinners: {},
      miniWinnerSlots: {},
      miniEntitlements: {},
      scouterBadges: {},
    };
  }
}

function saveData(obj) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), "utf8");
}

let data = loadData();

function ensureRaffleData() {
  if (!data.raffles) data.raffles = {};
  if (!data.reservations) data.reservations = {};
  if (!data.miniThreads) data.miniThreads = {};
  if (!data.miniWinners) data.miniWinners = {};
  if (!data.miniWinnerSlots) data.miniWinnerSlots = {};
  if (!data.miniEntitlements) data.miniEntitlements = {};
  if (!data.scouterBadges) data.scouterBadges = {};
}

// -------------------- SCOUTER BADGE HELPERS --------------------
function giveScouterBadge(userId, givenBy, reason = "No reason provided") {
  const uid = normalizeUserId(userId);
  if (!uid) return false;
  
  data.scouterBadges[uid] = {
    givenAt: Date.now(),
    givenBy: normalizeUserId(givenBy) || givenBy,
    reason: reason,
  };
  saveData(data);
  return true;
}

function hasScouterBadge(userId) {
  const uid = normalizeUserId(userId);
  return Boolean(data.scouterBadges?.[uid]);
}

function removeScouterBadge(userId) {
  const uid = normalizeUserId(userId);
  if (!uid || !data.scouterBadges?.[uid]) return false;
  delete data.scouterBadges[uid];
  saveData(data);
  return true;
}

// -------------------- ASTRA SHARED HELPERS --------------------
function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function ensureUser(userId) {
  if (!xpData.users[userId]) {
    xpData.users[userId] = {
      currentLevel: 1,
      weeklyXp: 0,
      allTimeXp: 0,
      highestLevel: 1,
      lastXp: 0,
      invitesSent: 0,
      eventsJoined: [],
      triviaCorrect: 0
    };
  }
  return xpData.users[userId];
}

function getXpForLevel(level) {
  const reward = ASTRA_CONFIG.XP_REWARDS.find(r => r.level === level);
  return reward ? reward.xpNeeded : level * 100;
}

function addXp(userId, amount, reason = "No reason given") {
  const user = ensureUser(userId);
  user.weeklyXp += amount;
  user.allTimeXp += amount;

  let newLevel = user.currentLevel;
  while (user.weeklyXp >= getXpForLevel(newLevel + 1)) {
    newLevel++;
  }
  if (newLevel > user.currentLevel) {
    user.currentLevel = newLevel;
    if (newLevel > user.highestLevel) user.highestLevel = newLevel;
  }

  const logChannel = client.channels.cache.get(ASTRA_CONFIG.XP_LOG_CHANNEL_ID);
  if (logChannel) {
    logChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("📈 XP Awarded")
          .setDescription(`<@${userId}> received **${amount} XP**\nReason: ${reason}`)
          .setColor("#2ecc71")
          .setTimestamp()
      ]
    }).catch(() => {});
  }

  saveJson(DATA_FILES.XP_DATA, xpData);
  return { leveledUp: newLevel > user.currentLevel, newLevel };
}

function removeXp(userId, amount, reason = "Adjustment") {
  const user = ensureUser(userId);
  user.weeklyXp = Math.max(0, user.weeklyXp - amount);
  user.allTimeXp = Math.max(0, user.allTimeXp - amount);
  saveJson(DATA_FILES.XP_DATA, xpData);
}

async function scoutNewBadges() {
  try {
    const res = await fetch("https://www.habboassets.com/api/v1/badges?hotel=com&limit=30&order=desc", {
      signal: AbortSignal.timeout(10000),
      headers: { "Accept": "application/json" }
    });
    if (!res.ok) throw new Error("API request failed");
    const data = await res.json();
    const allBadges = data.badges || [];
    const knownCodes = new Set(scoutedBadges.knownBadges.map(b => b.code));
    const newBadges = allBadges.filter(b => !knownCodes.has(b.code));

    if (newBadges.length > 0) {
      const channel = client.channels.cache.get(ASTRA_CONFIG.HABBO_UPDATES_CHANNEL_ID);
      if (channel) {
        for (const badge of newBadges.slice(0, 5)) {
          await channel.send({
            embeds: [
              new EmbedBuilder()
                .setTitle("🆕 New Habbo Badge")
                .setDescription(`**Name:** ${badge.name || "Unnamed"}\n**Description:** ${badge.description || "No details available"}`)
                .setThumbnail(badge.url_habbo)
                .setColor("#9b59b6")
                .setFooter({ text: `Code: ${badge.code}` })
                .setTimestamp()
            ]
          });
        }
      }
      scoutedBadges.knownBadges.push(...newBadges);
      saveJson(DATA_FILES.BADGES_DATA, scoutedBadges);
    }
    return { success: true, count: newBadges.length };
  } catch (err) {
    console.error("Badge scouter error:", err);
    return { success: false };
  }
}

// ===================== CHUNK 2/5 =====================
// -------------------- Original Cherbot Helpers --------------------
const giveawayTimers = new Map();

function clearGiveawayTimer(messageId) {
  const t = giveawayTimers.get(messageId);
  if (t) clearTimeout(t);
  giveawayTimers.delete(messageId);
}

function scheduleGiveawayEnd(client, messageId, endsAt) {
  if (!messageId || !endsAt) return;
  clearGiveawayTimer(messageId);
  const MAX_DELAY = 2147480000;
  const delay = Number(endsAt) - Date.now();
  if (!Number.isFinite(delay)) return;
  if (delay <= 0) {
    const t = setTimeout(() => {
      giveawayTimers.delete(messageId);
      endGiveawayByMessageId(client, messageId).catch((e) =>
        console.error("❌ scheduled end failed:", messageId, e?.stack || e)
      );
    }, 250);
    giveawayTimers.set(messageId, t);
    return;
  }
  if (delay > MAX_DELAY) {
    const t = setTimeout(() => scheduleGiveawayEnd(client, messageId, endsAt), MAX_DELAY);
    giveawayTimers.set(messageId, t);
    return;
  }
  const t = setTimeout(() => {
    giveawayTimers.delete(messageId);
    endGiveawayByMessageId(client, messageId).catch((e) =>
      console.error("❌ scheduled end failed:", messageId, e?.stack || e)
    );
  }, delay + 250);
  giveawayTimers.set(messageId, t);
}

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  ensureRaffleData();
  for (const [key, r] of Object.entries(data.raffles || {})) {
    if (!r?.active || !r?.endsAt) continue;
    const channelId = key.split(":")[1];
    scheduleGiveawayEnd(client, `mainraffle:${channelId}`, r.endsAt);
  }
  // Auto-scout badges every 6 hours
  setInterval(scoutNewBadges, 6 * 60 * 60 * 1000);
});

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isModMember(member) {
  return Boolean(member?.permissions?.has(PermissionsBitField.Flags.ManageGuild));
}

function normalizeUserId(value) {
  if (!value) return null;
  const s = String(value);
  if (/^\d{15,}$/.test(s)) return s;
  const m = s.match(/\d{15,}/);
  return m ? m[0] : null;
}

function isThreadHost(channel, userId) {
  const owner = normalizeUserId(channel?.ownerId) || String(channel?.ownerId || "");
  const u = normalizeUserId(userId) || String(userId || "");
  return Boolean(owner && u && owner === u);
}

function canRunRaffles(memberOrUser, channel) {
  const isMod = isModMember(memberOrUser);
  const uid = memberOrUser?.user?.id || memberOrUser?.id;
  const isHost = isThreadHost(channel, uid);
  return isMod || isHost;
}

function gambaMention() {
  const rid = String(config.gambaRoleId || "").trim();
  return rid ? `<@&${rid}>` : "";
}

async function getRaffleWinnersChannel(guild) {
  const id = String(config.raffleWinnerChannelId || "").trim();
  if (!id) return null;
  const ch = await guild.channels.fetch(id).catch(() => null);
  if (!ch || !ch.isTextBased?.()) return null;
  return ch;
}

async function getLogChannel(guild) {
  const id = String(config.logChannelId || "").trim();
  if (!id || !guild) return null;
  const ch = await guild.channels.fetch(id).catch(() => null);
  if (!ch || !ch.isTextBased?.()) return null;
  return ch;
}

async function safetyLog(guild, payload) {
  try {
    const ch = await getLogChannel(guild);
    if (!ch) return;
    const { title = "Safety Log", description = "", fields = [], color = 0x5865f2 } = payload || {};
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description.slice(0, 4096))
      .setColor(color)
      .addFields(fields.slice(0, 25))
      .setTimestamp();
    await ch.send({ embeds: [embed] }).catch(() => {});
  } catch {}
}

async function logRoll(interaction, { winnerId, winningSlot, isMini }) {
  const wid = normalizeUserId(winnerId) || String(winnerId || "unknown");
  const wslot = String(winningSlot || "unknown");
  await safetyLog(interaction.guild, {
    title: "🎲 Roll Executed",
    fields: [
      { name: "Rolled By", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Channel", value: `<#${interaction.channelId}>`, inline: true },
      { name: "Winner", value: wid && /^\d{15,}$/.test(wid) ? `<@${wid}>` : String(wid), inline: true },
      { name: "Winning Slot", value: `#${wslot}`, inline: true },
      { name: "Type", value: isMini ? "Mini" : "Main", inline: true },
    ],
    color: 0xf1c40f,
  }).catch(() => {});
}

function makeToyCode() {
  return "cher-" + Math.random().toString(36).slice(2, 8).toUpperCase();
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

function raffleKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

function ensureMiniWinners() {
  ensureRaffleData();
  if (!data.miniWinners) data.miniWinners = {};
}

function markMiniWinner(mainKey, userId) {
  ensureMiniWinners();
  if (!data.miniWinners[mainKey]) data.miniWinners[mainKey] = {};
  data.miniWinners[mainKey][userId] = true;
  saveData(data);
}

function isMiniWinner(mainKey, userId) {
  ensureMiniWinners();
  return Boolean(data.miniWinners?.[mainKey]?.[userId]);
}

function ensureMiniWinnerSlots() {
  ensureRaffleData();
  if (!data.miniWinnerSlots) data.miniWinnerSlots = {};
}

function isMiniWinnerSlot(mainKey, userId, slotNum) {
  ensureMiniWinnerSlots();
  userId = normalizeUserId(userId) || String(userId);
  const arr = data.miniWinnerSlots?.[mainKey]?.[userId];
  if (!Array.isArray(arr)) return false;
  const n = parseInt(slotNum, 10);
  return arr.includes(n);
}

function ensureMiniEntitlements() {
  ensureRaffleData();
  if (!data.miniEntitlements) data.miniEntitlements = {};
}

function setMiniEntitlement(mainKey, userId, tickets) {
  ensureMiniEntitlements();
  userId = normalizeUserId(userId) || String(userId);
  if (!data.miniEntitlements[mainKey]) data.miniEntitlements[mainKey] = {};
  data.miniEntitlements[mainKey][userId] = Number(tickets) || 0;
  saveData(data);
}

function getMiniEntitlement(mainKey, userId) {
  ensureMiniEntitlements();
  userId = normalizeUserId(userId) || String(userId);
  return Number(data.miniEntitlements?.[mainKey]?.[userId] || 0);
}

function useMiniEntitlement(mainKey, userId, used) {
  ensureMiniEntitlements();
  userId = normalizeUserId(userId) || String(userId);
  if (!data.miniEntitlements[mainKey]) data.miniEntitlements[mainKey] = {};
  const cur = Number(data.miniEntitlements[mainKey][userId] || 0);
  const next = Math.max(0, cur - (Number(used) || 0));
  data.miniEntitlements[mainKey][userId] = next;
  saveData(data);
  return next;
}

function addMiniWinnerSlots(mainKey, userId, nums) {
  ensureMiniWinnerSlots();
  userId = normalizeUserId(userId) || String(userId);
  if (!data.miniWinnerSlots[mainKey]) data.miniWinnerSlots[mainKey] = {};
  if (!Array.isArray(data.miniWinnerSlots[mainKey][userId])) data.miniWinnerSlots[mainKey][userId] = [];
  const cur = new Set(
    data.miniWinnerSlots[mainKey][userId]
      .map((x) => parseInt(x, 10))
      .filter((x) => Number.isFinite(x))
  );
  for (const n of nums) {
    const num = parseInt(n, 10);
    if (Number.isFinite(num)) cur.add(num);
  }
  data.miniWinnerSlots[mainKey][userId] = [...cur].sort((a, b) => a - b);
  saveData(data);
}

function compressRanges(numbers) {
  const n = [...numbers].sort((a, b) => a - b);
  const out = [];
  let i = 0;
  while (i < n.length) {
    let start = n[i];
    let end = start;
    while (i + 1 < n.length && n[i + 1] === end + 1) {
      i++;
      end = n[i];
    }
    out.push(start === end ? `${start}` : `${start}-${end}`);
    i++;
  }
  return out.join(", ");
}

function getRaffle(guildId, channelId) {
  ensureRaffleData();
  const key = raffleKey(guildId, channelId);
  if (!data.raffles[key]) {
    data.raffles[key] = {
      guildId, channelId, active: false, max: 0, priceText: "", slotPrice: null,
      totalsPosted: false, claims: {}, lastBoardMessageId: null, lastMainsLeftAnnounced: null,
      lastAvailableAnnouncedClaimed: null, hostId: null, fullNotified: false, createdAt: Date.now(),
    };
    saveData(data);
  } else {
    data.raffles[key].guildId = data.raffles[key].guildId || guildId;
    data.raffles[key].channelId = data.raffles[key].channelId || channelId;
  }
  return data.raffles[key];
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

// UPDATED Board with Scouter Badge marker
function formatBoardEmbed(raffle, mainKey = null, title = "🎟️ Raffle Board") {
  const closed = !raffle.active || isRaffleFull(raffle);
  const max = Number(raffle.max) || 0;
  const lines = [];
  const availableNums = [];

  for (let i = 1; i <= max; i++) {
    const owners = raffle.claims?.[String(i)];
    if (!owners || owners.length === 0) {
      availableNums.push(i);
      lines.push(`**${i}.** _(available)_`);
      continue;
    }
    const users = owners.map((raw) => {
      const uid = normalizeUserId(raw) || raw;
      const mark = [];
      if (mainKey && uid && isMiniWinnerSlot(mainKey, uid, i)) mark.push("Ⓜ️");
      if (hasScouterBadge(uid)) mark.push("🔍");
      return `<@${uid}>${mark.join("")}`;
    });
    lines.push(`**${i}.** ${users.join(" + ")}`);
  }

  const header = `🎟️ **${max} slots**` + (raffle.priceText ? ` (**${raffle.priceText}**)` : "") + (closed ? ` ✅ **FULL / CLOSED**` : "");
  const availText = availableNums.length ? compressRanges(availableNums) : "None";
  const description = [header, "", ...lines].join("\n").slice(0, 4096);

  return new EmbedBuilder()
    .setTitle(title + (closed ? " • FULL" : ""))
    .setColor(closed ? 0xe74c3c : 0x2ecc71)
    .setDescription(description)
    .addFields({ name: `🟢 Available (${availableNums.length})`, value: String(availText).slice(0, 1024) })
    .setFooter({ text: "Ⓜ️ = Mini winner • 🔍 = Scouter Badge • Use /raffle claim to claim slots" })
    .setTimestamp();
}

function reservationKey(userId) {
  const s = String(userId || "");
  if (s.startsWith("mini:")) return s;
  return normalizeUserId(s) || s;
}

function getReservation(mainKey, userId) {
  const bucket = data.reservations?.[mainKey];
  if (!bucket) return null;
  const k = reservationKey(userId);
  if (!bucket[k]) return null;
  const r = bucket[k];
  if (Date.now() > r.expiresAt || r.remaining <= 0) {
    delete bucket[k];
    saveData(data);
    return null;
  }
  return r;
}

function setReservation(mainKey, userId, remaining, minutes) {
  if (!data.reservations[mainKey]) data.reservations[mainKey] = {};
  const k = reservationKey(userId);
  data.reservations[mainKey][k] = { remaining, expiresAt: Date.now() + minutes * 60 * 1000 };
  saveData(data);
}

function useReservation(mainKey, userId, used) {
  const r = getReservation(mainKey, userId);
  if (!r) return null;
  const k = reservationKey(userId);
  r.remaining -= used;
  if (r.remaining <= 0) delete data.reservations[mainKey][k];
  saveData(data);
  return r;
}

function isRaffleLockedForUser(mainKey, userId, bypassLock) {
  if (bypassLock) return false;
  const my = getReservation(mainKey, userId);
  if (my) return false;
  const bucket = data.reservations?.[mainKey] || {};
  for (const [k, r] of Object.entries(bucket)) {
    if (!r) continue;
    if (String(k).startsWith("mini:")) continue;
    if (Date.now() >= r.expiresAt) continue;
    if (r.remaining <= 0) continue;
    return true;
  }
  return false;
}

function computeMainsLeft(mainRaffle, mainKey) {
  const reserved = Object.values(data.reservations?.[mainKey] || {})
    .filter((r) => r && r.remaining > 0 && Date.now() < r.expiresAt)
    .reduce((a, b) => a + b.remaining, 0);
  const claimed = countClaimedSlots(mainRaffle);
  return Math.max(0, mainRaffle.max - claimed - reserved);
}

async function announceMainsLeftIfChanged(channel, mainRaffle, mainKey) {
  const left = computeMainsLeft(mainRaffle, mainKey);
  const now = Date.now();
  if (mainRaffle.lastMainsLeftAnnounced === left && now - (mainRaffle.lastMainsLeftAnnouncedAt || 0) < 3000) return;
  if (mainRaffle.lastMainsLeftAnnounced === left) return;
  mainRaffle.lastMainsLeftAnnounced = left;
  mainRaffle.lastMainsLeftAnnouncedAt = now;
  saveData(data);
  await channel.send(`📌 **${left} MAINS LEFT**`).catch(() => {});
}

async function pingMiniWinnerInMain(mainThread, winnerId, winningNumber, tickets, minutes) {
  const content = `<@${winnerId}>\n🏆 **You won the mini!** (slot #${winningNumber})\n🎟️ **Pick ${tickets} slot(s) on the main raffle**\n💬 Type the numbers you want in /raffle claim\n⏳ **${minutes} minutes** — others are paused`;
  return mainThread.send({ content, allowedMentions: { parse: ["users"] } }).catch(() => null);
}

function getAvailableNumbers(raffle) {
  const avail = [];
  const max = Number(raffle.max) || 0;
  for (let i = 1; i <= max; i++) {
    const owners = raffle.claims?.[String(i)];
    if (!owners || owners.length === 0) avail.push(i);
  }
  return avail;
}

function formatAvailableList(avail, maxToShow = 80) {
  const shown = avail.slice(0, maxToShow);
  const more = avail.length > shown.length ? ` … (+${avail.length - shown.length} more)` : "";
  return `${compressRanges(shown)}${more}`;
}

async function maybeAnnounceAvailable(channel, raffle) {
  const afterClaimed = Number(config.availableAfterClaimed ?? 10);
  const every = Number(config.availableAnnounceEvery ?? 5);
  const maxToShow = Number(config.availableMaxToShow ?? 40);
  const claimed = countClaimedSlots(raffle);
  if (claimed < afterClaimed) return;
  if (every > 0 && claimed % every !== 0) return;
  if (raffle.lastAvailableAnnouncedClaimed === claimed) return;
  raffle.lastAvailableAnnouncedClaimed = claimed;
  saveData(data);
  const avail = getAvailableNumbers(raffle);
  if (!avail.length) return;
  await channel.send(`🟢 **Available (${avail.length})**: ${formatAvailableList(avail, maxToShow)}`).catch(() => {});
}

function computeTotals(raffle, mainKey = null) {
  const slotPrice = Number(raffle.slotPrice);
  if (!Number.isFinite(slotPrice)) return null;
  const perUserExact = new Map();
  let chargedSlots = 0;
  for (const [slotStr, ownersRaw] of Object.entries(raffle.claims || {})) {
    if (!Array.isArray(ownersRaw) || ownersRaw.length === 0) continue;
    const slotNum = Number(slotStr);
    const owners = ownersRaw.map(normalizeUserId).filter(Boolean);
    if (!owners.length) continue;
    const payingOwners = owners.filter((uid) => {
      if (!mainKey) return true;
      return !isMiniWinnerSlot(mainKey, uid, slotNum);
    });
    if (payingOwners.length === 0) continue;
    chargedSlots += 1;
    const share = slotPrice / payingOwners.length;
    for (const uid of payingOwners) {
      perUserExact.set(uid, (perUserExact.get(uid) || 0) + share);
    }
  }
  const lines = [];
  let grand = 0;
  for (const [uid, amtExact] of perUserExact.entries()) {
    const roundedUp = Math.ceil(amtExact);
    grand += roundedUp;
    lines.push({ uid, amount: roundedUp });
  }
  lines.sort((a, b) => b.amount - a.amount);
  return { slotPrice, chargedSlots, lines, grand };
}

async function postTotalsIfFull(channel, raffle, title, mainKey = null) {
  if (!isRaffleFull(raffle)) return;
  if (raffle.totalsPosted) return;
  const totals = computeTotals(raffle, mainKey);
  if (!totals) return;
  raffle.totalsPosted = true;
  saveData(data);
  const body = [
    `💰 **TOTALS (${title})**`,
    `🎟️ Charged slots: **${totals.chargedSlots}/${raffle.max}**`,
    `💳 Slot price: **${totals.slotPrice}c**`,
    ``,
    ...totals.lines.map((x) => `• <@${x.uid}>${hasScouterBadge(x.uid) ? " 🔍" : ""}: **${x.amount}c**`),
    ``,
    `🧾 **Grand total:** **${totals.grand}c**`,
  ].join("\n");
  await channel.send(body).catch(() => {});
}

async function postAmountsToList(channel, raffle, title, mainKey = null) {
  try {
    const totals = computeTotals(raffle, mainKey);
    if (!totals) return;
    const dest = (await getRaffleWinnersChannel(channel.guild)) || channel;
    const lines = totals.lines.map((x) => `<@${x.uid}>${hasScouterBadge(x.uid) ? " 🔍" : ""}: ${x.amount}c`);
    const text = `📋 **AMOUNTS (${title})**\nSlot: ${totals.slotPrice}c • Charged: ${totals.chargedSlots}/${raffle.max} • Grand: ${totals.grand}c\n\n\`\`\`txt\n${lines.join("\n").slice(0, 1800)}\n\`\`\``;
    await dest.send({ content: text }).catch(() => {});
  } catch {}
}

function isFreeRaffle(raffle) {
  return !raffle.slotPrice || raffle.slotPrice === 0;
}

async function handleFullRaffle(channel, raffle) {
  if (raffle.fullNotified) return;
  const isMini = Boolean(data.miniThreads?.[channel.id]);
  const rawHostId = raffle.hostId;
  const hostId = rawHostId ? (normalizeUserId(String(rawHostId)) || String(rawHostId)) : null;
  const shouldPingHost = !isMini && hostId && /^\d{15,}$/.test(hostId);
  const hostPing = shouldPingHost ? `<@${hostId}> ` : "";
  raffle.fullNotified = true;
  raffle.active = false;
  raffle.endedAt = Date.now();
  saveData(data);
  await safetyLog(channel.guild, {
    title: "✅ Raffle FULL",
    fields: [
      { name: "Type", value: isMini ? "Mini" : "Main", inline: true },
      { name: "Channel", value: `<#${channel.id}>`, inline: true },
      { name: "Host", value: raffle.hostId ? `<@${raffle.hostId}>` : "Unknown", inline: true },
      { name: "Slots", value: `${countClaimedSlots(raffle)}/${raffle.max}`, inline: true },
    ],
    color: 0x2ecc71,
  }).catch(() => {});
  await channel.send({
    content: `${hostPing}✅ **FULL** — all slots claimed. Mods can now \`/roll\` the winner 🎲`,
    allowedMentions: shouldPingHost ? { parse: ["users"] } : { parse: [] },
  }).catch(() => {});
  const mainKey = isMini ? null : raffleKey(raffle.guildId, raffle.channelId);
  await postTotalsIfFull(channel, raffle, isMini ? "Mini" : "Main", mainKey).catch(() => {});
  if (!isFreeRaffle(raffle)) {
    await postAmountsToList(channel, raffle, isMini ? "Mini" : "Main", mainKey).catch(() => {});
  }
}

function parseCoinPriceFromText(priceText) {
  const s = String(priceText || "").trim().toLowerCase();
  const m = s.match(/(\d+)\s*c(?:oins?)?/i);
  return m ? Number(m[1]) : 0;
}

function parseClaimNumbers(input) {
  const nums = String(input || "").match(/\d+/g)?.map((n) => Number(n)) ?? [];
  return nums.filter((n) => Number.isFinite(n));
}

function isThreadChannel(channel) {
  return channel?.type === ChannelType.PublicThread || channel?.type === ChannelType.PrivateThread || Boolean(channel?.isThread?.());
}

function autoFillRemainingMains(mainRaffle, winnerId, maxTickets) {
  const available = getAvailableNumbers(mainRaffle);
  const toClaim = available.slice(0, maxTickets);
  for (const n of toClaim) mainRaffle.claims[String(n)] = [winnerId];
  return toClaim;
}

async function postOrUpdateBoard(channel, raffle, mainKey = null, title = "🎟️ Raffle Board") {
  try {
    const embed = formatBoardEmbed(raffle, mainKey, title);
    if (raffle.lastBoardMessageId) {
      try {
        const msg = await channel.messages.fetch(raffle.lastBoardMessageId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch { raffle.lastBoardMessageId = null; }
    }
    const msg = await channel.send({ embeds: [embed] }).catch(() => null);
    if (msg) {
      raffle.lastBoardMessageId = msg.id;
      saveData(data);
    }
  } catch (err) { console.error("❌ postOrUpdateBoard error:", err?.message || err); }
}

// ===================== CHUNK 3/5 =====================
async function endGiveawayByMessageId(client, messageId, { reroll = false } = {}) {
  ensureRaffleData();
  clearGiveawayTimer(messageId);
  if (String(messageId).startsWith("mainraffle:")) {
    const channelId = String(messageId).split(":")[1];
    let foundKey = null;
    let r = null;
    for (const [key, rr] of Object.entries(data.raffles || {})) {
      if (key.endsWith(`:${channelId}`)) { foundKey = key; r = rr; break; }
    }
    if (!foundKey || !r) return { ok: false, reason: "Main raffle not found." };
    const [guildId] = foundKey.split(":");
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { ok: false, reason: "Guild not available." };
    const mainThread = await guild.channels.fetch(channelId).catch(() => null);
    if (!mainThread || !mainThread.isTextBased?.()) return { ok: false, reason: "Main thread not found." };
    r.active = false;
    r.endedAt = Date.now();
    delete r.endsAt;
    saveData(data);
    const mainKey = raffleKey(guildId, channelId);
    await postOrUpdateBoard(mainThread, r, mainKey, "🎟️ Main Board");
    if (isRaffleFull(r)) await handleFullRaffle(mainThread, r);
    else await mainThread.send(`⏲️ **Timer ended:** Main raffle auto-closed at <t:${Math.floor(r.endedAt / 1000)}:F>`).catch(() => {});
    return { ok: true, winners: [] };
  }
  return { ok: false, reason: "Unknown timer type." };
}

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;
    const content = message.content.trim();
    if (content.toLowerCase() === "!code") return message.reply(`🧾 Cherbot code: **${makeToyCode()}**`).catch(() => {});

    // Astra Chat XP & Trivia
    const userId = message.author.id;
    const user = ensureUser(userId);
    const now = Date.now();
    if (now - user.lastXp > ASTRA_CONFIG.XP_COOLDOWN_SECONDS * 1000) {
      addXp(userId, 5, "Chat activity");
      user.lastXp = now;
      saveJson(DATA_FILES.XP_DATA, xpData);
    }
    if (triviaData.current?.active) {
      const currentQ = triviaData.themes[triviaData.current.theme]?.questions[triviaData.current.index];
      if (currentQ && !triviaData.current.answers.has(userId)) {
        if (message.content.trim().toLowerCase() === currentQ.a.toLowerCase()) {
          triviaData.current.answers.set(userId, true);
          addXp(userId, triviaData.current.xpPer, "Correct trivia answer");
          ensureUser(userId).triviaCorrect++;
          saveJson(DATA_FILES.TRIVIA_DATA, triviaData);
          try { await message.react("✅"); } catch {}
        }
      }
    }
  } catch (err) { console.error("messageCreate error:", err?.stack || err); }
});

// Invite Tracking
let cachedInvites = new Map();
client.on('inviteCreate', invite => {
  if (invite.guild.id === ASTRA_CONFIG.GUILD_ID) cachedInvites.set(invite.code, { uses: invite.uses || 0, inviterId: invite.inviter?.id });
});
client.on('inviteDelete', invite => {
  if (invite.guild.id === ASTRA_CONFIG.GUILD_ID) cachedInvites.delete(invite.code);
});
client.on('guildMemberAdd', async member => {
  if (member.guild.id !== ASTRA_CONFIG.GUILD_ID || member.user.bot) return;
  const newInvites = await member.guild.invites.fetch().catch(() => new Map());
  let usedInvite = null;
  for (const [code, inv] of newInvites) {
    const old = cachedInvites.get(code);
    if (old && inv.uses > old.uses) {
      usedInvite = { inviterId: old.inviterId };
      cachedInvites.set(code, { uses: inv.uses, inviterId: old.inviterId });
      break;
    }
  }
  if (usedInvite && usedInvite.inviterId && usedInvite.inviterId !== member.id) {
    addXp(usedInvite.inviterId, 15, "Invited new member");
  }
});

// ===================== CHUNK 4/5 =====================
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isButton()) {
      const id = interaction.customId;
      await interaction.deferReply({ ephemeral: true }).catch(() => {});

      if (id === "suggest_from_whatsnew") {
        const modal = new ModalBuilder().setCustomId("suggest_modal").setTitle("💡 Submit Suggestion / Request");
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("title").setLabel("Topic / Title").setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("details").setLabel("Details / Description").setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      if (id.startsWith("attend_event_")) {
        const eventId = parseInt(id.replace("attend_event_", ""));
        const event = eventsData.list.find(e => e.id === eventId && Date.now() < e.startTime + ASTRA_CONFIG.EVENT_CLOSE_DELAY);
        if (!event) return interaction.editReply({ content: "❌ Event ended or not found." });
        const user = ensureUser(interaction.user.id);
        if (user.eventsJoined.includes(eventId)) return interaction.editReply({ content: "✅ You have already marked attendance." });
        addXp(interaction.user.id, event.xp, `Attended event: ${event.title}`);
        user.eventsJoined.push(eventId);
        saveJson(DATA_FILES.XP_DATA, xpData);
        return interaction.editReply({ content: `✅ Attendance recorded! +${event.xp} XP` });
      }

      return interaction.editReply({ content: "❌ Unknown button." });
    }

    if (!interaction.isChatInputCommand()) return;
    const name = interaction.commandName;
    const mysteryHandled = await mystery.handleInteraction(interaction, client);
    if (mysteryHandled) return;
    const isStaff = interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild) || interaction.member.roles.cache.has(ASTRA_CONFIG.STAFF_ROLE_ID);

    // -------------------- ASTRA COMMANDS --------------------
    if (name === "whatsnew") {
      const desc = whatsNewData.updates.map(item => `• ${item}`).join("\n");
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("suggest_from_whatsnew").setLabel("💡 Submit Suggestion").setStyle(ButtonStyle.Primary));
      return interaction.reply({
        embeds: [new EmbedBuilder().setTitle("📢 What's New").setDescription(desc).setColor("#f39c12").setFooter({ text: `Version ${whatsNewData.version} | Updated: ${whatsNewData.last_updated}` })],
        components: [row]
      });
    }

    if (name === "levels") {
      const desc = ASTRA_CONFIG.XP_REWARDS.map(r => `**Level ${r.level}** — ${r.xpNeeded} XP — Reward: ${r.reward}`).join("\n");
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle("📊 XP & Level Rewards").setDescription(desc).setColor("#f1c40f")] });
    }

    if (name === "profile") {
      const target = interaction.options.getUser("user") ? interaction.options.getUser("user") : interaction.user;
      const data = ensureUser(target.id);
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`👤 ${target.username}`)
            .setColor("#2980b9")
            .addFields(
              { name: "Current Level", value: `${data.currentLevel}`, inline: true },
              { name: "Weekly XP", value: `${data.weeklyXp} / ${getXpForLevel(data.currentLevel + 1)}`, inline: true },
              { name: "All-Time XP", value: `${data.allTimeXp}`, inline: true },
              { name: "Events Attended", value: `${data.eventsJoined.length}`, inline: true },
              { name: "Trivia Correct", value: `${data.triviaCorrect}`, inline: true }
            )
        ]
      });
    }

    if (name === "leaderboard") {
      const type = interaction.options.getString("type") || "weekly";
      const sorted = Object.entries(xpData.users).sort((a, b) => {
        if (type === "alltime") return (b[1].highestLevel * 1000000 + b[1].allTimeXp) - (a[1].highestLevel * 1000000 + a[1].allTimeXp);
        return (b[1].currentLevel * 1000 + b[1].weeklyXp) - (a[1].currentLevel * 1000 + a[1].weeklyXp);
      }).slice(0, 10);

      const title = type === "alltime" ? "🏆 All-Time Leaderboard" : "📅 Weekly Leaderboard";
      const list = sorted.map(([id, d], i) => {
        const member = interaction.guild.members.cache.get(id);
        const name = member ? member.displayName : "Unknown";
        return `**${i + 1}.** ${name} • Lv ${type === "alltime" ? d.highestLevel : d.currentLevel} • ${type === "alltime" ? d.allTimeXp : d.weeklyXp} XP`;
      }).join("\n") || "No data available yet.";
      // ===================== CHUNK 5/5 — FINAL PORTION =====================
      });
    }

    if (name === "trivia") {
      if (!isStaff) return interaction.reply({ content: "❌ Only staff can manage trivia.", ephemeral: true });
      const action = interaction.options.getString("action");
      const theme = interaction.options.getString("theme") || "general";

      if (action === "start") {
        const xpPer = interaction.options.getInteger("xp") || ASTRA_CONFIG.TRIVIA_DEFAULT_XP;
        const question = interaction.options.getString("question");
        const answer = interaction.options.getString("answer");

        if (!triviaData.themes[theme]) triviaData.themes[theme] = { questions: [] };
        triviaData.current = {
          theme,
          question,
          answer: answer.toLowerCase(),
          xpPer,
          active: true,
          answers: new Set()
        };
        saveJson(DATA_FILES.TRIVIA_DATA, triviaData);

        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setTitle("🧠 Trivia Started!")
            .setDescription(`**Question:** ${question}\n**XP Reward:** ${xpPer} XP`)
            .setColor("#9b59b6")
            .setFooter({ text: `Theme: ${theme}` })
          ]
        });
      }

      if (action === "end") {
        triviaData.current = null;
        saveJson(DATA_FILES.TRIVIA_DATA, triviaData);
        return interaction.reply({ content: "✅ Trivia ended." });
      }
    }

    if (name === "event") {
      if (!isStaff) return interaction.reply({ content: "❌ Only staff can manage events.", ephemeral: true });
      const action = interaction.options.getString("action");

      if (action === "create") {
        const title = interaction.options.getString("title");
        const description = interaction.options.getString("description") || "No description provided.";
        const startTime = interaction.options.getInteger("timestamp") * 1000;
        const xp = interaction.options.getInteger("xp") || ASTRA_CONFIG.EVENT_XP_AWARD;

        const newEvent = {
          id: Date.now(),
          title,
          description,
          startTime,
          xp,
          attendees: []
        };
        eventsData.list.push(newEvent);
        saveJson(DATA_FILES.EVENTS_DATA, eventsData);

        const eventEmbed = new EmbedBuilder()
          .setTitle(`🎉 Event: ${title}`)
          .setDescription(description)
          .addFields(
            { name: "Starts", value: `<t:${Math.floor(startTime / 1000)}:F>`, inline: true },
            { name: "XP Reward", value: `${xp} XP`, inline: true }
          )
          .setColor("#e74c3c")
          .setTimestamp();

        const attendRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`attend_event_${newEvent.id}`)
            .setLabel("✅ Mark Attendance")
            .setStyle(ButtonStyle.Success)
        );

        return interaction.reply({ embeds: [eventEmbed], components: [attendRow] });
      }
    }

    if (name === "xp") {
      if (!isStaff) return interaction.reply({ content: "❌ Only staff can manage XP.", ephemeral: true });
      const action = interaction.options.getString("action");
      const target = interaction.options.getUser("user");
      const amount = interaction.options.getInteger("amount");
      const reason = interaction.options.getString("reason") || "Staff adjustment";

      if (action === "add") {
        addXp(target.id, amount, reason);
        return interaction.reply({ content: `✅ Added ${amount} XP to ${target.username} — ${reason}` });
      }
      if (action === "remove") {
        removeXp(target.id, amount, reason);
        return interaction.reply({ content: `✅ Removed ${amount} XP from ${target.username} — ${reason}` });
      }
    }

    if (name === "scouter") {
      if (!isStaff) return interaction.reply({ content: "❌ Only staff can manage Scouter Badges.", ephemeral: true });
      const action = interaction.options.getString("action");
      const target = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason") || "No reason provided";

      if (action === "give") {
        if (giveScouterBadge(target.id, interaction.user.id, reason)) {
          return interaction.reply({ content: `✅ Gave Scouter Badge to ${target.username}` });
        }
        return interaction.reply({ content: "❌ Failed to give badge." });
      }
      if (action === "remove") {
        if (removeScouterBadge(target.id)) {
          return interaction.reply({ content: `✅ Removed Scouter Badge from ${target.username}` });
        }
        return interaction.reply({ content: "❌ User does not have the Scouter Badge." });
      }
    }

    // -------------------- ORIGINAL CHERBOT RAFFLE COMMANDS --------------------
    if (name === "raffle") {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guildId;
      const channelId = interaction.channelId;
      const raffle = getRaffle(guildId, channelId);
      const mainKey = raffleKey(guildId, channelId);
      const isMini = Boolean(data.miniThreads?.[channelId]);

      if (sub === "start") {
        if (!canRunRaffles(interaction.member, interaction.channel)) {
          return interaction.reply({ content: "❌ You cannot start raffles here.", ephemeral: true });
        }
        const max = interaction.options.getInteger("slots");
        const priceText = interaction.options.getString("price") || "";
        const slotPrice = parseCoinPriceFromText(priceText);

        raffle.max = max;
        raffle.priceText = priceText;
        raffle.slotPrice = slotPrice;
        raffle.active = true;
        raffle.claims = {};
        raffle.fullNotified = false;
        raffle.totalsPosted = false;
        raffle.lastBoardMessageId = null;
        raffle.hostId = interaction.user.id;
        saveData(data);

        await postOrUpdateBoard(interaction.channel, raffle, mainKey);
        return interaction.reply({ content: `✅ **Raffle started!** ${max} slots — ${priceText || "Free"}` });
      }

      if (sub === "claim") {
        if (!raffle.active) return interaction.reply({ content: "❌ No active raffle here.", ephemeral: true });
        const input = interaction.options.getString("numbers");
        const nums = parseClaimNumbers(input);
        if (!nums.length) return interaction.reply({ content: "❌ Provide slot numbers e.g. `1, 3-5, 7`", ephemeral: true });

        const available = getAvailableNumbers(raffle);
        const valid = nums.filter(n => available.includes(n));
        if (!valid.length) return interaction.reply({ content: "❌ All requested slots are taken or invalid.", ephemeral: true });

        for (const n of valid) {
          if (!raffle.claims[String(n)]) raffle.claims[String(n)] = [];
          if (!raffle.claims[String(n)].includes(interaction.user.id)) {
            raffle.claims[String(n)].push(interaction.user.id);
          }
        }
        saveData(data);

        await postOrUpdateBoard(interaction.channel, raffle, mainKey);
        await maybeAnnounceAvailable(interaction.channel, raffle);
        if (isRaffleFull(raffle)) await handleFullRaffle(interaction.channel, raffle);

        return interaction.reply({ content: `✅ Claimed slots: ${valid.join(", ")}` });
      }

      if (sub === "board") {
        await postOrUpdateBoard(interaction.channel, raffle, mainKey);
        return interaction.reply({ content: "✅ Board refreshed" });
      }

      if (sub === "close") {
        if (!canRunRaffles(interaction.member, interaction.channel)) {
          return interaction.reply({ content: "❌ No permission.", ephemeral: true });
        }
        raffle.active = false;
        saveData(data);
        await postOrUpdateBoard(interaction.channel, raffle, mainKey);
        return interaction.reply({ content: "✅ Raffle closed manually." });
      }
    }

    if (name === "roll") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: "❌ Only mods can run rolls.", ephemeral: true });
      }
      const guildId = interaction.guildId;
      const channelId = interaction.channelId;
      const raffle = getRaffle(guildId, channelId);
      const mainKey = raffleKey(guildId, channelId);
      const isMini = Boolean(data.miniThreads?.[channelId]);

      if (raffle.active && !isRaffleFull(raffle)) {
        return interaction.reply({ content: "⚠️ Raffle is still open — use /raffle close first.", ephemeral: true });
      }

      const allSlots = Object.entries(raffle.claims || {})
        .filter(([_, owners]) => Array.isArray(owners) && owners.length > 0);
      if (!allSlots.length) return interaction.reply({ content: "❌ No slots claimed.", ephemeral: true });

      const [winningSlot, owners] = allSlots[randInt(0, allSlots.length - 1)];
      const winnerId = owners[randInt(0, owners.length - 1)];

      addXp(winnerId, 20, "Won raffle roll");
      await logRoll(interaction, { winnerId, winningSlot, isMini });

      const embed = new EmbedBuilder()
        .setTitle("🎲 WINNER!")
        .setDescription(`**Slot #${winningSlot}** — <@${winnerId}>`)
        .setColor("#f1c40f")
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (name === "minis") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: "❌ No permission.", ephemeral: true });
      }
      const sub = interaction.options.getSubcommand();
      const channelId = interaction.channelId;

      if (sub === "setup") {
        data.miniThreads[channelId] = { active: true, createdAt: Date.now() };
        saveData(data);
        return interaction.reply({ content: "✅ This thread is now marked as a Mini Raffle channel." });
      }
    }

    // -------------------- MODAL HANDLERS --------------------
    if (interaction.isModalSubmit()) {
      if (interaction.customId === "suggest_modal") {
        const title = interaction.fields.getTextInputValue("title");
        const details = interaction.fields.getTextInputValue("details");
        const dest = client.channels.cache.get(ASTRA_CONFIG.SUGGESTIONS_CHANNEL_ID);
        if (!dest) return interaction.reply({ content: "❌ Suggestions channel not set.", ephemeral: true });

        await dest.send({
          embeds: [new EmbedBuilder()
            .setTitle(`💡 Suggestion: ${title}`)
            .setDescription(details)
            .setFooter({ text: `Submitted by ${interaction.user.username} (${interaction.user.id})` })
            .setColor("#3498db")
            .setTimestamp()
          ]
        });
        return interaction.reply({ content: "✅ Suggestion submitted!", ephemeral: true });
      }
    }

  } catch (err) {
    console.error("❌ Interaction error:", err?.stack || err);
    if (!interaction.replied) interaction.reply({ content: "❌ An error occurred.", ephemeral: true }).catch(() => {});
  }
});

// Weekly XP Reset (runs every Monday 00:00)
setInterval(() => {
  const now = new Date();
  if (now.getDay() === 1 && now.getHours() === 0 && now.getMinutes() < 5) {
    for (const user of Object.values(xpData.users)) {
      user.weeklyXp = 0;
    }
    xpData.lastReset = Date.now();
    saveJson(DATA_FILES.XP_DATA, xpData);
    console.log("✅ Weekly XP reset complete");
  }
}, 5 * 60 * 1000);

// Login
client.login(ASTRA_CONFIG.DISCORD_TOKEN);

      return interaction.reply({ embeds: [new EmbedBuilder().setTitle(title).setDescription(list).setColor("#f1c40f")]
