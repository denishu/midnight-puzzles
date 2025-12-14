import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Logger } from '../../core/utils/Logger';

export interface CommandOption {
  name: string;
  description: string;
  type: 'STRING' | 'INTEGER' | 'BOOLEAN' | 'USER' | 'CHANNEL' | 'ROLE';
  required?: boolean;
  choices?: { name: string; value: string | number }[];
}

export interface CommandDefinition {
  name: string;
  description: string;
  options?: CommandOption[];
  handler: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export class BaseCommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public register(command: CommandDefinition): void {
    this.commands.set(command.name, command);
    this.logger.debug(`Registered command: ${command.name}`);
  }

  public async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName);
    
    if (!command) {
      this.logger.warn(`Unknown command: ${interaction.commandName}`);
      await interaction.reply({
        content: 'Unknown command!',
        ephemeral: true
      });
      return;
    }

    try {
      await command.handler(interaction);
    } catch (error) {
      this.logger.error(`Error handling command ${interaction.commandName}:`, error);
      
      const errorMessage = 'There was an error executing this command!';
      
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: errorMessage,
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: errorMessage,
          ephemeral: true
        });
      }
    }
  }

  public getCommandsForDeployment(): any[] {
    return Array.from(this.commands.values()).map(command => {
      const builder = new SlashCommandBuilder()
        .setName(command.name)
        .setDescription(command.description);

      if (command.options) {
        for (const option of command.options) {
          switch (option.type) {
            case 'STRING':
              builder.addStringOption(opt => {
                opt.setName(option.name)
                   .setDescription(option.description)
                   .setRequired(option.required ?? false);
                
                if (option.choices) {
                  opt.addChoices(...option.choices.map(choice => ({
                    name: choice.name,
                    value: choice.value as string
                  })));
                }
                
                return opt;
              });
              break;
            case 'INTEGER':
              builder.addIntegerOption(opt =>
                opt.setName(option.name)
                   .setDescription(option.description)
                   .setRequired(option.required ?? false)
              );
              break;
            case 'BOOLEAN':
              builder.addBooleanOption(opt =>
                opt.setName(option.name)
                   .setDescription(option.description)
                   .setRequired(option.required ?? false)
              );
              break;
            // Add other option types as needed
          }
        }
      }

      return builder.toJSON();
    });
  }

  public getCommands(): Map<string, CommandDefinition> {
    return new Map(this.commands);
  }
}