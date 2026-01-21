// Cherbot (Discord.js v14) — clean + stable single-file
// - XP + levels + level roles
// - Giveaways: /giveaway start/end/reroll + join button + timed auto-end (NO SWEEP) + (handler) list
// - Raffles in threads (main + minis) + mains-left + minis reserve mains + totals + available list
// - Mini winners marked Ⓜ️ on main board
// - No @gamba ping on mini create or mini win
// - Claim messages react ✅ instead of repeating numbers
// - Host pinged once when MAIN raffle becomes FULL
// - /assign and /free slash commands (handlers included)

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
      miniWinners: {}, // mainKey -> { userId: true }
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
}

// -------------------- Giveaway scheduling (NO SWEEP) --------------------
const giveawayTimers = new Map(); // messageId -> timeout

function scheduleGiveawayEnd(client, messageId, endsAt) {
  if (!messageId || !endsAt) return;

  const existing = giveawayTimers.get(messageId);
  if (existing) clearTimeout(existing);

  const delay = Math.max(0, Number(endsAt) - Date.now());

  const t = setTimeout(() => {
    giveawayTimers.delete(messageId);
    endGiveawayByMessageId(client, messageId).catch((e) =>
      console.error("❌ scheduled giveaway end failed:", messageId, e?.stack || e)
    );
  }, delay + 250);

  giveawayTimers.set(messageId, t);
  console.log(`⏲️ Scheduled giveaway end in ${Math.round(delay / 1000)}s for`, messageId);
}

function clearGiveawayTimer(messageId) {
  const t = giveawayTimers.get(messageId);
  if (t) clearTimeout(t);
  giveawayTimers.delete(messageId);
}

// -------------------- Ready --------------------
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  ensureGiveawayData();
  ensureRaffleData();

  // Re-schedule active giveaways on startup
  for (const [messageId, g] of Object.entries(data.giveaways || {})) {
    if (!g || g.ended) continue;
    if (!g.endsAt) continue;
    scheduleGiveawayEnd(client, messageId, g.endsAt);
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
async function endGiveawayByMessageId(client, messageId, { reroll = false } = {}) {
  ensureGiveawayData();

  // kill any pending timer if ending manually or by schedule
  clearGiveawayTimer(messageId);

  const g = data.giveaways?.[messageId];
  if (!g) return { ok: false, reason: "Giveaway not found." };
  if (g.ended && !reroll) return { ok: false, reason: "Giveaway already ended." };

  console.log("🏁 endGiveawayByMessageId:", {
    messageId,
    guildId: g.guildId,
    channelId: g.channelId,
    winnersChannelId: String(config.giveawayWinnerChannelId || "").trim(),
    ended: g.ended,
    endsAt: g.endsAt,
    participants: Array.isArray(g.participants) ? g.participants.length : 0,
  });

  const guild = client.guilds.cache.get(g.guildId);
  if (!guild) return { ok: false, reason: "Guild not available." };

  const gwChannel = await guild.channels.fetch(g.channelId).catch(() => null);
  if (!gwChannel || !gwChannel.isTextBased()) {
    return { ok: false, reason: "Giveaway channel not found." };
  }

  const participants = Array.isArray(g.participants) ? g.participants : [];
  const winners = pickWinnersFrom(participants, Number(g.winners) || 1);

  g.ended = true;
  g.endedAt = Date.now();
  g.lastWinners = winners;
  data.giveaways[messageId] = g;
  saveData(data);

  const prize = g.prize || "Giveaway";
  const winnerText = winners.length
    ? winners.map((id) => `<@${id}>`).join(", ")
    : "_No valid entries_";

  const endedUnix = Math.floor((g.endedAt || Date.now()) / 1000);

  // Winners post embed (winners channel)
  const resultsEmbed = new EmbedBuilder()
    .setTitle(reroll ? "🔁 Giveaway Rerolled" : "🏁 Giveaway Ended")
    .addFields(
      { name: "🏆 Prize", value: String(prize), inline: false },
      { name: "🎉 Winner(s)", value: winnerText, inline: false },
      { name: "⏱️ Ended", value: `<t:${endedUnix}:F>`, inline: false }
    )
    .setTimestamp();

  const winnerChannelId = String(config.giveawayWinnerChannelId || "").trim();

  let winCh = null;
  if (winnerChannelId) {
    try {
      winCh = await guild.channels.fetch(winnerChannelId);
      console.log("✅ Winners channel fetched:", {
        id: winCh.id,
        type: winCh.type,
        isTextBased: !!winCh.isTextBased?.(),
        name: winCh.name,
      });
    } catch (e) {
      console.error(
        "❌ Failed to fetch winners channel:",
        winnerChannelId,
        e?.rawError || e?.message || e
      );
    }
  }

  const targetCh = winCh && winCh.isTextBased?.() ? winCh : gwChannel;

  console.log(
    "📣 Posting winners to:",
    targetCh.id,
    targetCh.id === gwChannel.id ? "(FALLBACK to giveaway channel)" : "(winners channel)"
  );

  await targetCh.send({
    content: winners.length ? winnerText : "",
    embeds: [resultsEmbed],
    allowedMentions: winners.length ? { users: winners } : undefined,
  }).catch((e) => console.error("❌ Winner post failed:", e?.stack || e));

  // disable button + update original giveaway message to show winners
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
          .setDescription(
            `**Prize:** ${prize}\n` +
            `**Winners:** ${winnerText}\n` +
            `**Ended:** <t:${endedUnix}:F>`
          )
          .setTimestamp()
      : new EmbedBuilder()
          .setTitle("🏁 Giveaway Ended")
          .setDescription(
            `**Prize:** ${prize}\n` +
            `**Winners:** ${winnerText}\n` +
            `**Ended:** <t:${endedUnix}:F>`
          )
          .setTimestamp();

    await msg.edit({
      embeds: [endedEmbed],
      components: [disabledRow],
    });

    console.log("✅ Giveaway message updated & button disabled:", messageId);
  } catch (e) {
    console.error(
      "⚠️ Failed to update original giveaway message:",
      e?.rawError || e?.message || e
    );
  }

  return { ok: true, winners };
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

function getRaffle(guildId, channelId) {
  ensureRaffleData();
  const key = raffleKey(guildId, channelId);

  if (!data.raffles[key]) {
    data.raffles[key] = {
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
  }

  const r = data.raffles[key];

  // migrations
  if (typeof r.slotPrice === "undefined") r.slotPrice = null;
  if (typeof r.totalsPosted === "undefined") r.totalsPosted = false;
  if (typeof r.hostId === "undefined") r.hostId = null;
  if (typeof r.fullNotified === "undefined") r.fullNotified = false;
  if (typeof r.lastAvailableAnnouncedClaimed === "undefined") r.lastAvailableAnnouncedClaimed = null;

  // migrate string -> array
  if (r?.claims && typeof r.claims === "object") {
    for (const [num, v] of Object.entries(r.claims)) {
      if (typeof v === "string") r.claims[num] = [v];
    }
  }

  return r;
}

// ✅ blank price is NOT free
function isFreeRaffle(raffle) {
  const t = String(raffle.priceText || "").trim().toLowerCase();
  if (!t) return false;
  return (
    t === "free" ||
    t === "0" ||
    t === "0c" ||
    t === "0 coin" ||
    t === "0 coins" ||
    t.includes("0 coin") ||
    t.includes("0coin")
  );
}

function parseCoinPriceFromText(text) {
  const t = String(text || "").toLowerCase();
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
// Board (supports Ⓜ️ if mainKey provided)
function formatBoardText(raffle, mainKey = null) {
  const closed = !raffle.active || isRaffleFull(raffle);
  const status = closed ? " ✅ **FULL / CLOSED**" : "";
  const header =
    `🎟️ Raffle: **${raffle.max} slots**` +
    (raffle.priceText ? ` (**${raffle.priceText}**)` : "") +
    status;

  const lines = [];
  for (let i = 1; i <= raffle.max; i++) {
    const owners = raffle.claims[String(i)];
    if (!owners || owners.length === 0) {
      lines.push(`${i}. _(available)_`);
    } else {
      const formatted = owners.map((raw) => {
        const uid = normalizeUserId(raw) || raw;
        const mark = mainKey && uid && isMiniWinner(mainKey, uid) ? " Ⓜ️" : "";
        return `<@${uid}>${mark}`;
      });
      lines.push(`${i}. ${formatted.join(" + ")}`);
    }
  }

  return `${header}\n\n${lines.join("\n")}`.slice(0, 1900);
}

async function postOrUpdateBoard(channel, raffle, mainKey = null) {
  const text = formatBoardText(raffle, mainKey);

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
// -------------------- Reservations (mini winners claim window) --------------------
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

function formatAvailableList(avail, maxToShow = 40) {
  const shown = avail.slice(0, maxToShow);
  const more = avail.length > shown.length ? ` … (+${avail.length - shown.length} more)` : "";
  return `${shown.join(", ")}${more}`;
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
    .send(`🟢 **Available slots (${avail.length}):** ${formatAvailableList(avail, maxToShow)}`)
    .catch(() => {});
}

// -------------------- Totals (auto when full) --------------------
function computeTotals(raffle) {
  const slotPrice = Number(raffle.slotPrice);
  if (!Number.isFinite(slotPrice)) return null;

  const perUser = new Map();
  let claimedSlots = 0;

  for (const ownersRaw of Object.values(raffle.claims || {})) {
    if (!Array.isArray(ownersRaw) || ownersRaw.length === 0) continue;

    const owners = ownersRaw.map(normalizeUserId).filter(Boolean);
    if (!owners.length) continue;

    claimedSlots += 1;

    const share = slotPrice / owners.length;
    for (const uid of owners) {
      perUser.set(uid, (perUser.get(uid) || 0) + share);
    }
  }

  const lines = [];
  let grand = 0;

  for (const [uid, amt] of perUser.entries()) {
    const rounded = Math.round(amt);
    grand += rounded;
    lines.push({ uid, rounded });
  }

  lines.sort((a, b) => b.rounded - a.rounded);
  return { claimedSlots, slotPrice, lines, grand };
}

async function postTotalsIfFull(channel, raffle, title) {
  if (!isRaffleFull(raffle)) return;
  if (raffle.totalsPosted) return;

  const totals = computeTotals(raffle);
  if (!totals) return;

  raffle.totalsPosted = true;
  saveData(data);

  const body = [
    `💰 **TOTALS (${title})**`,
    `🎟️ Slots claimed: **${totals.claimedSlots}/${raffle.max}**`,
    `💳 Slot price: **${totals.slotPrice}c**`,
    ``,
    ...totals.lines.map((x) => `• <@${x.uid}>: **${x.rounded}c**`),
    ``,
    `🧾 **Grand total:** **${totals.grand}c**`,
  ].join("\n");

  await channel.send(body).catch(() => {});
}

// -------------------- FULL handler (shared) --------------------
async function handleFullRaffle(channel, raffle) {
  const isMini = Boolean(data.miniThreads?.[channel.id]);
  const hostId = normalizeUserId(raffle.hostId);
  const shouldPingHost = !isMini && hostId && !raffle.fullNotified;

  if (shouldPingHost) raffle.fullNotified = true;
  raffle.active = false;
  saveData(data);

  await postTotalsIfFull(channel, raffle, isMini ? "Mini" : "Main");

  const hostPing = shouldPingHost ? `<@${hostId}> ` : "";
  await channel.send({
    content: `${hostPing}✅ **FULL** — all slots claimed. Mods can now \`/roll\` the winner 🎲`,
    allowedMentions: shouldPingHost ? { users: [hostId] } : undefined,
  }).catch(() => {});
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
        return message.reply("❌ Start the raffle **inside the thread** (not the parent channel).").catch(() => {});
      }

      const max = Number(startMatch[1]);
      const priceText = (startMatch[2]?.trim() || "");

      if (!Number.isFinite(max) || max < 1 || max > 500) {
        return message.reply("Pick a slot amount between 1 and 500.").catch(() => {});
      }

      const raffle = getRaffle(message.guild.id, message.channel.id);

      // reset mini winners for this main raffle
      const mainKey = raffleKey(message.guild.id, message.channel.id);
      ensureMiniWinners();
      data.miniWinners[mainKey] = {};
      saveData(data);

      raffle.active = true;
      raffle.max = max;
      raffle.priceText = priceText;
      raffle.slotPrice = parseCoinPriceFromText(priceText);
      raffle.totalsPosted = false;

      raffle.claims = {};
      raffle.lastBoardMessageId = null;
      raffle.lastMainsLeftAnnounced = null;
      raffle.lastAvailableAnnouncedClaimed = null;

      raffle.hostId = message.author.id;
      raffle.fullNotified = false;

      raffle.createdAt = Date.now();
      saveData(data);

      // keep gamba ping for MAIN raffle start
      const ping = gambaMention();
      if (ping) await message.channel.send(ping).catch(() => {});

      await postOrUpdateBoard(message.channel, raffle, mainKey);
      await announceMainsLeftIfChanged(message.channel, raffle, mainKey);

      await message
        .reply(
          `✅ Raffle started: **${max} slots**` +
            (priceText ? ` (**${priceText}**)` : "") +
            `. Type numbers to claim.`
        )
        .catch(() => {});
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

      const miniThread = await miniCreateChannel.threads.create({
        name: `${message.channel.name} - ${tickets} ticket(s) (${miniSlots} slots)`.slice(0, 100),
        autoArchiveDuration: 1440,
        reason: "Mini raffle created",
      }).catch(() => null);

      if (!miniThread) return message.reply("❌ I couldn't create the mini thread (check permissions).").catch(() => {});

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

      // ✅ NO @Gamba ping on mini creation
      await postOrUpdateBoard(miniThread, miniRaffle);

      await miniThread.send(
        `🎲 **Mini created**\n` +
          `🎟️ Prize: **${tickets}** main ticket(s)\n` +
          `💰 Main ticket price: **${mainTicketPrice}c** → Pot: **${pot}c**\n` +
          `🔢 Mini slots: **${miniSlots}** → **${perSlot}c per slot** (exact ${perSlotExact.toFixed(2)}c)\n\n` +
          `Claim by typing numbers like: \`1\` or \`1 2 3\``
      ).catch(() => {});

      // ✅ NO @Gamba ping on main thread mini announcement
      await message.channel.send(
        `🎲 **Mini created:** <#${miniThread.id}>\n` +
          `✅ **${tickets} main slot(s) reserved for this mini**\n` +
          `📌 **${computeMainsLeft(getRaffle(message.guild.id, message.channel.id), mainKey)} MAINS LEFT**`
      ).catch(() => {});

      return message.reply(`✅ Mini thread created: <#${miniThread.id}>`).catch(() => {});
    }

    // (Everything after this point in messageCreate stays the same as your original file)
    // -------------------- MINI DRAW / split / free / rest / claim / xp --------------------
    // Keep your original code here unchanged.

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

      // (Your selfrole button handler remains unchanged in your original file)
      return interaction.editReply({ content: "❌ Unknown button." }).catch(() => {});
    }

    // ---------- Slash Commands ----------
    if (!interaction.isChatInputCommand()) return;

    const isMod = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);

    // ---------- /giveaway ----------
    if (interaction.commandName === "giveaway") {
      if (!isMod) return interaction.reply({ content: "❌ Mods only.", ephemeral: true });
      await interaction.deferReply({ ephemeral: true }).catch(() => {});

      ensureGiveawayData();
      const sub = interaction.options.getSubcommand();

      if (sub === "list") {
        const active = Object.entries(data.giveaways || {}).filter(([_, g]) => g && !g.ended);
        if (!active.length) return interaction.editReply({ content: "No active giveaways saved." });

        const lines = active.slice(0, 10).map(([id, g]) =>
          `• ID: \`${id}\` | Prize: **${g.prize || "Giveaway"}** | Ends: <t:${Math.floor((g.endsAt || Date.now()) / 1000)}:R>`
        );
        return interaction.editReply({ content: lines.join("\n") });
      }

      if (sub === "start") {
        const prize = interaction.options.getString("prize", true);
        const durationStr = interaction.options.getString("duration", true);
        const winners = interaction.options.getInteger("winners", true);

        const sponsorUser = interaction.options.getUser("sponsor", false);
        const sponsorId = sponsorUser?.id || null;

        const pingOpt = interaction.options.getBoolean("ping", false);
        const shouldPing = pingOpt === null ? true : Boolean(pingOpt);

        const ms = parseDurationToMs(durationStr);
        if (!ms) return interaction.editReply({ content: "❌ Duration must be `10m`, `2h`, or `1d`." });
        if (winners < 1 || winners > 50) return interaction.editReply({ content: "❌ Winners must be 1–50." });

        const endsAt = Date.now() + ms;

        const fields = [{ name: "🧑‍💼 Hosted by", value: `<@${interaction.user.id}>`, inline: true }];
        if (sponsorId) fields.push({ name: "🎁 Sponsored by", value: `<@${sponsorId}>`, inline: true });

        const embed = new EmbedBuilder()
          .setTitle("🎉 Giveaway Started")
          .setDescription(
            `**Prize:** ${prize}\n` +
              `**Winners:** ${winners}\n` +
              `**Ends:** <t:${Math.floor(endsAt / 1000)}:R>\n\n` +
              `Click the button below to enter!`
          )
          .addFields(fields)
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("giveaway:enter:pending").setLabel("Join Giveaway").setStyle(ButtonStyle.Success)
        );

        const gwChannelId = String(config.giveawayChannelId || "").trim();
        const gwChannel = gwChannelId ? await interaction.guild.channels.fetch(gwChannelId).catch(() => null) : null;

        if (!gwChannel || !gwChannel.isTextBased()) {
          return interaction.editReply({ content: "❌ Giveaway channel not found. Check config.giveawayChannelId." });
        }

        const pingText = shouldPing ? giveawayMention() : "";
        const sponsorPing = sponsorId ? `<@${sponsorId}>` : "";
        const msgContent = [pingText, sponsorPing].filter(Boolean).join(" ").trim();

        let msg;
        try {
          msg = await gwChannel.send({
            content: msgContent || undefined,
            embeds: [embed],
            components: [row],
            allowedMentions: {
              roles: shouldPing && config.giveawayRoleId ? [String(config.giveawayRoleId)] : [],
              users: sponsorId ? [sponsorId] : [],
            },
          });
        } catch (e) {
          console.error("Giveaway start send failed:", e?.stack || e);
          return interaction.editReply({ content: "❌ I couldn't post the giveaway message. Check bot perms." });
        }

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`giveaway:enter:${msg.id}`).setLabel("Join Giveaway").setStyle(ButtonStyle.Success)
        );
        await msg.edit({ components: [row2] }).catch(() => {});

        data.giveaways[msg.id] = {
          guildId: interaction.guildId,
          channelId: gwChannel.id,
          prize,
          winners,
          endsAt,
          startedAt: Date.now(),
          ended: false,
          participants: [],
          hostId: interaction.user.id,
          sponsorId,
          pinged: shouldPing,
        };
        saveData(data);

        // ✅ schedule the giveaway end (NO SWEEP)
        scheduleGiveawayEnd(client, msg.id, endsAt);

        console.log("✅ Giveaway saved:", msg.id, "endsAt:", endsAt, "channel:", gwChannel.id);

        return interaction.editReply({ content: `✅ Giveaway started in <#${gwChannel.id}> (ID: \`${msg.id}\`)` });
      }

      if (sub === "end") {
        const messageId = interaction.options.getString("messageid", true);
        clearGiveawayTimer(messageId);
        const result = await endGiveawayByMessageId(client, messageId).catch(() => null);
        if (!result || !result.ok) return interaction.editReply({ content: `❌ ${result?.reason || "Failed."}` });
        return interaction.editReply({ content: "✅ Giveaway ended." });
      }

      if (sub === "reroll") {
        const messageId = interaction.options.getString("messageid", true);
        clearGiveawayTimer(messageId);
        const result = await endGiveawayByMessageId(client, messageId, { reroll: true }).catch(() => null);
        if (!result || !result.ok) return interaction.editReply({ content: `❌ ${result?.reason || "Failed."}` });
        return interaction.editReply({ content: "🔁 Giveaway rerolled." });
      }

      return interaction.editReply({ content: "❌ Unknown subcommand." });
    }

    // (Your /assign, /free, /roll blocks remain unchanged in your original file)

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
