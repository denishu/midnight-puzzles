import { config } from 'dotenv';
import { REST, Routes } from 'discord.js';
import { Logger } from '../../core/utils/Logger';

config();

const logger = new Logger('Deploy');

const commands = [
  {
    name: 'play',
    description: "Start today's Semantle puzzle - guess the word using semantic similarity!"
  },
  {
    name: 'guess',
    description: 'Make a guess in your current Semantle game',
    options: [{
      name: 'word',
      description: 'The word you want to guess',
      type: 3, // STRING
      required: true
    }]
  },
  {
    name: 'results',
    description: 'Share your Semantle results'
  },
  {
    name: 'help',
    description: 'Learn how to play Semantle'
  },
  {
    name: 'hint',
    description: 'Get a hint for your current Semantle game'
  },
  {
    name: 'reset',
    description: 'Reset your current Semantle game (for testing)'
  }
];

async function deploy() {
  const token = process.env.SEMANTLE_BOT_TOKEN;
  const clientId = process.env.SEMANTLE_CLIENT_ID;

  if (!token || !clientId) {
    logger.error('SEMANTLE_BOT_TOKEN and SEMANTLE_CLIENT_ID must be set in .env');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(token);

  logger.info(`Deploying ${commands.length} commands...`);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  logger.info('Commands deployed successfully!');
}

deploy().catch(e => {
  logger.error('Deploy failed:', e);
  process.exit(1);
});
