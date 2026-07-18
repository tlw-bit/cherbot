const { REST, Routes } = require("discord.js");
const config = require("./config.json");

// Define ALL slash commands
const commands = [
  // Astra / Core Commands
  {
    name: "whatsnew",
    description: "Show latest bot updates and changes"
  },
  {
    name: "levels",
    description: "View XP requirements and level rewards"
  },
  {
    name: "profile",
    description: "View XP & level profile for a user",
    options: [
      {
        type: 6,
        name: "user",
        description: "User to view profile for",
        required: false
      }
    ]
  },
  {
    name: "leaderboard",
    description: "View XP leaderboard",
    options: [
      {
        type: 3,
        name: "type",
        description: "Leaderboard type",
        required: false,
        choices: [
          { name: "Weekly", value: "weekly" },
          { name: "All-Time", value: "alltime" }
        ]
      }
    ]
  },

  // Trivia Commands
  {
    name: "trivia",
    description: "Manage trivia games (Staff only)",
    options: [
      {
        type: 3,
        name: "action",
        description: "Action to perform",
        required: true,
        choices: [
          { name: "Add Theme", value: "addtheme" },
          { name: "Add Question", value: "addquestion" },
          { name: "Start", value: "start" },
          { name: "Next Question", value: "next" },
          { name: "End", value: "end" }
        ]
      },
      {
        type: 3,
        name: "theme",
        description: "Theme name",
        required: true
      },
      {
        type: 3,
        name: "question",
        description: "Question text",
        required: false
      },
      {
        type: 3,
        name: "answer",
        description: "Correct answer",
        required: false
      },
      {
        type: 4,
        name: "xp",
        description: "XP reward per correct answer",
        required: false
      }
    ]
  },

  // XP Management
  {
    name: "xp",
    description: "Manage user XP (Staff only)",
    options: [
      {
        type: 3,
        name: "action",
        description: "Action to perform",
        required: true,
        choices: [
          { name: "Add", value: "add" },
          { name: "Remove", value: "remove" },
          { name: "Reset Weekly", value: "resetweekly" }
        ]
      },
      {
        type: 6,
        name: "user",
        description: "Target user",
        required: false
      },
      {
        type: 4,
        name: "amount",
        description: "XP amount",
        required: false
      },
      {
        type: 3,
        name: "reason",
        description: "Reason for change",
        required: false
      }
    ]
  },

  // Scouter Badges
  {
    name: "scouter",
    description: "Manage Scouter Badges (Staff only)",
    options: [
      {
        type: 3,
        name: "action",
        description: "Action to perform",
        required: true,
        choices: [
          { name: "Give", value: "give" },
          { name: "Remove", value: "remove" },
          { name: "Check", value: "check" }
        ]
      },
      {
        type: 6,
        name: "user",
        description: "Target user",
        required: true
      },
      {
        type: 3,
        name: "reason",
        description: "Reason for giving/removing",
        required: false
      }
    ]
  },

  // Raffle Commands
  {
    name: "raffle",
    description: "Manage channel raffles",
    options: [
      {
        type: 3,
        name: "subcommand",
        description: "Action to perform",
        required: true,
        choices: [
          { name: "Start", value: "start" },
          { name: "Claim", value: "claim" },
          { name: "Close", value: "close" },
          { name: "Show Board", value: "board" }
        ]
      },
      {
        type: 4,
        name: "slots",
        description: "Number of slots (1-200)",
        required: false
      },
      {
        type: 3,
        name: "price",
        description: "Price per slot (e.g. 5c / Free)",
        required: false
      },
      {
        type: 3,
        name: "numbers",
        description: "Slot numbers to claim (e.g. 1, 3-5)",
        required: false
      }
    ]
  },

  // Roll Winner
  {
    name: "roll",
    description: "Roll for a raffle winner (Staff only)",
    options: [
      {
        type: 4,
        name: "tickets",
        description: "Free tickets for mini winner",
        required: false
      },
      {
        type: 4,
        name: "minutes",
        description: "Reservation time in minutes",
        required: false
      }
    ]
  }
];

// Deploy to guild (instant updates)
const rest = new REST({ version: "10" }).setToken(config.token);

(async () => {
  try {
    console.log("🔄 Started refreshing application (/) commands...");

    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands }
    );

    console.log(`✅ Successfully deployed ${commands.length} commands!`);
  } catch (error) {
    console.error("❌ Error deploying commands:", error);
  }
})();
