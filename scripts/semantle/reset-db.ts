import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('semantle-bot.db');

db.serialize(() => {
  db.run('DELETE FROM game_sessions', (e) => { if (e) console.error('game_sessions:', e); else console.log('Cleared game_sessions'); });
  db.run('DELETE FROM daily_puzzles', (e) => { if (e) console.error('daily_puzzles:', e); else console.log('Cleared daily_puzzles'); });
  db.run('DELETE FROM users', (e) => { if (e) console.error('users:', e); else console.log('Cleared users'); });
});

db.close();
