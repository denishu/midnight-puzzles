import { CountryGraph } from '../../games/travle/CountryGraph';

async function main() {
  const g = new CountryGraph();
  await g.initialize();

  const all = g.getAllCountries().filter(c => g.getNeighbors(c).length > 0);
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const country of all) {
    if (visited.has(country)) continue;
    const component: string[] = [];
    const queue = [country];
    visited.add(country);
    while (queue.length > 0) {
      const node = queue.shift()!;
      component.push(node);
      for (const neighbor of g.getNeighbors(node)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }

  components.sort((a, b) => b.length - a.length);
  for (const comp of components) {
    console.log(`\nComponent (${comp.length} countries):`);
    console.log(comp.sort().join(', '));
  }
}

main().catch(console.error);
