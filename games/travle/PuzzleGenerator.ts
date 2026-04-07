import { CountryGraph } from './CountryGraph';
import { Logger } from '../../core/utils/Logger';

export interface TravlePuzzle {
  start: string;
  end: string;
  shortestPath: string[];
  shortestPathLength: number;
  maxGuesses: number;
}

/**
 * Generates daily Travle puzzles by picking country pairs
 * with interesting shortest paths.
 */
export class PuzzleGenerator {
  private graph: CountryGraph;
  private logger: Logger;
  private components: string[][] = [];

  constructor(graph: CountryGraph) {
    this.graph = graph;
    this.logger = new Logger('TravlePuzzleGenerator');
  }

  /** Must be called after graph.initialize() */
  initialize(): void {
    this.components = this.findComponents();
    // Only keep components with 3+ countries (need at least 1 intermediate)
    this.components = this.components.filter(c => c.length >= 3);
    const total = this.components.reduce((sum, c) => sum + c.length, 0);
    this.logger.info(`${total} playable countries across ${this.components.length} components`);
  }

  private findComponents(): string[][] {
    const all = this.graph.getAllCountries().filter(c => this.graph.getNeighbors(c).length > 0);
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
        for (const neighbor of this.graph.getNeighbors(node)) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      components.push(component);
    }

    return components.sort((a, b) => b.length - a.length);
  }

  /**
   * Generate a puzzle for a given date.
   * Uses date as seed for deterministic selection.
   * Picks pairs with shortest path between 3-7 steps.
   */
  generateForDate(date: Date): TravlePuzzle {
    const dateStr = date.toISOString().split('T')[0]!;
    const seed = this.hashString(dateStr);
    return this.generateFromSeed(seed);
  }

  generateFromSeed(seed: number): TravlePuzzle {
    const MIN_PATH = 3;
    const MAX_PATH = 11;

    let attempt = 0;
    while (attempt < 500) {
      // Pick a component weighted by size (bigger components more likely)
      const compIdx = this.seededIndex(seed + attempt * 3, this.components.length);
      const component = this.components[compIdx]!;

      const i = this.seededIndex(seed + attempt, component.length);
      const j = this.seededIndex(seed + attempt + 7919, component.length);
      attempt++;

      if (i === j) continue;

      const start = component[i]!;
      const end = component[j]!;
      const path = this.graph.findShortestPath(start, end);

      if (!path) continue;
      const pathLen = path.length - 1;

      if (pathLen >= MIN_PATH && pathLen <= MAX_PATH) {
        const maxGuesses = pathLen + Math.max(3, Math.floor(pathLen * 0.5));

        this.logger.info(`Puzzle for seed ${seed}: ${start} → ${end} (${pathLen} steps, ${maxGuesses} max guesses)`);

        return {
          start, end, shortestPath: path,
          shortestPathLength: pathLen, maxGuesses
        };
      }
    }

    this.logger.warn('Could not find ideal pair, using fallback');
    const path = this.graph.findShortestPath('portugal', 'poland')!;
    return {
      start: 'portugal', end: 'poland', shortestPath: path,
      shortestPathLength: path.length - 1, maxGuesses: path.length - 1 + 3
    };
  }

  private seededIndex(seed: number, length: number): number {
    // Mix the bits more aggressively so consecutive seeds spread apart
    let h = seed;
    h = ((h >>> 16) ^ h) * 0x45d9f3b;
    h = ((h >>> 16) ^ h) * 0x45d9f3b;
    h = (h >>> 16) ^ h;
    return (h >>> 0) % length;
  }

  private hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
    }
    // Extra mixing
    hash = ((hash >>> 16) ^ hash) * 0x45d9f3b;
    hash = ((hash >>> 16) ^ hash) * 0x45d9f3b;
    return ((hash >>> 16) ^ hash) >>> 0;
  }
}
