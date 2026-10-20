// Read-only diagnostic: inspect server-scope streak rows to see which have a
// null guild_name / icon_hash (i.e. would render as "A Discord Server").
//
// Usage:
//   node scripts/check-streaks.js [dbPath]
// Examples:
//   node scripts/check-streaks.js                 # defaults to semantle-bot.db
//   node scripts/check-streaks.js travle-bot.db
//   node scripts/check-streaks.js duotrigordle-bot.db
//
// Does not modify the database in any way.

const sqlite3 = require('sqlite3').verbose();

const dbPath = process.argv[2] || 'semantle-bot.db';
const db = new sqlite3.Database(dbPath);

const sql =
  'SELECT scope, server_id, game_type, current_count, max_count, ' +
  'guild_name, icon_hash FROM streaks';

db.all(sql, function (err, rows) {
  if (err) {
    console.error('Query failed:', err.message);
    db.close();
    process.exit(1);
  }

  const servers = rows.filter(function (r) { return r.scope === 'server'; });
  const nullNames = servers.filter(function (r) { return r.guild_name == null || r.guild_name === ''; }).length;
  const nullIcons = servers.filter(function (r) { return r.icon_hash == null || r.icon_hash === ''; }).length;

  console.log('db:', dbPath);
  console.log(
    'server rows:', servers.length,
    '| null/empty guild_name:', nullNames,
    '| null/empty icon_hash:', nullIcons
  );
  console.table(servers.map(function (r) {
    return {
      server_id: r.server_id,
      game: r.game_type,
      current: r.current_count,
      max: r.max_count,
      name: r.guild_name == null ? '(null)' : r.guild_name,
      icon: r.icon_hash == null ? '(null)' : r.icon_hash,
    };
  }));

  db.close();
});
