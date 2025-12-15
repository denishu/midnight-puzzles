# Setup script for Semantle semantic data (Windows PowerShell)
# Downloads and configures GloVe 6B 300d embeddings

Write-Host "Setting up Semantle semantic data..." -ForegroundColor Cyan

# Create data directory if it doesn't exist
if (!(Test-Path "data/dictionaries")) {
    New-Item -ItemType Directory -Path "data/dictionaries" -Force | Out-Null
}

Set-Location "data/dictionaries"

# Check if we already have the data
if (Test-Path "semantic-vectors.txt") {
    Write-Host "Semantic vectors already exist!" -ForegroundColor Green
    Write-Host "Checking vocabulary size..." -ForegroundColor Yellow
    $lineCount = (Get-Content "semantic-vectors.txt" | Measure-Object -Line).Lines
    Write-Host "Found $lineCount words" -ForegroundColor Green
    Set-Location "../.."
    exit 0
}

# Check if zip file exists
if (!(Test-Path "glove.6B.zip")) {
    Write-Host "glove.6B.zip not found!" -ForegroundColor Red
    Write-Host "Please download it first with:" -ForegroundColor Yellow
    Write-Host "   wget http://nlp.stanford.edu/data/glove.6B.zip" -ForegroundColor White
    Write-Host "   or download manually from: http://nlp.stanford.edu/data/glove.6B.zip" -ForegroundColor White
    Set-Location "../.."
    exit 1
}

Write-Host "Extracting embeddings..." -ForegroundColor Yellow
try {
    Expand-Archive -Path "glove.6B.zip" -DestinationPath "." -Force
    Write-Host "Extraction complete!" -ForegroundColor Green
} catch {
    Write-Host "Failed to extract zip file: $_" -ForegroundColor Red
    Set-Location "../.."
    exit 1
}

Write-Host "Using 300-dimensional vectors (best balance of quality/size)..." -ForegroundColor Yellow
if (Test-Path "glove.6B.300d.txt") {
    Move-Item "glove.6B.300d.txt" "semantic-vectors.txt"
    Write-Host "Moved 300d vectors to semantic-vectors.txt" -ForegroundColor Green
} else {
    Write-Host "glove.6B.300d.txt not found in extracted files!" -ForegroundColor Red
    Set-Location "../.."
    exit 1
}

Write-Host "Cleaning up temporary files..." -ForegroundColor Yellow
$filesToRemove = @("glove.6B.50d.txt", "glove.6B.100d.txt", "glove.6B.200d.txt", "glove.6B.zip")
foreach ($file in $filesToRemove) {
    if (Test-Path $file) {
        Remove-Item $file -Force
        Write-Host "  Removed $file" -ForegroundColor Gray
    }
}

Write-Host "Checking vocabulary size..." -ForegroundColor Yellow
$vocabSize = (Get-Content "semantic-vectors.txt" | Measure-Object -Line).Lines
Write-Host "Loaded $vocabSize words with 300-dimensional vectors" -ForegroundColor Green

Set-Location "../.."

Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Test it with: npm run test-semantle" -ForegroundColor Cyan
Write-Host "Now you have realistic semantic similarities!" -ForegroundColor Cyan
Write-Host ""
Write-Host "Expected improvements:" -ForegroundColor Yellow
Write-Host "  - Much larger vocabulary (400,000 words)" -ForegroundColor White
Write-Host "  - Realistic word relationships" -ForegroundColor White
Write-Host "  - Better gameplay experience" -ForegroundColor White