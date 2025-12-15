#!/bin/bash

# Setup script for Semantle semantic data
# Downloads and configures GloVe 6B 300d embeddings

set -e  # Exit on any error

echo "🧠 Setting up Semantle semantic data..."

# Create data directory if it doesn't exist
mkdir -p data/dictionaries
cd data/dictionaries

# Check if we already have the data
if [ -f "semantic-vectors.txt" ]; then
    echo "✅ Semantic vectors already exist!"
    echo "📊 Checking vocabulary size..."
    wc -l semantic-vectors.txt
    exit 0
fi

echo "📥 Downloading GloVe 6B embeddings (822MB)..."
echo "⏳ This may take a few minutes depending on your connection..."

# Download GloVe embeddings
if ! wget -q --show-progress http://nlp.stanford.edu/data/glove.6B.zip; then
    echo "❌ Failed to download GloVe embeddings"
    echo "💡 Try downloading manually from: http://nlp.stanford.edu/data/glove.6B.zip"
    exit 1
fi

echo "📦 Extracting embeddings..."
unzip -q glove.6B.zip

echo "🎯 Using 300-dimensional vectors (best balance of quality/size)..."
mv glove.6B.300d.txt semantic-vectors.txt

echo "🧹 Cleaning up temporary files..."
rm glove.6B.50d.txt glove.6B.100d.txt glove.6B.200d.txt glove.6B.zip

echo "📊 Checking vocabulary size..."
VOCAB_SIZE=$(wc -l < semantic-vectors.txt)
echo "✅ Loaded $VOCAB_SIZE words with 300-dimensional vectors"

echo "🎉 Setup complete!"
echo ""
echo "🧪 Test it with: npm run test-semantle"
echo "🎮 Now you have realistic semantic similarities!"
echo ""
echo "📈 Expected improvements:"
echo "  - Much larger vocabulary (400,000 words)"
echo "  - Realistic word relationships"
echo "  - Better gameplay experience"