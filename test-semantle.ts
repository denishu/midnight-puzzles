import { SemanticEngine } from './games/semantle/SemanticEngine';

async function testSemanticEngine() {
  console.log('🧠 Testing Semantic Engine...\n');
  
  const engine = new SemanticEngine();
  await engine.initialize();
  
  // Test with 'cat' as target word
  console.log('🐱 Testing with target word: "cat"');
  const catData = engine.getSemanticData('cat');
  
  console.log(`Target: ${catData.targetWord}`);
  console.log(`Vocabulary size: ${engine.isValidWord('cat') ? 'Valid' : 'Invalid'}`);
  
  // Test some guesses
  const testWords = ['kitten', 'tiger', 'lion', 'dog', 'house', 'water', 'feline', 'animal'];
  
  console.log('\n📊 Word Rankings:');
  testWords.forEach(word => {
    const rank = engine.getWordRank('cat', word);
    const similarity = catData.similarities.get(word) || 0;
    
    if (rank && rank <= 1000) {
      console.log(`  "${word}" -> Rank #${rank} (similarity: ${similarity.toFixed(3)})`);
    } else {
      console.log(`  "${word}" -> Not in top 1000 (cold)`);
    }
  });
  
  // Test with 'house' as target word
  console.log('\n🏠 Testing with target word: "house"');
  const houseData = engine.getSemanticData('house');
  
  const houseTestWords = ['home', 'building', 'car', 'cat', 'dwelling', 'blood', 'glossary'];
  console.log('\n📊 Word Rankings:');
  houseTestWords.forEach(word => {
    const rank = engine.getWordRank('house', word);
    const similarity = houseData.similarities.get(word) || 0;
    
    if (rank && rank <= 1000) {
      console.log(`  "${word}" -> Rank #${rank} (similarity: ${similarity.toFixed(3)})`);
    } else {
      console.log(`  "${word}" -> Not in top 1000 (cold)`);
    }
  });
  
  console.log('\n✅ Semantic engine test complete!');
  console.log('\n💡 This demonstrates how Semantle will work:');
  console.log('   - Words with low ranks (1-100) are "hot" 🔥');
  console.log('   - Words with high ranks (500+) are "warm" 🌡️');
  console.log('   - Words not in top 1000 are "cold" 🧊');
}

// Run the test
if (require.main === module) {
  testSemanticEngine().catch(console.error);
}

export default testSemanticEngine;