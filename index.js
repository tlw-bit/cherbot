// Cherbot (Discord.js v14) — clean + stable single-file
// FIXED:
// ✅ Host pinged once when MAIN raffle becomes FULL (fullNotified + saved)
// ✅ Mini winner gets reserved main claim window (locks others) + can pick numbers
// ✅ Placeholder mini reservations DO NOT lock the main (only reduce mains-left)
// ✅ Removed duplicate getReservation() + normalized reservation keys
// ✅ Fixed handleFullRaffle() missing closing brace + sets fullNotified
// ✅ Fixed mainraffle auto-end (previously broke because raffle had no guildId/channelId)
// ✅ Fixed endGiveawayByMessageId variables (prize/winnerText/endedUnix scope) + skip message edit for mainraffle
// ✅ Claim numbers block cleaned (uniqueNums defined, range-checked)

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
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
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
      reservations: {},
      miniThreads: {},
      miniWinners: {},
      miniWinnerSlots: {},
      miniEntitlements: {}, // ✅ NEW
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    if (!parsed.users) parsed.users = {};
    if (!parsed.selfRoles) parsed.selfRoles = [];
    if (!parsed.giveaways) parsed.giveaways = {};
    if (!parsed.raffles) parsed.raffles = {};
    if (!parsed.reservations) parsed.reservations = {};
    if (!parsed.miniThreads) parsed.miniThreads = {};
    if (!parsed.miniWinners) parsed.miniWinners = {};
    if (!parsed.miniWinnerSlots) parsed.miniWinnerSlots = {};
    if (!parsed.miniEntitlements) parsed.miniEntitlements = {}; // ✅ NEW

    return parsed;
  } catch {
    return {
      users: {},
      selfRoles: [],
      giveaways: {},
      raffles: {},
      reservations: {},
      miniThreads: {},
      miniWinners: {},
      miniWinnerSlots: {},
      miniEntitlements: {}, // ✅ NEW
    };
  }
}

function saveData(obj) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), "utf8");
}

let data = loadData();

function ensureGiveawayData() {
  if (!data.giveaways) data.giveaways = {};
}

function ensureRaffleData() {
  if (!data.raffles) data.raffles = {};
  if (!data.reservations) data.reservations = {};
  if (!data.miniThreads) data.miniThreads = {};
  if (!data.miniWinners) data.miniWinners = {};
  if (!data.miniWinnerSlots) data.miniWinnerSlots = {};
  if (!data.miniEntitlements) data.miniEntitlements = {}; // ✅ NEW
}

// -------------------- Giveaway scheduling (NO SWEEP) --------------------
const giveawayTimers = new Map(); // messageId -> timeout

function clearGiveawayTimer(messageId) {
  const t = giveawayTimers.get(messageId);
  if (t) clearTimeout(t);
  giveawayTimers.delete(messageId);
}

// Node's setTimeout max delay is ~24.8 days (2^31-1 ms). Chunking prevents overflow.
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
        console.error("❌ scheduled giveaway end failed:", messageId, e?.stack || e)
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
      console.error("❌ scheduled giveaway end failed:", messageId, e?.stack || e)
    );
  }, delay + 250);

  giveawayTimers.set(messageId, t);
}

// -------------------- Ready --------------------
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  ensureGiveawayData();
  ensureRaffleData();

  // Re-schedule active giveaways on startup
  for (const [messageId, g] of Object.entries(data.giveaways || {})) {
    if (!g) continue;
    if (g.ended) continue;
    if (!g.endsAt) continue;
    scheduleGiveawayEnd(client, messageId, g.endsAt);
  }

  // Re-schedule active main raffles with timers (if you restart bot mid-timer)
  for (const [key, r] of Object.entries(data.raffles || {})) {
    if (!r?.active) continue;
    if (!r?.endsAt) continue;
    const channelId = key.split(":")[1];
    scheduleGiveawayEnd(client, `mainraffle:${channelId}`, r.endsAt);
  }
});

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

async function getRaffleWinnersChannel(guild) {
  const id = String(config.raffleWinnerChannelId || "").trim(); // add to config.json
  if (!id) return null;
  const ch = await guild.channels.fetch(id).catch(() => null);
  if (!ch || !ch.isTextBased?.()) return null;
  return ch;
}

function giveawayMention() {
  const rid = String(config.giveawayRoleId || "").trim();
  return rid ? `<@&${rid}>` : "";
}

function shouldAwardXp(channelId) {
  const allowed = Array.isArray(config.xpAllowedChannelIds) ? config.xpAllowedChannelIds.map(String) : [];
  const blocked = Array.isArray(config.xpBlockedChannelIds) ? config.xpBlockedChannelIds.map(String) : [];
  if (blocked.includes(String(channelId))) return false;
  if (allowed.length > 0 && !allowed.includes(String(channelId))) return false;
  return true;
}

function normalizeUserId(value) {
  if (!value) return null;
  const s = String(value);
  if (/^\d{15,}$/.test(s)) return s;
  const m = s.match(/\d{15,}/);
  return m ? m[0] : null;
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
  if (targetRole) await member.roles.add(targetRole).catch(() => {});
}

async function processLevelUps({ guild, channel, userObj, userDiscord, member }) {
  while (userObj.xp >= xpNeeded(userObj.level)) {
    userObj.xp -= xpNeeded(userObj.level);
    userObj.level += 1;

    await announceLevelUp(guild, channel, userDiscord, userObj.level).catch(() => {});
    if (member) await applyLevelRoles(member, userObj.level).catch(() => {});
  }
}

// -------------------- Optional prefix command --------------------
function makeToyCode() {
  return "cher-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// -------------------- Giveaway helpers --------------------
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

// -------------------- Raffle / Mini helpers --------------------
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
      guildId,
      channelId,
      active: false,
      max: 0,
      priceText: "",
      slotPrice: null,
      totalsPosted: false,
      claims: {},
      lastBoardMessageId: null,
      lastMainsLeftAnnounced: null,
      lastAvailableAnnouncedClaimed: null,
      hostId: null,
      fullNotified: false,
      createdAt: Date.now(),
    };
    saveData(data);
  } else {
    // keep these present even if older data.json lacked them
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

// -------------------- Board (EMBED ONLY) --------------------
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
   const mark = mainKey && uid && isMiniWinnerSlot(mainKey, uid, i) ? " Ⓜ️" : "";
      return `<@${uid}>${mark}`;
    });

    lines.push(`**${i}.** ${users.join(" + ")}`);
  }

  const header =
    `🎟️ **${max} slots**` +
    (raffle.priceText ? ` (**${raffle.priceText}**)` : "") +
    (closed ? ` ✅ **FULL / CLOSED**` : "");

  const availText = availableNums.length ? compressRanges(availableNums) : "None";
  const description = [header, "", ...lines].join("\n").slice(0, 4096);

  return new EmbedBuilder()
    .setTitle(title + (closed ? " • FULL" : ""))
    .setColor(closed ? 0xe74c3c : 0x2ecc71)
    .setDescription(description)
    .addFields({
      name: `🟢 Available (${availableNums.length})`,
      value: String(availText).slice(0, 1024),
    })
    .setFooter({ text: "Ⓜ️ = Mini winner • Type numbers to claim" })
    .setTimestamp();
}

// -------------------- Reservations (Mini claim window) --------------------
function reservationKey(userId) {
  const s = String(userId || "");
  if (s.startsWith("mini:")) return s;     // placeholder keys
  return normalizeUserId(s) || s;          // normalize real users
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
  data.reservations[mainKey][k] = {
    remaining,
    expiresAt: Date.now() + minutes * 60 * 1000,
  };
  saveData(data);
}

function useReservation(mainKey, userId, used) {
  const k = reservationKey(userId);
  const r = getReservation(mainKey, k);
  if (!r) return null;

  r.remaining -= used;
  if (r.remaining <= 0) delete data.reservations[mainKey][k];
  saveData(data);
  return r;
}

// ✅ Locks main claims ONLY while a REAL mini-winner reservation is active (not placeholders)
function isRaffleLockedForUser(mainKey, userId, isMod) {
  if (isMod) return false;

  const my = getReservation(mainKey, userId);
  if (my) return false; // winner can claim

  const bucket = data.reservations?.[mainKey] || {};
  for (const [k, r] of Object.entries(bucket)) {
    if (!r) continue;
    if (String(k).startsWith("mini:")) continue; // placeholder reservation should not lock
    if (Date.now() >= r.expiresAt) continue;
    if (r.remaining <= 0) continue;
    return true; // someone else is actively claiming
  }
  return false;
}

// -------------------- Mains left helpers --------------------
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

  // hard guard against duplicate calls in same moment
  if (
    mainRaffle.lastMainsLeftAnnounced === left &&
    now - (mainRaffle.lastMainsLeftAnnouncedAt || 0) < 3000
  ) {
    return;
  }

  if (mainRaffle.lastMainsLeftAnnounced === left) return;

  mainRaffle.lastMainsLeftAnnounced = left;
  mainRaffle.lastMainsLeftAnnouncedAt = now;
  saveData(data);

  await channel.send(`📌 **${left} MAINS LEFT**`).catch(() => {});
}


// -------------------- Mini Winner Ping Helper --------------------
async function pingMiniWinnerInMain(mainThread, winnerId, winningNumber, tickets, minutes) {
  const content =
    `<@${winnerId}>\n` +
    `🏆 **You won the mini!** (slot #${winningNumber})\n` +
    `🎟️ **Pick ${tickets} slot(s) on the main raffle**\n` +
    `💬 Type the numbers you want (e.g., \`5 12 27\`)\n` +
    `⏳ **${minutes} minutes** — others are paused`;

  return mainThread.send({
    content,
    allowedMentions: { parse: ["users"] },
  }).catch(() => null);
}

// -------------------- Available slots announcements --------------------
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

  await channel
    .send(`🟢 **Available (${avail.length})**: ${formatAvailableList(avail, maxToShow)}`)
    .catch(() => {});
}
// -------------------- Totals (auto when full) --------------------
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
    ...totals.lines.map((x) => `• <@${x.uid}>: **${x.amount}c**`),
    ``,
    `🧾 **Grand total:** **${totals.grand}c**`,
  ].join("\n");

  await channel.send(body).catch(() => {});
}

// -------------------- FULL handler (shared) --------------------
async function handleFullRaffle(channel, raffle) {
  if (raffle.fullNotified) return;

  const isMini = Boolean(data.miniThreads?.[channel.id]);
  const rawHostId = raffle.hostId;
  const hostId = rawHostId ? (normalizeUserId(String(rawHostId)) || String(rawHostId)) : null;

  const shouldPingHost = !isMini && hostId && /^\d{15,}$/.test(hostId);
  const hostPing = shouldPingHost ? `<@${hostId}> ` : "";

  raffle.fullNotified = true;
  raffle.active = false; // close it once full
  saveData(data);

  await channel.send({
    content: `${hostPing}✅ **FULL** — all slots claimed. Mods can now \`/roll\` the winner 🎲`,
    allowedMentions: shouldPingHost ? { parse: ["users"] } : { parse: [] },
  }).catch(() => {});

  // ✅ pass mainKey only for MAIN raffles, so mini slots can be excluded
  const mainKey = isMini ? null : raffleKey(raffle.guildId, raffle.channelId);
  await postTotalsIfFull(channel, raffle, isMini ? "Mini" : "Main", mainKey).catch(() => {});
}

// -------------------- Helper functions for raffles --------------------
function isFreeRaffle(raffle) {
  return !raffle.slotPrice || raffle.slotPrice === 0;
}

function countUserClaims(raffle, userId) {
  let count = 0;
  for (const owners of Object.values(raffle.claims || {})) {
    if (Array.isArray(owners) && owners.includes(userId)) count++;
  }
  return count;
}

function parseCoinPriceFromText(priceText) {
  const s = String(priceText || "").trim().toLowerCase();
  const m = s.match(/(\d+)\s*c(?:oins?)?/i);
  return m ? Number(m[1]) : 0;
}

function autoFillRemainingMains(mainRaffle, winnerId, maxTickets) {
  const available = getAvailableNumbers(mainRaffle);
  const toClaim = available.slice(0, maxTickets);
  for (const n of toClaim) mainRaffle.claims[String(n)] = [winnerId];
  return toClaim;
}

// -------------------- Post or Update Board --------------------
async function postOrUpdateBoard(channel, raffle, mainKey = null, title = "🎟️ Raffle Board") {
  try {
    const embed = formatBoardEmbed(raffle, mainKey, title);

    if (raffle.lastBoardMessageId) {
      try {
        const msg = await channel.messages.fetch(raffle.lastBoardMessageId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch {
        raffle.lastBoardMessageId = null;
      }
    }

    const msg = await channel.send({ embeds: [embed] }).catch(() => null);
    if (msg) {
      raffle.lastBoardMessageId = msg.id;
      saveData(data);
    }
  } catch (err) {
    console.error("❌ postOrUpdateBoard error:", err?.message || err);
  }
}

// -------------------- endGiveawayByMessageId (includes mainraffle auto-end) --------------------
async function endGiveawayByMessageId(client, messageId, { reroll = false } = {}) {
  ensureGiveawayData();
  ensureRaffleData();
  clearGiveawayTimer(messageId);

  // ✅ Main raffle auto-end path
  if (String(messageId).startsWith("mainraffle:")) {
    const channelId = String(messageId).split(":")[1];

    // find raffle record by key ending in :channelId
    let foundKey = null;
    let r = null;
    for (const [key, rr] of Object.entries(data.raffles || {})) {
      if (key.endsWith(`:${channelId}`)) {
        foundKey = key;
        r = rr;
        break;
      }
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

    // Only do FULL behavior if it actually is full.
    if (isRaffleFull(r)) {
      await handleFullRaffle(mainThread, r);
    } else {
      await mainThread.send(`⏲️ **Timer ended:** Main raffle auto-closed at <t:${Math.floor(r.endedAt / 1000)}:F>`).catch(() => {});
    }

    return { ok: true, winners: [] };
  }

  // ---------------- Normal giveaway end ----------------
  const g = data.giveaways?.[messageId];
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
  const endedUnix = Math.floor((g.endedAt || Date.now()) / 1000);

  const announceEmbed = new EmbedBuilder()
    .setTitle(reroll ? "🔁 Giveaway Rerolled" : "🏁 Giveaway Ended")
    .setDescription(`**Prize:** ${prize}\n**Winners:** ${winnerText}\n**Ended:** <t:${endedUnix}:F>`)
    .setTimestamp();

  const winnerChannelId = String(config.giveawayWinnerChannelId || "").trim();
  let winCh = null;
  if (winnerChannelId) winCh = await guild.channels.fetch(winnerChannelId).catch(() => null);
  const targetCh = winCh && winCh.isTextBased?.() ? winCh : gwChannel;

  await targetCh.send({
    content: winners.length ? winnerText : "",
    embeds: [announceEmbed],
    allowedMentions: winners.length ? { users: winners } : undefined,
  }).catch(() => {});

  // disable button + update original giveaway message
  try {
    const msg = await gwChannel.messages.fetch(messageId);

    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`giveaway:enter:${messageId}`)
        .setLabel("Giveaway Ended")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    const originalEmbed = msg.embeds?.[0];
    const endedEmbed = originalEmbed
      ? EmbedBuilder.from(originalEmbed)
          .setTitle(reroll ? "🔁 Giveaway Rerolled" : "🏁 Giveaway Ended")
          .setDescription(`**Prize:** ${prize}\n**Winners:** ${winnerText}\n**Ended:** <t:${endedUnix}:F>`)
          .setTimestamp()
      : announceEmbed;

    await msg.edit({ embeds: [endedEmbed], components: [disabledRow] }).catch(() => {});
  } catch {}

  return { ok: true, winners };
}

// -------------------- MESSAGE CREATE --------------------
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    ensureRaffleData();
    ensureGiveawayData();

    const content = message.content.trim();
    const isMod = isModMember(message.member);

    const raffleCreateId = String(config.raffleCreateChannelId || "").trim();
    const miniCreateId = String(config.miniCreateChannelId || "").trim();

    const isThread =
      message.channel.type === ChannelType.PublicThread ||
      message.channel.type === ChannelType.PrivateThread ||
      Boolean(message.channel.isThread?.());

    const inMainRaffleChannel =
      String(message.channel.id) === raffleCreateId ||
      String(message.channel.parentId || "") === raffleCreateId;

    const isThreadInRaffleCreate = isThread && String(message.channel.parentId || "") === raffleCreateId;

// --- !code ---
if (content.toLowerCase() === "!code") {
  return message.reply(`🧾 Cherbot code: **${makeToyCode()}**`).catch(() => {});
}

// -------------------- MAIN RAFFLE START --------------------
const startMatch = content.match(/^!(\d+)\s+slots(?:\s+(.+))?$/i);
if (startMatch && inMainRaffleChannel) {
  if (!isMod) return message.reply("❌ Mods only.").catch(() => {});
  if (!isThreadInRaffleCreate) {
    return message
      .reply("❌ Start the raffle **inside the thread** (not the parent channel).")
      .catch(() => {});
  }

  const max = Number(startMatch[1]);
  let tail = (startMatch[2]?.trim() || ""); // everything after "slots"

  // ✅ Allow only 1..500
  if (!Number.isFinite(max) || max < 1 || max > 500) {
    return message.reply("Pick a slot amount between 1 and 500.").catch(() => {});
  }

  // --- Pull out optional duration token like 10m / 2h / 1d anywhere in tail ---
  let durationMs = null;
  const dur = tail.match(/(?:^|\s)(\d+\s*[mhd])(?:\s|$)/i);
  if (dur) {
    durationMs = parseDurationToMs(dur[1]);
    tail = tail.replace(dur[1], "").replace(/\s+/g, " ").trim();
  }

  // --- Parse price from remaining tail ---
  const parsedSlotPrice = parseCoinPriceFromText(tail);

  // ✅ If they typed anything after slots, it MUST contain a valid price like "50c"
  if (tail && parsedSlotPrice === 0) {
    return message
      .reply("❌ Price format not recognised. Use something like `50c` (example: `!100 slots 50c`).")
      .catch(() => {});
  }

  const raffle = getRaffle(message.guild.id, message.channel.id);

  // reset mini winners for this main raffle
  const mainKey = raffleKey(message.guild.id, message.channel.id);
  ensureMiniWinners();
  data.miniWinners[mainKey] = {};
  saveData(data);

  raffle.active = true;
  raffle.max = max;
  raffle.priceText = tail;
  raffle.slotPrice = parsedSlotPrice;

  raffle.totalsPosted = false;
  raffle.claims = {};
  raffle.lastBoardMessageId = null;
  raffle.lastMainsLeftAnnounced = null;
  raffle.lastAvailableAnnouncedClaimed = null;

const hostId = message.channel.ownerId || message.author.id;
raffle.hostId = String(hostId);

  raffle.fullNotified = false;
  raffle.createdAt = Date.now();

  if (durationMs) raffle.endsAt = Date.now() + durationMs;
  else delete raffle.endsAt;

  saveData(data);

  await postOrUpdateBoard(message.channel, raffle, mainKey, "🎟️ Main Board");
  await announceMainsLeftIfChanged(message.channel, raffle, mainKey).catch(() => {});

  if (raffle.endsAt) {
    scheduleGiveawayEnd(client, `mainraffle:${message.channel.id}`, raffle.endsAt);
    await message.channel
      .send(`⏲️ **Timer set:** Main raffle auto-ends <t:${Math.floor(raffle.endsAt / 1000)}:R>`)
      .catch(() => {});
  }

  return;
}


    // -------------------- MINI CREATE --------------------
    const miniMatch = content.match(/^!mini\s+(\d+)\s*x(?:\s+(\d+))?\s*-\s*(\d+)\s*(?:c|coins?)$/i);
    if (miniMatch && inMainRaffleChannel) {
      if (!isMod) return message.reply("❌ Mods only.").catch(() => {});
      if (!isThreadInRaffleCreate) {
        return message.reply("❌ Run `!mini ...` **inside the main raffle thread**.").catch(() => {});
      }

      const tickets = Number(miniMatch[1]);
      const miniSlots = Number(miniMatch[2] || (config.miniDefaultSlots ?? 6));
      const mainTicketPrice = Number(miniMatch[3]);

      if (!Number.isFinite(tickets) || tickets < 1 || tickets > 50) return message.reply("Tickets must be 1–50.").catch(() => {});
      if (!Number.isFinite(miniSlots) || miniSlots < 2 || miniSlots > 100) return message.reply("Mini slots must be 2–100.").catch(() => {});
      if (!Number.isFinite(mainTicketPrice) || mainTicketPrice < 0 || mainTicketPrice > 1000000) return message.reply("Price looks wrong.").catch(() => {});

      const pot = tickets * mainTicketPrice;
      const perSlotExact = pot / miniSlots;
      const perSlot = Math.round(perSlotExact);

      const miniCreateChannel = miniCreateId
        ? await message.guild.channels.fetch(miniCreateId).catch(() => null)
        : null;

      if (!miniCreateChannel || !miniCreateChannel.isTextBased()) {
        return message.reply("❌ miniCreateChannelId is wrong or not text-based.").catch(() => {});
      }

      const mainKey = raffleKey(message.guild.id, message.channel.id);

      const miniThread = await miniCreateChannel.threads
        .create({
          name: `${message.channel.name} - ${tickets} ticket(s) (${miniSlots} slots)`.slice(0, 100),
          autoArchiveDuration: 1440,
          reason: "Mini raffle created",
        })
        .catch(() => null);

      if (!miniThread) return message.reply("❌ I couldn't create the mini thread (check permissions).").catch(() => {});

      try { await miniThread.members.add(client.user.id); } catch {}

      data.miniThreads[miniThread.id] = { mainKey, tickets, createdAt: Date.now() };
      saveData(data);

      const miniRaffle = getRaffle(message.guild.id, miniThread.id);
      miniRaffle.active = true;
      miniRaffle.max = miniSlots;
      miniRaffle.priceText = `${tickets}x main @ ${mainTicketPrice}c = ${pot}c pot • ${perSlot}c/slot`;
      miniRaffle.slotPrice = perSlot;
      miniRaffle.totalsPosted = false;
      miniRaffle.claims = {};
      miniRaffle.lastBoardMessageId = null;
      miniRaffle.lastAvailableAnnouncedClaimed = null;
      miniRaffle.createdAt = Date.now();
      saveData(data);

      // ✅ placeholder reservation (does NOT lock main claims)
      setReservation(mainKey, `mini:${miniThread.id}`, tickets, 24 * 60);

      await postOrUpdateBoard(miniThread, miniRaffle, null, "🎟️ Mini Board");

      await miniThread
        .send(
          `🎲 **Mini created**\n` +
            `🎟️ Prize: **${tickets}** main ticket(s)\n` +
            `💰 Main ticket price: **${mainTicketPrice}c** → Pot: **${pot}c**\n` +
            `🔢 Mini slots: **${miniSlots}** → **${perSlot}c per slot** (exact ${perSlotExact.toFixed(2)}c)\n\n` +
            `Claim by typing numbers like: \`1\` or \`1 2 3\``
        )
        .catch(() => {});

      const mainRaffle = getRaffle(message.guild.id, message.channel.id);
      const updatedMainsLeft = computeMainsLeft(mainRaffle, mainKey);

      await message.channel
        .send(
          `🎲 **Mini created:** <#${miniThread.id}>\n` +
            `✅ **${tickets} main slot(s) reserved for this mini**\n` +
            `📌 **${updatedMainsLeft} MAINS LEFT**`
        )
        .catch(() => {});

      return;
    }

    // -------------------- MINI DRAW (inside mini thread) --------------------
    if (/^!minidraw$/i.test(content)) {
      if (!isMod) return message.reply("❌ Mods only.").catch(() => {});

      const meta = data.miniThreads?.[message.channel.id];
      if (!meta) return message.reply("This isn’t a registered mini thread.").catch(() => {});

      const miniRaffle = getRaffle(message.guild.id, message.channel.id);

      const pool = [];
      for (const [slot, owners] of Object.entries(miniRaffle.claims || {})) {
        if (!Array.isArray(owners) || owners.length === 0) continue;
        for (const raw of owners) {
          const uid = normalizeUserId(raw);
          if (uid) pool.push({ slot, uid });
        }
      }

      if (pool.length === 0) return message.reply("No one has claimed any mini slots.").catch(() => {});

      const picked = pool[randInt(0, pool.length - 1)];
      const winningNumber = picked.slot;
      const winnerId = String(picked.uid);
      if (!winnerId) return message.reply("Couldn’t pick a winner.").catch(() => {});

      const minutes = Number(config.miniClaimWindowMinutes ?? 10);
      const tickets = Number(meta.tickets || 1);
      const mainKey = meta.mainKey;

      // mark winner for Ⓜ️
      markMiniWinner(mainKey, winnerId);
      setMiniEntitlement(mainKey, winnerId, tickets);


      const mainThreadId = mainKey.split(":")[1];
      const mainThread = await message.guild.channels.fetch(mainThreadId).catch(() => null);
      if (!mainThread || !mainThread.isTextBased?.()) return message.reply("Main raffle thread not found.").catch(() => {});

      // remove placeholder reservation
      if (data.reservations?.[mainKey]?.[`mini:${message.channel.id}`]) {
        delete data.reservations[mainKey][`mini:${message.channel.id}`];
        saveData(data);
      }

      // set winner reservation (this locks main for everyone else)
      setReservation(mainKey, winnerId, tickets, minutes);

      const mainRaffle = getRaffle(message.guild.id, mainThread.id);

      // add winner to main thread if private
      try { await mainThread.members.add(winnerId); } catch {}

      await postOrUpdateBoard(mainThread, mainRaffle, mainKey, "🎟️ Main Board");

      // if winner covers all remaining, auto-fill
      const mainsLeft = getAvailableNumbers(mainRaffle).length;
      if (tickets >= mainsLeft && mainsLeft > 0) {
        const autoClaimed = autoFillRemainingMains(mainRaffle, winnerId, tickets);
        useReservation(mainKey, winnerId, autoClaimed.length);
        saveData(data);

        await postOrUpdateBoard(mainThread, mainRaffle, mainKey, "🎟️ Main Board");
        await mainThread.send({
          content:
            `<@${winnerId}>\n` +
            `🏆 **Mini Winner!** (slot #${winningNumber})\n\n` +
            `⚡ **Auto-filled final mains:** ${autoClaimed.join(", ")}\n` +
            `✅ Main raffle is now **FULL**`,
          allowedMentions: { users: [winnerId] },
        }).catch(() => {});
        await handleFullRaffle(mainThread, mainRaffle);
        return;
      }

      // normal claim window ping
      const claimMsg = await pingMiniWinnerInMain(mainThread, winnerId, winningNumber, tickets, minutes);
      if (claimMsg) {
        setTimeout(async () => {
          await mainThread
            .send({
              content: `<@${winnerId}> ⏰ You have 5 minutes left to claim your reserved main slots!`,
              allowedMentions: { users: [winnerId] },
            })
            .catch(() => {});
        }, 5 * 60 * 1000);
      }
      return;
    }

    // -------------------- SPLIT (paid only) --------------------
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

      const mk = raffleKey(message.guild.id, message.channel.id);
      await postOrUpdateBoard(message.channel, raffle, mk, "🎟️ Board");
      await maybeAnnounceAvailable(message.channel, raffle).catch(() => {});
      return message.reply(`✅ Slot **#${n}** split: <@${owners[0]}> + <@${friendId}> (half each).`).catch(() => {});
    }

    // -------------------- REMOVE (text command) --------------------
    const removeMatch = content.match(/^!remove(?:\s+(\d+))?$/i);
    if (removeMatch) {
      const raffle = getRaffle(message.guild.id, message.channel.id);
      if (!raffle.max) return message.reply("No raffle found here.").catch(() => {});

      const numArg = removeMatch[1] ? Number(removeMatch[1]) : null;

      // user removes all own slots
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
        const mk = raffleKey(message.guild.id, message.channel.id);
        await postOrUpdateBoard(message.channel, raffle, mk, "🎟️ Board");
        await maybeAnnounceAvailable(message.channel, raffle).catch(() => {});
        return message.reply("🗑️ Removed your slots.").catch(() => {});
      }

      // mods remove a specific slot number
      if (!isMod) return message.reply("❌ Only mods can remove a specific slot number.").catch(() => {});
      if (numArg < 1 || numArg > raffle.max) return message.reply(`Pick 1-${raffle.max}.`).catch(() => {});

      if (!raffle.claims[String(numArg)] || raffle.claims[String(numArg)].length === 0) {
        return message.reply(`Slot #${numArg} is already available.`).catch(() => {});
      }

      delete raffle.claims[String(numArg)];
      saveData(data);

      const mk = raffleKey(message.guild.id, message.channel.id);
      await postOrUpdateBoard(message.channel, raffle, mk, "🎟️ Board");
      await maybeAnnounceAvailable(message.channel, raffle).catch(() => {});
      return message.reply(`🧹 Slot **#${numArg}** is now available.`).catch(() => {});
    }

    // -------------------- REST (claim remaining slots) --------------------
    // -------------------- REST (claim remaining slots) --------------------
if (/^rest$/i.test(content)) {
  const raffle = getRaffle(message.guild.id, message.channel.id);
  if (!raffle.active || !raffle.max) return message.reply("No active raffle here.").catch(() => {});

  const mainKey = raffleKey(message.guild.id, message.channel.id);
  const res = getReservation(mainKey, message.author.id);

  if (isRaffleLockedForUser(mainKey, message.author.id, isMod)) {
    return message.reply("⛔ A mini winner is currently claiming reserved mains. Please wait a few minutes.").catch(() => {});
  }

  // FREE raffle rule: only 1 slot unless you're in a mini reservation window
  const freeMode = isFreeRaffle(raffle);
  const alreadyCount = countUserClaims(raffle, message.author.id);
  if (freeMode && alreadyCount >= 1 && !res) {
    return message.reply("This is a **FREE** raffle: you can only claim **1** slot. Use `!remove` to change it.").catch(() => {});
  }

  // If mini winner has a reservation window, REST should only claim up to that amount
  let limit = null;
  if (res && Number.isFinite(res.remaining)) limit = res.remaining;

  const claimed = [];
  for (let i = 1; i <= raffle.max; i++) {
    if (limit !== null && claimed.length >= limit) break;

    const key = String(i);
    const owners = raffle.claims[key];
    if (!owners || owners.length === 0) {
      raffle.claims[key] = [message.author.id];
      claimed.push(i);
    }
  }

  if (claimed.length === 0) {
    await message.react("❌").catch(() => {});
    return;
  }

  // ✅ Mark mini entitlement slots as Ⓜ️ (same as typed-number path)
  if (isMiniWinner(mainKey, message.author.id)) {
    const remainingEnt = getMiniEntitlement(mainKey, message.author.id);
    if (remainingEnt > 0) {
      const toMark = claimed.slice(0, remainingEnt);
      if (toMark.length) {
        addMiniWinnerSlots(mainKey, message.author.id, toMark);
        useMiniEntitlement(mainKey, message.author.id, toMark.length);
      }
    }
  }

  saveData(data);
  if (res) useReservation(mainKey, message.author.id, claimed.length);

  await postOrUpdateBoard(message.channel, raffle, mainKey, "🎟️ Board");
  await maybeAnnounceAvailable(message.channel, raffle).catch(() => {});
  await announceMainsLeftIfChanged(message.channel, raffle, mainKey).catch(() => {});

  await message.react("✅").catch(() => {});

  if (isRaffleFull(raffle)) await handleFullRaffle(message.channel, raffle);
  return;
}


    // -------------------- CLAIM NUMBERS (type numbers) --------------------
    const nums = content.match(/\d+/g)?.map((n) => Number(n)) ?? [];
    const looksLikeNumberClaim = nums.length > 0 && content.replace(/[0-9,\s]/g, "") === "";

    if (looksLikeNumberClaim) {
      const raffle = getRaffle(message.guild.id, message.channel.id);
      if (!raffle.active || !raffle.max) return;

      const uniqueNums = [...new Set(nums)].filter((n) => Number.isFinite(n) && n >= 1 && n <= raffle.max);
      if (!uniqueNums.length) return message.reply(`Pick 1-${raffle.max}.`).catch(() => {});

      const mainKey = raffleKey(message.guild.id, message.channel.id);
      const res = getReservation(mainKey, message.author.id);
      const freeMode = isFreeRaffle(raffle);

      // lock check
      if (isRaffleLockedForUser(mainKey, message.author.id, isMod)) {
        if (isMiniWinner(mainKey, message.author.id) && !res) {
          return message.reply("⛔ Your mini winner claim window has expired.").catch(() => {});
        }
        return message.reply("⛔ A mini winner is currently claiming reserved mains. Please wait a few minutes.").catch(() => {});
      }

      const totalReserved = Object.values(data.reservations?.[mainKey] || {})
        .filter((r) => r && r.remaining > 0 && Date.now() < r.expiresAt)
        .reduce((a, b) => a + b.remaining, 0);

      const claimedCount = countClaimedSlots(raffle);
      const availableCount = Math.max(0, raffle.max - claimedCount - totalReserved);

      if (availableCount <= 0 && !res) {
        return message.reply("⛔ All slots are currently reserved. Please wait.").catch(() => {});
      }

      const alreadyCount = countUserClaims(raffle, message.author.id);
      if (freeMode && alreadyCount >= 1 && !res) {
        return message.reply("This is a **FREE** raffle: you can only claim **1** slot. Use `!remove` to change it.").catch(() => {});
      }

      const allowed = res ? res.remaining : uniqueNums.length;
      const toTry = uniqueNums.slice(0, allowed);

      const claimed = [];
      const taken = [];

      for (const n of toTry) {
        const key = String(n);
        const owners = raffle.claims[key];

        if (!owners || owners.length === 0) {
          raffle.claims[key] = [message.author.id];
          claimed.push(n);
          continue;
        }

        if (owners.includes(message.author.id)) continue;

   for (const n of toTry) {
  const key = String(n);
  const owners = raffle.claims[key];

  // slot is free
  if (!owners || owners.length === 0) {
    raffle.claims[key] = [message.author.id];
    claimed.push(n);
    continue;
  }

  // user already owns it
  if (owners.includes(message.author.id)) continue;

  // 🚫 DO NOT auto-split
  taken.push(n);
}

        taken.push(n);
      }
// ❌ If nothing was claimed but some numbers were unavailable, react with ❌
if (!claimed.length && taken.length) {
  await message.react("❌").catch(() => {});
  return;
}

// (safety fallback, shouldn’t normally happen)
if (!claimed.length) {
  await message.react("❌").catch(() => {});
  return;
}


// ✅ Mark ONLY the mini winner’s free entitlement slots as Ⓜ️ (works even after time limit)
if (isMiniWinner(mainKey, message.author.id)) {
  const remaining = getMiniEntitlement(mainKey, message.author.id);
  if (remaining > 0) {
    const toMark = claimed.slice(0, remaining);
    if (toMark.length) {
      addMiniWinnerSlots(mainKey, message.author.id, toMark);
      useMiniEntitlement(mainKey, message.author.id, toMark.length);
    }
  }
}


saveData(data);
if (res) useReservation(mainKey, message.author.id, claimed.length);


      await postOrUpdateBoard(message.channel, raffle, mainKey, "🎟️ Board");
      await maybeAnnounceAvailable(message.channel, raffle).catch(() => {});
      await announceMainsLeftIfChanged(message.channel, raffle, mainKey).catch(() => {});

      await message.react("✅").catch(() => {});
      if (taken.length) await message.react("⚠️").catch(() => {});

      if (isRaffleFull(raffle)) await handleFullRaffle(message.channel, raffle);
      return; // no XP for claim-only messages
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
    console.error("messageCreate error:", err?.stack || err);
  }
});

// -------------------- Interactions (buttons + slash commands) --------------------
client.on("interactionCreate", async (interaction) => {
  try {
    // ---------- Buttons ----------
    if (interaction.isButton()) {
      const id = interaction.customId;
      await interaction.deferReply({ ephemeral: true }).catch(() => {});

      if (id.startsWith("giveaway:enter:")) {
        ensureGiveawayData();

        const messageId = id.split(":")[2];
        const g = data.giveaways?.[messageId];

        if (!g) return interaction.editReply({ content: "❌ This giveaway no longer exists." });
        if (g.ended) return interaction.editReply({ content: "❌ This giveaway has ended." });

        if (!Array.isArray(g.participants)) g.participants = [];
        if (g.participants.includes(interaction.user.id)) {
          return interaction.editReply({ content: "✅ You’re already entered!" });
        }

        g.participants.push(interaction.user.id);
        data.giveaways[messageId] = g;
        saveData(data);

        return interaction.editReply({ content: `✅ Entered! Entries: **${g.participants.length}**` });
      }

      return interaction.editReply({ content: "❌ Unknown button." }).catch(() => {});
    }

    // ---------- Slash Commands ----------
    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName; // ✅ declared ONCE

    // ✅ Prevent /giveaway from timing out (replace this with your real giveaway handler)
    if (name === "giveaway") {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      return interaction.editReply("✅ /giveaway received. (Add your giveaway-create logic here)");
    }

    // ✅ Everything below is ONLY for /roll
    if (name !== "roll") return;

    // ✅ public reply (everyone can see)
    await interaction.deferReply({ ephemeral: false }).catch(() => {});

    // mod check
    const isMod = isModMember(interaction.member);
    if (!isMod) return interaction.editReply("❌ Mods only.");

    // ---- Detect if this channel is a MINI thread ----
    const miniMeta = data.miniThreads?.[interaction.channelId];

    // ============================================
    // ✅ MINI ROLL
    // ============================================
    if (miniMeta) {
      const miniRaffle = getRaffle(interaction.guildId, interaction.channelId);

      if (!miniRaffle?.max) return interaction.editReply("❌ No mini raffle found here.");
      if (!isRaffleFull(miniRaffle)) return interaction.editReply("❌ Mini raffle isn’t full yet.");

      const pool = [];
      for (const [slot, owners] of Object.entries(miniRaffle.claims || {})) {
        if (!Array.isArray(owners) || owners.length === 0) continue;
        for (const raw of owners) {
          const uid = normalizeUserId(raw);
          if (uid) pool.push({ slot, uid });
        }
      }
      if (!pool.length) return interaction.editReply("❌ No valid entries to roll from.");

      const picked = pool[randInt(0, pool.length - 1)];
      const winningSlot = String(picked.slot);
      const winnerId = String(picked.uid);

      const mainKey = miniMeta.mainKey;
      const tickets = Number(miniMeta.tickets || 1);
      const minutes = Number(config.miniClaimWindowMinutes ?? 10);

      markMiniWinner(mainKey, winnerId);
      setMiniEntitlement(mainKey, winnerId, tickets);

      // remove placeholder reservation
      const placeholderKey = `mini:${interaction.channelId}`;
      if (data.reservations?.[mainKey]?.[placeholderKey]) {
        delete data.reservations[mainKey][placeholderKey];
        saveData(data);
      }

      // lock winner window (locks main for everyone else)
      setReservation(mainKey, winnerId, tickets, minutes);

      // ping winner in main
      const mainThreadId = String(mainKey.split(":")[1]);
      const mainThread = await interaction.guild.channels.fetch(mainThreadId).catch(() => null);
      if (!mainThread || !mainThread.isTextBased?.()) {
        return interaction.editReply("❌ Main raffle thread not found.");
      }

      try { await mainThread.members.add(winnerId); } catch {}

      const mainRaffle = getRaffle(interaction.guildId, mainThreadId);
      await postOrUpdateBoard(mainThread, mainRaffle, mainKey, "🎟️ Main Board").catch(() => {});
      await pingMiniWinnerInMain(mainThread, winnerId, winningSlot, tickets, minutes).catch(() => {});

      // announce in mini thread
      await interaction.channel.send({
        content:
          `🎲 **MINI ROLL RESULT**\n` +
          `🏆 Winner: <@${winnerId}>\n` +
          `🎟️ Winning mini slot: **#${winningSlot}**\n\n` +
          `➡️ Winner has **${minutes} minutes** to claim **${tickets}** main slot(s) in <#${mainThreadId}>`,
        allowedMentions: { users: [winnerId] },
      }).catch(() => {});

      return interaction.editReply(`✅ Mini rolled! Winner: <@${winnerId}> (slot #${winningSlot}).`);
    }

    // ============================================
    // ✅ MAIN ROLL
    // ============================================
    const raffle = getRaffle(interaction.guildId, interaction.channelId);
    if (!raffle?.max) return interaction.editReply("❌ No raffle found in this channel/thread.");
    if (!isRaffleFull(raffle)) return interaction.editReply("❌ Raffle isn’t full yet.");

    const pool = [];
    for (const [slot, owners] of Object.entries(raffle.claims || {})) {
      if (!Array.isArray(owners) || owners.length === 0) continue;
      for (const raw of owners) {
        const uid = normalizeUserId(raw);
        if (uid) pool.push({ slot, uid });
      }
    }
    if (!pool.length) return interaction.editReply("❌ No valid entries to roll from.");

    const picked = pool[randInt(0, pool.length - 1)];
    const winningSlot = String(picked.slot);
    const winnerId = String(picked.uid);

    await interaction.channel.send({
      content: `🎲 **ROLL RESULT**\n🏆 Winner: <@${winnerId}>\n🎟️ Winning slot: **#${winningSlot}**`,
      allowedMentions: { users: [winnerId] },
    }).catch(() => {});

    return interaction.editReply(`✅ Rolled! Winner: <@${winnerId}> (slot #${winningSlot}).`);
  } catch (err) {
    console.error("interactionCreate error:", err?.stack || err);
    try {
      if (interaction?.isRepliable?.()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: "❌ Something went wrong." }).catch(() => {});
        } else {
          await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true }).catch(() => {});
        }
      }
    } catch {}
  }
});

   
// -------------------- Login --------------------
const token = String(process.env.DISCORD_TOKEN || "").trim();
if (!token) {
  console.error("❌ No Discord token found (DISCORD_TOKEN env).");
  process.exit(1);
}
client.login(token).catch(console.error);





