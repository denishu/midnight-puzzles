/**
 * Shared helper for resolving a guild channel the bot can actually post embeds to.
 *
 * Historically each bot grabbed the configured channel straight from the cache
 * without verifying permissions, and only ran a permission check in the fallback
 * branch. When a configured channel existed but the bot lacked
 * View/Send/EmbedLinks there, `.send()` threw `DiscordAPIError[50013] Missing
 * Permissions`. This helper centralises the resolution so the configured channel,
 * the system channel, and the discovered fallback channel are all validated with
 * the same permission check, and returns null (with a warning) when nothing is
 * sendable instead of letting the caller throw.
 */
import { Guild, GuildBasedChannel, PermissionsBitField, TextBasedChannel } from 'discord.js';
import { Logger } from '../../core/utils/Logger';

/**
 * A guild channel that is text-based and can be sent to.
 * Narrowed from GuildBasedChannel so callers get `.send()`.
 */
export type SendableChannel = GuildBasedChannel & TextBasedChannel & { send: (...args: any[]) => Promise<any> };

/** Permissions required to post an embed into a channel. */
const REQUIRED_PERMISSIONS = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.EmbedLinks,
] as const;

/**
 * Returns true if the bot can view, send, and embed in the given channel.
 */
export function canSendEmbed(guild: Guild, channel: GuildBasedChannel | null | undefined): channel is SendableChannel {
  if (!channel) return false;
  if (!channel.isTextBased()) return false;
  if (!('send' in channel) || typeof (channel as any).send !== 'function') return false;

  const me = guild.members.me;
  if (!me) return false;

  const perms = channel.permissionsFor(me);
  if (!perms) return false;
  return perms.has(REQUIRED_PERMISSIONS as unknown as bigint[]);
}

/**
 * Resolve a channel the bot can post embeds to, in priority order:
 *   1. The configured channel (if the bot has permission there).
 *   2. The guild system channel (if sendable).
 *   3. The first discoverable text channel the bot can send to.
 *
 * Returns null (and logs a warning) when no sendable channel exists. Callers
 * should treat null as "skip this guild" rather than throwing.
 *
 * @param guild              The guild to resolve a channel in.
 * @param configuredChannelId The channel id stored in server config, or null.
 * @param logger             Logger for diagnostics about why a channel was skipped.
 */
export function resolveSendableChannel(
  guild: Guild,
  configuredChannelId: string | null | undefined,
  logger?: Logger,
): SendableChannel | null {
  // 1. Configured channel — validate permissions before trusting it.
  if (configuredChannelId) {
    const configured = guild.channels.cache.get(configuredChannelId) ?? null;
    if (canSendEmbed(guild, configured)) {
      return configured;
    }
    logger?.warn(
      `Configured channel ${configuredChannelId} in guild ${guild.id} is not sendable ` +
        `(missing View/Send/EmbedLinks or not a text channel) — falling back`,
    );
  }

  // 2. System channel, if the bot can post there.
  if (canSendEmbed(guild, guild.systemChannel)) {
    return guild.systemChannel;
  }

  // 3. First discoverable text channel the bot can send to.
  const discovered = guild.channels.cache.find((ch) => canSendEmbed(guild, ch)) as SendableChannel | undefined;
  if (discovered) {
    return discovered;
  }

  logger?.warn(`No sendable channel found for guild ${guild.id} — skipping post`);
  return null;
}
