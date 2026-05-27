// ===================== MYSTERY GAME MODULE =====================
// Drop-in module for Cherbot (Discord.js v14)
// Adds: /mystery start|accuse|search|hint|summary|vote|tallyvotes|toggleevents
// Plus: !code already handled in main bot (ignored here)

const { EmbedBuilder, PermissionsBitField } = require("discord.js");

// -------------------- Game data --------------------
const characters = {
  "Miss Scarlett":   "A young and beautiful femme fatale with a mysterious past.",
  "Colonel Mustard": "A dignified retired military officer with a storied career.",
  "Mrs. White":      "The long-serving housekeeper with a no-nonsense attitude.",
  "Reverend Green":  "A charming yet suspiciously nervous reverend.",
  "Mrs. Peacock":    "A wealthy socialite with a penchant for drama.",
  "Professor Plum":  "A brilliant but absent-minded academic.",
};

const weapons = ["Revolver", "Dagger", "Lead Piping", "Rope", "Spanner", "Candlestick"];

const rooms = {
  "Kitchen":      "A modern kitchen with shiny appliances and a large island in the middle.",
  "Dining Room":  "An elegant dining room with a long table set for a feast.",
  "Lounge":       "A cozy lounge with a fireplace and comfortable seating.",
  "Hall":         "A grand hall with a chandelier and a sweeping staircase.",
  "Study":        "A quiet study filled with books and a large desk.",
  "Library":      "A grand library with shelves of books and a reading nook.",
  "Billiard Room":"A room with a billiard table and sports memorabilia.",
  "Conservatory": "A bright conservatory filled with exotic plants.",
  "Ballroom":     "A grand ballroom with a polished dance floor and large windows.",
};

// Room clues — each room reveals a suspect + weapon
const clues = {
  "Kitchen":      { suspect: "Mrs. White",      weapon: "Dagger"       },
  "Dining Room":  { suspect: "Colonel Mustard", weapon: "Revolver"     },
  "Lounge":       { suspect: "Miss Scarlett",   weapon: "Candlestick"  },
  "Hall":         { suspect: "Reverend Green",  weapon: "Rope"         },
  "Study":        { suspect: "Professor Plum",  weapon: "Lead Piping"  },
  "Library":      { suspect: "Mrs. Peacock",    weapon: "Spanner"      },
  "Billiard Room":{ suspect: "Miss Scarlett",   weapon: "Revolver"     },
  "Conservatory": { suspect: "Colonel Mustard", weapon: "Candlestick"  },
  "Ballroom":     { suspect: "Mrs. Peacock",    weapon: "Dagger"       },
};

const CHARACTER_EMOJIS = {
  "Miss Scarlett":   "🔴",
  "Colonel Mustard": "🟡",
  "Mrs. White":      "⚪",
  "Reverend Green":  "🟢",
  "Mrs. Peacock":    "🔵",
  "Professor Plum":  "🟣",
};

const ROOM_EMOJIS = {
  "Kitchen":      "🍽️",
  "Dining Room":  "🍴",
  "Lounge":       "🛋️",
  "Hall":         "🏛️",
  "Study":        "📚",
  "Library":      "📖",
  "Billiard Room":"🎱",
  "Conservatory": "🌿",
  "Ballroom":     "💃",
};

// -------------------- Per-guild game state --------------------
// Keeps games isolated so multiple servers can play at once.
// Shape: { [guildId]: { murderer, weapon, scene, discovered, votes, randomEventsEnabled, intervalId } }
const gameStates = new Map();

function newState() {
  return {
    murderer:             randomChoice(Object.keys(characters)),
    weapon:               randomChoice(weapons),
    scene:                randomChoice(Object.keys(rooms)),
    discovered:           new Set(),      // room names already searched
    votes:                new Map(),      // suspect -> count
    randomEventsEnabled:  true,
    intervalId:           null,           // setInterval handle
  };
}

function getState(guildId) {
  if (!gameStates.has(guildId)) gameStates.set(guildId, newState());
  return gameStates.get(guildId);
}

function resetState(guildId) {
  const old = gameStates.get(guildId);
  if (old?.intervalId) clearInterval(old.intervalId);
  gameStates.set(guildId, newState());
  return gameStates.get(guildId);
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// -------------------- Random events --------------------
const RANDOM_EVENTS = [
  "A strange noise echoes through the mansion.",
  "The lights flicker and go out momentarily.",
  "A shadow moves across the hallway.",
  "Someone knocks over a vase in the Conservatory.",
  "A cold draught sweeps through the Hall.",
  "Footsteps are heard on the stairs... then silence.",
];

function startRandomEvents(client, guildId, channelId, intervalMs = 5 * 60 * 1000) {
  const state = getState(guildId);
  if (state.intervalId) clearInterval(state.intervalId);

  state.intervalId = setInterval(async () => {
    if (!state.randomEventsEnabled) return;
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch?.isTextBased?.()) return;
    await ch.send(`👁️ *${randomChoice(RANDOM_EVENTS)}*`).catch(() => {});
  }, intervalMs);
}

function stopRandomEvents(guildId) {
  const state = getState(guildId);
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
}

// -------------------- Subcommand handlers --------------------

async function handleStart(interaction, client) {
  const state = resetState(interaction.guildId);

  const charLines = Object.entries(characters).map(
    ([name, desc]) => `${CHARACTER_EMOJIS[name]} **${name}** — ${desc}`
  );
  const roomLines = Object.entries(rooms).map(
    ([name, desc]) => `${ROOM_EMOJIS[name]} **${name}** — ${desc}`
  );

  const introEmbed = new EmbedBuilder()
    .setTitle("🔍 Murder Mystery — A new case begins!")
    .setDescription(
      `The victim has been found. A murder has been committed somewhere in the mansion.\n\n` +
      `Your task: find out **who** did it, with **what weapon**, and **in which room**.\n\n` +
      `Use \`/mystery search\` to investigate rooms for clues.\n` +
      `Use \`/mystery accuse\` when you're ready to make your accusation.\n` +
      `Use \`/mystery hint\` if you're stuck (requires 3+ clues found).`
    )
    .setColor(0x2c2f33)
    .setTimestamp();

  const charsEmbed = new EmbedBuilder()
    .setTitle("🕵️ Suspects")
    .setDescription(charLines.join("\n"))
    .setColor(0x992d22);

  const roomsEmbed = new EmbedBuilder()
    .setTitle("🏚️ Rooms to Investigate")
    .setDescription(roomLines.join("\n"))
    .setColor(0x1f8b4c);

  await interaction.editReply({ embeds: [introEmbed] });
  await interaction.channel.send({ embeds: [charsEmbed] }).catch(() => {});
  await interaction.channel.send({ embeds: [roomsEmbed] }).catch(() => {});

  // Start atmospheric random events every 5 minutes
  startRandomEvents(client, interaction.guildId, interaction.channelId);
}

async function handleSearch(interaction) {
  const roomInput = interaction.options.getString("room", true);
  const room = Object.keys(rooms).find(
    (r) => r.toLowerCase() === roomInput.toLowerCase().trim()
  );

  if (!room) {
    return interaction.editReply(
      `❌ **${roomInput}** isn't a valid room. Choose from:\n${Object.keys(rooms).join(", ")}`
    );
  }

  const state = getState(interaction.guildId);

  if (state.discovered.has(room)) {
    return interaction.editReply(
      `🔎 You've already searched the **${room}**. No new clues to find there.`
    );
  }

  state.discovered.add(room);
  const clue = clues[room];

  const embed = new EmbedBuilder()
    .setTitle(`${ROOM_EMOJIS[room]} Searching the ${room}…`)
    .setDescription(
      `After a careful search you uncover something suspicious.\n\n` +
      `👤 A witness saw **${clue.suspect}** in the area.\n` +
      `🔪 A **${clue.weapon}** was found nearby.`
    )
    .setColor(0xe67e22)
    .setFooter({ text: `Rooms searched: ${state.discovered.size} / ${Object.keys(rooms).length}` })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

async function handleAccuse(interaction) {
  const suspect = interaction.options.getString("suspect", true).trim();
  const weapon  = interaction.options.getString("weapon",  true).trim();
  const room    = interaction.options.getString("room",    true).trim();

  const state = getState(interaction.guildId);

  const suspectMatch = Object.keys(characters).find(
    (c) => c.toLowerCase() === suspect.toLowerCase()
  );
  const weaponMatch = weapons.find(
    (w) => w.toLowerCase() === weapon.toLowerCase()
  );
  const roomMatch = Object.keys(rooms).find(
    (r) => r.toLowerCase() === room.toLowerCase()
  );

  if (!suspectMatch || !weaponMatch || !roomMatch) {
    const problems = [];
    if (!suspectMatch) problems.push(`❌ Unknown suspect: **${suspect}**`);
    if (!weaponMatch)  problems.push(`❌ Unknown weapon: **${weapon}**`);
    if (!roomMatch)    problems.push(`❌ Unknown room: **${room}**`);
    return interaction.editReply(problems.join("\n"));
  }

  const correct =
    suspectMatch === state.murderer &&
    weaponMatch  === state.weapon   &&
    roomMatch    === state.scene;

  if (correct) {
    stopRandomEvents(interaction.guildId);

    const embed = new EmbedBuilder()
      .setTitle("🎉 Case Solved!")
      .setDescription(
        `**${interaction.user.displayName}** cracked the case!\n\n` +
        `🔍 It was **${state.murderer}**\n` +
        `🔪 with the **${state.weapon}**\n` +
        `📍 in the **${state.scene}**\n\n` +
        `*The culprit is taken away. Justice is served.*`
      )
      .setColor(0x2ecc71)
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  // Wrong — give a partial hint so it's not purely brutal
  const hintParts = [];
  if (suspectMatch === state.murderer) hintParts.push("✅ Suspect is correct");
  else hintParts.push("❌ Wrong suspect");
  if (weaponMatch === state.weapon) hintParts.push("✅ Weapon is correct");
  else hintParts.push("❌ Wrong weapon");
  if (roomMatch === state.scene) hintParts.push("✅ Room is correct");
  else hintParts.push("❌ Wrong room");

  const embed = new EmbedBuilder()
    .setTitle("🚫 Wrong Accusation")
    .setDescription(
      hintParts.join("\n") +
      "\n\nKeep investigating — the truth is still out there."
    )
    .setColor(0xe74c3c)
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

async function handleHint(interaction) {
  const state = getState(interaction.guildId);

  if (state.discovered.size < 3) {
    return interaction.editReply(
      `🕯️ You need to search at least **3 rooms** before a hint is available. ` +
      `You've searched **${state.discovered.size}** so far.`
    );
  }

  const hints = [
    `Think carefully about the **room** — where was the victim last seen?`,
    `Consider the **weapon** — who had access to such a thing?`,
    `Focus on the **suspect** — who had the most to gain?`,
    `The clues in the rooms are not random — look for patterns.`,
    `Eliminate suspects one by one based on what you've found.`,
  ];

  return interaction.editReply(`💡 **Hint:** ${randomChoice(hints)}`);
}

async function handleSummary(interaction) {
  const state = getState(interaction.guildId);

  if (state.discovered.size === 0) {
    return interaction.editReply("📋 No clues discovered yet. Use `/mystery search` to start investigating.");
  }

  const lines = [...state.discovered].map((room) => {
    const c = clues[room];
    return `${ROOM_EMOJIS[room]} **${room}** → ${c.suspect} + ${c.weapon}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("📋 Case Notes")
    .setDescription(lines.join("\n"))
    .setColor(0x3498db)
    .setFooter({ text: `${state.discovered.size} of ${Object.keys(rooms).length} rooms searched` })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

async function handleVote(interaction) {
  const suspect = interaction.options.getString("suspect", true).trim();
  const match = Object.keys(characters).find(
    (c) => c.toLowerCase() === suspect.toLowerCase()
  );

  if (!match) {
    return interaction.editReply(
      `❌ **${suspect}** isn't a valid suspect.\nChoose from: ${Object.keys(characters).join(", ")}`
    );
  }

  const state = getState(interaction.guildId);
  state.votes.set(match, (state.votes.get(match) || 0) + 1);

  return interaction.editReply(
    `🗳️ Vote registered for **${match}**. ` +
    `They now have **${state.votes.get(match)}** vote(s). Use \`/mystery tallyvotes\` to see the full tally.`
  );
}

async function handleTallyVotes(interaction) {
  const state = getState(interaction.guildId);

  if (state.votes.size === 0) {
    return interaction.editReply("🗳️ No votes cast yet. Use `/mystery vote` to cast one.");
  }

  const sorted = [...state.votes.entries()].sort((a, b) => b[1] - a[1]);
  const lines = sorted.map(
    ([suspect, count], i) =>
      `${i === 0 ? "👑" : `**${i + 1}.**`} ${CHARACTER_EMOJIS[suspect]} **${suspect}** — ${count} vote(s)`
  );

  const embed = new EmbedBuilder()
    .setTitle("🗳️ Vote Tally")
    .setDescription(lines.join("\n"))
    .setColor(0x9b59b6)
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

async function handleToggleEvents(interaction) {
  if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    return interaction.editReply("❌ Mods only.");
  }

  const state = getState(interaction.guildId);
  state.randomEventsEnabled = !state.randomEventsEnabled;
  const status = state.randomEventsEnabled ? "✅ enabled" : "🔇 disabled";
  return interaction.editReply(`Random atmospheric events are now **${status}**.`);
}

// -------------------- Slash command choices (for register.js) --------------------
// Exported so register.js can build the command definition cleanly.
const SUSPECT_CHOICES = Object.keys(characters).map((name) => ({ name, value: name }));
const WEAPON_CHOICES  = weapons.map((w) => ({ name: w, value: w }));
const ROOM_CHOICES    = Object.keys(rooms).map((r) => ({ name: r, value: r }));

// -------------------- Main export --------------------
module.exports = {
  SUSPECT_CHOICES,
  WEAPON_CHOICES,
  ROOM_CHOICES,

  /**
   * Call this inside your interactionCreate handler, after your existing checks:
   *
   *   const handled = await mystery.handleInteraction(interaction, client);
   *   if (handled) return;
   *   // ...rest of your existing commands
   */
  async handleInteraction(interaction, client) {
    if (!interaction.isChatInputCommand()) return false;
    if (interaction.commandName !== "mystery") return false;

    await interaction.deferReply({ ephemeral: false }).catch(() => {});

    const sub = interaction.options.getSubcommand();

    try {
      if (sub === "start")         await handleStart(interaction, client);
      else if (sub === "search")   await handleSearch(interaction);
      else if (sub === "accuse")   await handleAccuse(interaction);
      else if (sub === "hint")     await handleHint(interaction);
      else if (sub === "summary")  await handleSummary(interaction);
      else if (sub === "vote")     await handleVote(interaction);
      else if (sub === "tallyvotes") await handleTallyVotes(interaction);
      else if (sub === "toggleevents") await handleToggleEvents(interaction);
      else await interaction.editReply("❌ Unknown subcommand.");
    } catch (err) {
      console.error("mystery command error:", err?.stack || err);
      await interaction.editReply("❌ Something went wrong with the mystery game.").catch(() => {});
    }

    return true; // signal: we handled this interaction
  },
};
