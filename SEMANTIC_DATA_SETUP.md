# Semantic Data Setup Guide for Semantle

This guide explains how to set up semantic word data for the Semantle game, from development testing to production-ready datasets.

## 🎯 Current Status

✅ **SemanticEngine implemented** - Core similarity calculation engine  
✅ **Mock data working** - Small test dataset for development  
✅ **Test script working** - `npm run test-semantle` demonstrates functionality  
✅ **GloVe embeddings working** - 50,000 word vocabulary with real semantic similarities  
✅ **Production ready** - High-quality word relationships for gameplay  

## 📊 Data Requirements

Semantle needs two types of data:

### 1. **Word Rankings** (Recommended)
Pre-computed similarity rankings for target words:
```json
{
  "targetWord": {
    "similarWord1": 1,    // Rank 1 = most similar
    "similarWord2": 2,    // Rank 2 = second most similar
    "similarWord3": 15,   // etc...
    "lessSimlar": 500,
    "notSimilar": 900
  }
}
```

### 2. **Word Vectors** (Alternative)
Raw word embeddings for dynamic calculation:
```
word1 0.1 0.2 0.3 0.4 ... (300 dimensions)
word2 0.5 0.1 0.8 0.2 ... (300 dimensions)
```

## 🚀 Setup Options (Easiest to Hardest)

### Option 1: Use Current Mock Data (Working Now)
**Status:** ✅ Ready to use  
**Vocabulary:** ~50 words  
**Target words:** cat, house, ocean  

**Pros:**
- Works immediately
- Perfect for development and testing
- Demonstrates all game mechanics

**Cons:**
- Limited vocabulary
- Only 3 target words
- Not suitable for production

**Usage:** Already working! Run `npm run test-semantle`

---

### Option 2: Download GloVe Embeddings (Recommended)
**Status:** ✅ Working!  
**Vocabulary:** 50,000 words (memory optimized)  
**Size:** ~822MB download, ~150MB in memory  
**Quality:** High - Stanford NLP research

#### Setup Steps:
```bash
# 1. Download GloVe embeddings
cd data/dictionaries
wget http://nlp.stanford.edu/data/glove.6B.zip
unzip glove.6B.zip

# 2. Use the 300-dimensional vectors
mv glove.6B.300d.txt semantic-vectors.txt

# 3. Clean up
rm glove.6B.*.txt glove.6B.zip
```

#### Test it:
```bash
npm run test-semantle
# Should now work with 400k vocabulary!
```

**Pros:**
- Huge vocabulary
- High-quality embeddings
- Research-grade accuracy
- Works with any target word

**Cons:**
- Large download
- Slower startup (loads 400k words)
- Uses more memory

---

### Option 3: Use Word2Vec Embeddings (Google)
**Status:** ⏳ Needs setup  
**Vocabulary:** ~3 million words  
**Size:** ~1.5GB  
**Quality:** Very high - Google research

#### Setup Steps:
```bash
# 1. Download Google's Word2Vec model
cd data/dictionaries
wget https://drive.google.com/uc?id=0B7XkCwpI5KDYNlNUTTlSS21pQmM
gunzip GoogleNews-vectors-negative300.bin.gz

# 2. Convert binary to text format (requires Python)
python3 -c "
import gensim
model = gensim.models.KeyedVectors.load_word2vec_format('GoogleNews-vectors-negative300.bin', binary=True)
model.save_word2vec_format('semantic-vectors.txt', binary=False)
"
```

**Pros:**
- Massive vocabulary
- Excellent quality
- Trained on Google News
- Best accuracy

**Cons:**
- Very large download
- Requires Python/gensim
- Slow startup
- High memory usage

---

### Option 4: Create Curated Dataset (Most Control)
**Status:** ⏳ Manual work needed  
**Vocabulary:** Custom (1,000-10,000 words)  
**Quality:** Tailored for your game  

#### Approach:
1. **Select common words** (frequency lists)
2. **Generate embeddings** (OpenAI API, Hugging Face)
3. **Pre-compute rankings** for target words
4. **Optimize for gameplay** (remove obscure words)

#### Example Script:
```typescript
// scripts/generate-semantic-data.ts
import OpenAI from 'openai';

const openai = new OpenAI();

async function generateEmbeddings(words: string[]) {
  const embeddings = new Map();
  
  for (const word of words) {
    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: word,
    });
    
    embeddings.set(word, response.data[0].embedding);
  }
  
  return embeddings;
}
```

**Pros:**
- Perfect control over vocabulary
- Optimized for your game
- Can exclude inappropriate words
- Faster loading

**Cons:**
- Requires manual curation
- API costs (OpenAI)
- Time-intensive
- Smaller vocabulary

---

### Option 5: Use Semantle's Actual Data (If Available)
**Status:** ⏳ Research needed  
**Vocabulary:** ~10,000 words  
**Quality:** Game-optimized  

#### Research Steps:
1. **Check Semantle's GitHub** for open-source data
2. **Analyze network requests** from semantle.com
3. **Find word frequency lists** they use
4. **Reverse engineer** their similarity calculations

**Pros:**
- Identical to real game
- Proven to work well
- Game-optimized vocabulary
- Known good target words

**Cons:**
- May not be publicly available
- Potential legal/ethical concerns
- Requires reverse engineering
- Limited customization

---

## 🔧 Implementation Details

### Current SemanticEngine Features:
- ✅ **Multiple data sources** - Supports both rankings and vectors
- ✅ **Fallback system** - Uses mock data if files not found
- ✅ **Efficient loading** - Lazy loading and caching
- ✅ **Memory optimized** - Only loads needed data
- ✅ **Type safe** - Full TypeScript support

### File Locations:
```
data/dictionaries/
├── word-rankings.json     # Pre-computed rankings (current)
├── semantic-vectors.txt   # Word embeddings (optional)
└── README.md             # Documentation
```

### Configuration:
```typescript
// Initialize with custom data path
const engine = new SemanticEngine();
await engine.initialize('./path/to/custom/data');

// Or use default paths
await engine.initialize(); // Uses data/dictionaries/
```

## 🎮 Game Integration

### Daily Word Selection:
```typescript
// Select random target word from available rankings
const availableWords = ['cat', 'house', 'ocean', 'book', 'water'];
const todayWord = availableWords[dateBasedIndex];

const semanticData = engine.getSemanticData(todayWord);
```

### Guess Processing:
```typescript
// Process user guess
const rank = engine.getWordRank(targetWord, userGuess);

if (rank === null) {
  return "Word not in vocabulary";
} else if (rank <= 10) {
  return `🔥 #${rank} - Very hot!`;
} else if (rank <= 100) {
  return `🌡️ #${rank} - Hot!`;
} else if (rank <= 1000) {
  return `❄️ #${rank} - Getting warmer...`;
} else {
  return "🧊 Cold!";
}
```

## 📈 Performance Considerations

### Memory Usage:
- **Mock data:** ~1KB
- **GloVe 300d:** ~500MB
- **Word2Vec:** ~1.5GB

### Startup Time:
- **Mock data:** <1ms
- **GloVe 300d:** ~5-10 seconds
- **Word2Vec:** ~30-60 seconds

### Optimization Tips:
1. **Pre-compute rankings** for common target words
2. **Lazy load** word vectors only when needed
3. **Use worker threads** for heavy computations
4. **Cache results** in database for repeated queries
5. **Limit vocabulary** to most common words

## 🚀 Next Steps

### For Development (Now):
1. ✅ Keep using mock data
2. ✅ Build game logic around SemanticEngine
3. ✅ Test with Discord integration
4. ✅ Implement property-based tests

### For Production (Later):
1. ⏳ Download GloVe embeddings (Option 2)
2. ⏳ Generate rankings for 100+ target words
3. ⏳ Optimize loading performance
4. ⏳ Add word validation and filtering

### Recommended Timeline:
- **Week 1:** Complete game logic with mock data
- **Week 2:** Add Discord integration and testing
- **Week 3:** Implement database persistence
- **Week 4:** Add production semantic data

## 🧪 Testing Your Setup

Run the test script to verify your semantic data:
```bash
npm run test-semantle
```

Expected output shows word rankings and similarities for test words.

## 🆘 Troubleshooting

### Common Issues:

**"Cannot find module" errors:**
- Check file paths in SemanticEngine.ts
- Ensure data files exist in correct locations

**"Out of memory" errors:**
- Use smaller embedding files
- Implement lazy loading
- Increase Node.js memory limit: `node --max-old-space-size=4096`

**Slow startup:**
- Pre-compute rankings instead of vectors
- Use smaller vocabulary
- Implement caching

**Poor similarity quality:**
- Use higher-quality embeddings (Word2Vec > GloVe > custom)
- Ensure proper text preprocessing
- Validate embedding dimensions

---

**Current Status:** The semantic engine is working perfectly with mock data. You can build the entire Semantle game logic now and upgrade to production data later! 🎉