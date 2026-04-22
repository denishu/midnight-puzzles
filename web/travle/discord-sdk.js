// Discord Embedded App SDK — handles the auth handshake
// SYN:     authorize() → get code
// SYN-ACK: code → server → Discord → access token
// ACK:     authenticate(token) → user identity

import { DiscordSDK } from '@discord/embedded-app-sdk';

const CLIENT_ID = document.querySelector('meta[name="discord-client-id"]')?.content;

let discordSdk = null;
let currentUser = null;
let channelId = null;
let guildId = null;

/**
 * Initialize the Discord SDK and authenticate the user.
 * Returns { user, channelId } on success, or null if not running inside Discord.
 */
export async function initDiscord() {
  // Only run inside a Discord Activity iframe
  if (!CLIENT_ID || !window.parent || window.parent === window) {
    console.log('Not running inside Discord Activity, skipping SDK init');
    return null;
  }

  try {
    discordSdk = new DiscordSDK(CLIENT_ID);

    // Tell Discord the iframe is ready
    await discordSdk.ready();
    console.log('Discord SDK ready');

    // SYN — request authorization code
    const { code } = await discordSdk.commands.authorize({
      client_id: CLIENT_ID,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify'],
    });
    console.log('Got authorization code');

    // SYN-ACK — exchange code for access token via our backend
    const tokenResp = await fetch('/game/discord/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const { access_token } = await tokenResp.json();
    if (!access_token) throw new Error('Token exchange failed');
    console.log('Got access token');

    // ACK — authenticate with Discord, get user identity
    const auth = await discordSdk.commands.authenticate({ access_token });
    currentUser = auth.user;
    console.log('Authenticated as', currentUser.username, '(' + currentUser.id + ')');

    // Grab the channel and guild the Activity was launched in
    channelId = discordSdk.channelId;
    guildId = discordSdk.guildId;

    return { user: currentUser, channelId, guildId };
  } catch (err) {
    console.error('Discord SDK init failed:', err);
    return null;
  }
}

/** Get the authenticated Discord user, or null if not in an Activity */
export function getDiscordUser() {
  return currentUser;
}

/** Get the channel ID the Activity was launched from */
export function getDiscordChannelId() {
  return channelId;
}

/** Get the guild ID the Activity was launched from */
export function getDiscordGuildId() {
  return guildId;
}

/** Get the raw SDK instance for advanced usage */
export function getDiscordSdk() {
  return discordSdk;
}
