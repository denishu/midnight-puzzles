import { config } from 'dotenv';
import { REST, Routes } from 'discord.js';
import { Logger } from '../../core/utils/Logger';

config();

const logger = new Logger('Deploy');

const commands = [
  { name: 'play', description: "Start today's Travle puzzle - connect two countries!" },
  {
    name: 'guess', description: 'Guess a country in your Travle game',
    options: [{ name: 'country', description: 'Country name', type: 3, required: true }]
  },
  { name: 'results', description: 'Share your Travle results' },
  { name: 'help', description: 'Learn how to play Travle' },
  { name: 'reset', description: 'Reset your current Travle game (for testing)' }
];

async function deploy() {
  const token = process.env.TRAVLE_BOT_TOKEN;
  const clientId = process.env.TRAVLE_CLIENT_ID;
  if (!token || !clientId) {
    logger.error('TRAVLE_BOT_TOKEN and TRAVLE_CLIENT_ID must be set in .env');
    process.exit(1);
  }
  const rest = new REST({ version: '10' }).setToken(token);
  logger.info(`Deploying ${commands.length} commands...`);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  logger.info('Commands deployed!');
}

deploy().catch(e => { logger.error('Deploy failed:', e); process.exit(1); });
