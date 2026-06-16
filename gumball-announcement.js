/**
 * Habbo → Discord Announcer
 * G-Earth Node.js Extension
 *
 * Watches for messages from "Manager" in Habbo room chat
 * and posts item opening announcements to a Discord webhook.
 *
 * Setup:
 *   1. npm install axios
 *   2. Fill in DISCORD_WEBHOOK_URL below
 *   3. Run: node habbo-announcer.js
 *   4. Connect G-Earth to this extension
 */

const net = require("net");
const { EventEmitter } = require("events");
const axios = require("axios");

// ──────────────────────────────────────────────
//  CONFIG — edit these
// ──────────────────────────────────────────────
const DISCORD_WEBHOOK_URL =
 "https://discord.com/api/webhooks/1516357091961606215/zCPMpatbzooFr3t3THE_7LyiQd_R1ZH6B9KZc6L7UeWeMJJ4lD_JJhZ9egRNWu6bCRDV";

const GEARTH_PORT = 9092;      // default G-Earth port
const EXTENSION_NAME = "Habbo Announcer";
const EXTENSION_VERSION = "1.0.0";
const EXTENSION_AUTHOR = "Cherbot";

// Which Habbo username sends item-open messages
const MANAGER_NAME = "Manager";

// Rarity colours (for Discord embed sidebar)
const RARITY_COLOURS = {
  blueberry: 0x4169e1,
  lime:      0x32cd32,
  grape:     0x8b008b,
  lilac:     0xdda0dd,
  MEGA:   0x191970,
  default:   0xf0b429,
};

// If true, only post messages that mention these keywords
// Set to [] to post every Manager message
const KEYWORD_FILTER = [
  "blueberry", "lime", "grape", "lilac", "eclipse",
  "ball", "item", "opened", "rare", "won", "prize",
];

// ──────────────────────────────────────────────
//  G-Earth packet reader (minimal implementation)
// ──────────────────────────────────────────────
class GEarthExtension extends EventEmitter {
  constructor({ port = 9092, name, version, author }) {
    super();
    this.port = port;
    this.name = name;
    this.version = version;
    this.author = author;
    this.socket = null;
    this._buf = Buffer.alloc(0);
  }

  connect() {
    this.socket = net.createConnection({ port: this.port }, () => {
      console.log(`[G-Earth] Connected on port ${this.port}`);
      this._sendInfo();
    });

    this.socket.on("data", (chunk) => {
      this._buf = Buffer.concat([this._buf, chunk]);
      this._processBuffer();
    });

    this.socket.on("close", () => {
      console.log("[G-Earth] Connection closed");
      this.emit("disconnect");
    });

    this.socket.on("error", (err) => {
      console.error("[G-Earth] Socket error:", err.message);
    });
  }

  _processBuffer() {
    while (this._buf.length >= 6) {
      const packetLen = this._buf.readUInt32BE(0);
      if (this._buf.length < 4 + packetLen) break;

      const packetData = this._buf.slice(4, 4 + packetLen);
      this._buf = this._buf.slice(4 + packetLen);

      const header = packetData.readUInt16BE(0);
      const body = packetData.slice(2);
      this.emit("packet", { header, body });
    }
  }

  _sendInfo() {
    const payload = Buffer.concat([
      this._encodeString(this.name),
      this._encodeString(this.author),
      this._encodeString(this.version),
      Buffer.from([0]),
    ]);
    this._writePacket(1, payload);
    console.log(`[G-Earth] Sent extension info: ${this.name}`);
  }

  _encodeString(str) {
    const bytes = Buffer.from(str, "utf8");
    const len = Buffer.alloc(2);
    len.writeUInt16BE(bytes.length, 0);
    return Buffer.concat([len, bytes]);
  }

  _writePacket(header, body) {
    const h = Buffer.alloc(2);
    h.writeUInt16BE(header, 0);
    const data = Buffer.concat([h, body]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    this.socket.write(Buffer.concat([len, data]));
  }
}

// ──────────────────────────────────────────────
//  Parse chat from raw packet body
// ──────────────────────────────────────────────
function parseChat(body) {
  try {
    let offset = 4; // skip user index
    const len = body.readUInt16BE(offset);
    const message = body.slice(offset + 2, offset + 2 + len).toString("utf8");
    return message;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────
//  Rarity detector
// ──────────────────────────────────────────────
function detectRarity(message) {
  const lower = message.toLowerCase();
  for (const rarity of Object.keys(RARITY_COLOURS)) {
    if (rarity !== "default" && lower.includes(rarity)) return rarity;
  }
  return "default";
}

function getColour(rarity) {
  return RARITY_COLOURS[rarity] ?? RARITY_COLOURS.default;
}

// ──────────────────────────────────────────────
//  Extract player name from Manager message
// ──────────────────────────────────────────────
function extractPlayer(message) {
  const m1 = message.match(/^([A-Za-z0-9_\-=:.]{1,30})\s+(opened|won|got|received)/i);
  if (m1) return m1[1];

  const m2 = message.match(/for\s+([A-Za-z0-9_\-=:.]{1,30})/i);
  if (m2) return m2[1];

  const m3 = message.match(/^([A-Za-z0-9_\-=:.]{1,30}):/);
  if (m3) return m3[1];

  return null;
}

// ──────────────────────────────────────────────
//  Discord webhook sender
// ──────────────────────────────────────────────
async function postToDiscord(message, playerName) {
  const rarity = detectRarity(message);
  const colour = getColour(rarity);
  const rarityLabel = rarity !== "default"
    ? rarity.charAt(0).toUpperCase() + rarity.slice(1)
    : null;

  const embed = {
    title: rarityLabel ? `🎁 ${rarityLabel} item opened` : "🎁 Item opened",
    description: message,
    color: colour,
    timestamp: new Date().toISOString(),
    footer: { text: "Habbo Item Tracker" },
  };

  if (playerName) {
    embed.fields = [{ name: "Player", value: playerName, inline: true }];
    if (rarityLabel) embed.fields.push({ name: "Rarity", value: rarityLabel, inline: true });
  }

  try {
    await axios.post(DISCORD_WEBHOOK_URL, { embeds: [embed] });
    console.log(`[Discord] Posted: "${message.slice(0, 60)}"`);
  } catch (err) {
    console.error("[Discord] Failed to post:", err?.response?.data || err.message);
  }
}

// ──────────────────────────────────────────────
//  Message filter
// ──────────────────────────────────────────────
function shouldPost(message) {
  if (KEYWORD_FILTER.length === 0) return true;
  const lower = message.toLowerCase();
  return KEYWORD_FILTER.some((kw) => lower.includes(kw));
}

// ──────────────────────────────────────────────
//  Main
// ──────────────────────────────────────────────
if (!DISCORD_WEBHOOK_URL.includes("/webhooks/")) {
  console.error("❌  Set DISCORD_WEBHOOK_URL at the top of this file before running.");
  process.exit(1);
}

const ext = new GEarthExtension({
  port: GEARTH_PORT,
  name: EXTENSION_NAME,
  version: EXTENSION_VERSION,
  author: EXTENSION_AUTHOR,
});

ext.on("packet", ({ header, body }) => {
  try {
    const bodyStr = body.toString("utf8");
    console.log("[PACKET] Header:", header, "Body:", bodyStr.slice(0, 80));
    if (bodyStr.includes(MANAGER_NAME)) {
      console.log("[DEBUG] Found Manager packet! Body:", bodyStr.slice(0, 150));
      const message = parseChat(body);
      if (message && shouldPost(message)) {
        const player = extractPlayer(message);
        postToDiscord(message, player);
      }
    }
  } catch {
    // ignore parse errors
  }
});

ext.on("disconnect", () => {
  console.log("[Habbo Announcer] Disconnected. Restart to reconnect.");
});

ext.connect();

console.log(`
╔══════════════════════════════════════╗
║  Habbo → Discord Announcer running   ║
║  Watching for: Manager               ║
╚══════════════════════════════════════╝
`);
