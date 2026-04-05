const data = require('../../data/geography/country-adjacency.json');

const islands = Object.entries(data).filter(([_, v]: [string, any]) => (v as string[]).length === 0);
console.log('Island nations (no land borders):', islands.map(([k]) => k));
console.log('Total countries:', Object.keys(data).length);

// Check symmetry: if A lists B, B should list A
let asymmetric = 0;
for (const [country, neighbors] of Object.entries(data)) {
  for (const neighbor of neighbors as string[]) {
    const reverse = data[neighbor];
    if (!reverse) {
      console.log(`ERROR: ${country} lists ${neighbor} but ${neighbor} doesn't exist`);
    } else if (!reverse.includes(country)) {
      console.log(`ASYMMETRIC: ${country} → ${neighbor} but not ${neighbor} → ${country}`);
      asymmetric++;
    }
  }
}
console.log(`Asymmetric links: ${asymmetric}`);
