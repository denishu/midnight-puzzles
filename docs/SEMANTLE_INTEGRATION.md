# Semantle Game

## How It Works
- Daily word selected deterministically from `data/dictionaries/target-words.txt`
- Similarity calculated using GloVe word vectors (`data/dictionaries/semantic-vectors.txt`)
- Top 1000 most similar words get a rank; others show as cold/tepid
- Sessions persisted in SQLite via `GameStateRepository`

## Commands
- `/play` — Start or resume today's puzzle
- `/guess <word>` — Guess a word
- `/hint` — Get a word closer than your best rank
- `/results` — Share spoiler-free results
- `/help` — How to play

## Key Files
- `games/semantle/SemantleGame.ts` — Game logic, puzzle generation
- `games/semantle/SemanticEngine.ts` — Vector loading, similarity, ranking
- `bot/semantle-bot.ts` — Discord bot entry point
- `scripts/semantle/` — Utility scripts
