import { InteractionHandler, CommandHandler, ButtonHandler } from '@core/discord/InteractionHandler';

describe('InteractionHandler', () => {
  let handler: InteractionHandler;
  let mockCommandHandler: CommandHandler;
  let mockButtonHandler: ButtonHandler;

  beforeEach(() => {
    handler = new InteractionHandler();
    mockCommandHandler = {
      execute: jest.fn()
    };
    mockButtonHandler = {
      execute: jest.fn()
    };
  });

  describe('registerCommandHandler', () => {
    it('should register a command handler', () => {
      handler.registerCommandHandler('test-command', mockCommandHandler);
      
      const registeredCommands = handler.getRegisteredCommands();
      expect(registeredCommands).toContain('test-command');
    });
  });

  describe('registerButtonHandler', () => {
    it('should register a button handler', () => {
      handler.registerButtonHandler('test-button', mockButtonHandler);
      
      const registeredButtons = handler.getRegisteredButtons();
      expect(registeredButtons).toContain('test-button');
    });
  });

  describe('registerSelectMenuHandler', () => {
    it('should register a select menu handler', () => {
      const mockSelectHandler = { execute: jest.fn() };
      handler.registerSelectMenuHandler('test-select', mockSelectHandler);
      
      // We can't easily test the internal map, but we can verify no errors occur
      expect(() => handler.registerSelectMenuHandler('test-select', mockSelectHandler)).not.toThrow();
    });
  });

  describe('registerModalHandler', () => {
    it('should register a modal handler', () => {
      const mockModalHandler = { execute: jest.fn() };
      handler.registerModalHandler('test-modal', mockModalHandler);
      
      // We can't easily test the internal map, but we can verify no errors occur
      expect(() => handler.registerModalHandler('test-modal', mockModalHandler)).not.toThrow();
    });
  });

  describe('clearHandlers', () => {
    it('should clear all registered handlers', () => {
      handler.registerCommandHandler('test-command', mockCommandHandler);
      handler.registerButtonHandler('test-button', mockButtonHandler);
      
      expect(handler.getRegisteredCommands()).toHaveLength(1);
      expect(handler.getRegisteredButtons()).toHaveLength(1);
      
      handler.clearHandlers();
      
      expect(handler.getRegisteredCommands()).toHaveLength(0);
      expect(handler.getRegisteredButtons()).toHaveLength(0);
    });
  });

  describe('getRegisteredCommands', () => {
    it('should return empty array when no commands registered', () => {
      expect(handler.getRegisteredCommands()).toEqual([]);
    });

    it('should return all registered command names', () => {
      handler.registerCommandHandler('command1', mockCommandHandler);
      handler.registerCommandHandler('command2', mockCommandHandler);
      
      const commands = handler.getRegisteredCommands();
      expect(commands).toHaveLength(2);
      expect(commands).toContain('command1');
      expect(commands).toContain('command2');
    });
  });

  describe('getRegisteredButtons', () => {
    it('should return empty array when no buttons registered', () => {
      expect(handler.getRegisteredButtons()).toEqual([]);
    });

    it('should return all registered button IDs', () => {
      handler.registerButtonHandler('button1', mockButtonHandler);
      handler.registerButtonHandler('button2', mockButtonHandler);
      
      const buttons = handler.getRegisteredButtons();
      expect(buttons).toHaveLength(2);
      expect(buttons).toContain('button1');
      expect(buttons).toContain('button2');
    });
  });
});