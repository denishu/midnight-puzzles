// Discord Activity entry point
// Initializes the Embedded App SDK, authenticates, then loads the game

let discordSdk = null;
let auth = null;

async function setupDiscord() {
  // Only initialize SDK if running inside Discord (iframe)
  if (window.self === window.top) {
    console.log('Not in Discord iframe, skipping SDK init');
    return null;
  }

  try {
    const { DiscordSDK } = await import('@discord/embedded-app-sdk');
    const clientId = document.querySelector('meta[name="discord-client-id"]')?.content;
    if (!clientId) {
      console.warn('No discord-client-id meta tag found');
      return null;
    }

    discordSdk = new DiscordSDK(clientId);
    await discordSdk.ready();
    console.log('Discord SDK ready');

    // Authorize
    const { code } = await discordSdk.commands.authorize({
      client_id: clientId,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify'],
    });

    // Exchange code for token via our server
    const resp = await fetch('/game/discord/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const { access_token } = await resp.json();

    // Authenticate with Discord
    auth = await discordSdk.commands.authenticate({ access_token });
    console.log('Discord authenticated:', auth.user.username);

    return auth;
  } catch (e) {
    console.warn('Discord SDK init failed (may not be in Activity):', e.message);
    return null;
  }
}

// Initialize: try Discord SDK, then load game regardless
setupDiscord().then((discordAuth) => {
  if (discordAuth) {
    // Use Discord user ID as session ID
    window.TRAVLE_SESSION_ID = discordAuth.user.id;
  }
  // Load the game script
  const script = document.createElement('script');
  script.src = './app-game.js';
  document.body.appendChild(script);
});
