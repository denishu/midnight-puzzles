import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../../core/utils/Logger';

/**
 * Country adjacency graph with BFS pathfinding.
 * Core data structure for Travle game logic.
 */
export class CountryGraph {
  private adjacency: Map<string, string[]> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = new Logger('CountryGraph');
  }

  /** Load adjacency data from JSON file */
  async initialize(dataPath?: string): Promise<void> {
    const filePath = dataPath || path.join(__dirname, '../../data/geography/country-adjacency.json');
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    for (const [country, neighbors] of Object.entries(raw)) {
      this.adjacency.set(country.toLowerCase(), (neighbors as string[]).map(n => n.toLowerCase()));
    }

    this.logger.info(`Loaded ${this.adjacency.size} countries`);
  }

  /** Check if a country exists in the graph */
  isValidCountry(name: string): boolean {
    return this.adjacency.has(name.toLowerCase());
  }

  /** Get neighbors of a country */
  getNeighbors(name: string): string[] {
    return this.adjacency.get(name.toLowerCase()) || [];
  }

  /** Check if two countries share a border */
  areNeighbors(a: string, b: string): boolean {
    const neighbors = this.adjacency.get(a.toLowerCase());
    return neighbors ? neighbors.includes(b.toLowerCase()) : false;
  }

  /** Get all country names */
  getAllCountries(): string[] {
    return Array.from(this.adjacency.keys());
  }

  /**
   * Find shortest path between two countries using BFS.
   * Returns the path as an array of country names, or null if no path exists.
   */
  findShortestPath(start: string, end: string): string[] | null {
    const s = start.toLowerCase();
    const e = end.toLowerCase();

    if (!this.adjacency.has(s) || !this.adjacency.has(e)) return null;
    if (s === e) return [s];

    const visited = new Set<string>([s]);
    const queue: Array<{ node: string; path: string[] }> = [{ node: s, path: [s] }];

    while (queue.length > 0) {
      const { node, path: currentPath } = queue.shift()!;

      for (const neighbor of this.getNeighbors(node)) {
        if (neighbor === e) {
          return [...currentPath, e];
        }
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push({ node: neighbor, path: [...currentPath, neighbor] });
        }
      }
    }

    return null; // No path exists (disconnected countries like islands)
  }

  /**
   * Get the shortest path length between two countries.
   * Returns the number of steps (edges), or -1 if unreachable.
   */
  shortestPathLength(start: string, end: string): number {
    const path = this.findShortestPath(start, end);
    return path ? path.length - 1 : -1;
  }

  /**
   * Check if a sequence of countries forms a valid connected path.
   * Each consecutive pair must be neighbors.
   */
  isValidPath(countries: string[]): boolean {
    for (let i = 0; i < countries.length - 1; i++) {
      if (!this.areNeighbors(countries[i]!, countries[i + 1]!)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Given a set of guessed countries plus start/end, find the best
   * connected chain from start to end using only those countries.
   * Returns the chain if one exists, null otherwise.
   */
  findChainFromGuesses(start: string, end: string, guesses: string[]): string[] | null {
    const s = start.toLowerCase();
    const e = end.toLowerCase();
    const available = new Set([s, ...guesses.map(g => g.toLowerCase()), e]);

    const visited = new Set<string>([s]);
    const queue: Array<{ node: string; path: string[] }> = [{ node: s, path: [s] }];

    while (queue.length > 0) {
      const { node, path: currentPath } = queue.shift()!;

      for (const neighbor of this.getNeighbors(node)) {
        if (!available.has(neighbor) || visited.has(neighbor)) continue;

        if (neighbor === e) {
          return [...currentPath, e];
        }

        visited.add(neighbor);
        queue.push({ node: neighbor, path: [...currentPath, neighbor] });
      }
    }

    return null;
  }

  /**
   * Compute the minimum "cost" path from start to end, where
   * countries in freeSet cost 0 to traverse and all others cost 1.
   * Uses 0-1 BFS (deque-based). Returns the cost, or -1 if unreachable.
   */
  weightedShortestCost(start: string, end: string, freeSet: Set<string>): number {
    const s = start.toLowerCase();
    const e = end.toLowerCase();

    if (!this.adjacency.has(s) || !this.adjacency.has(e)) return -1;
    if (s === e) return 0;

    const dist = new Map<string, number>();
    dist.set(s, 0);

    // 0-1 BFS: free nodes go to front, cost-1 nodes go to back
    const deque: string[] = [s];

    while (deque.length > 0) {
      const node = deque.shift()!;
      const nodeDist = dist.get(node)!;

      if (node === e) return nodeDist;

      for (const neighbor of this.getNeighbors(node)) {
        const isFree = freeSet.has(neighbor) || neighbor === s || neighbor === e;
        const newDist = nodeDist + (isFree ? 0 : 1);

        if (!dist.has(neighbor) || newDist < dist.get(neighbor)!) {
          dist.set(neighbor, newDist);
          if (isFree) {
            deque.unshift(neighbor); // cost 0 → front
          } else {
            deque.push(neighbor);    // cost 1 → back
          }
        }
      }
    }

    return -1;
  }

  /**
   * Compute the minimum cost of a path from start to end that MUST pass through
   * a specific country. The forced country and all countries in freeSet cost 0.
   */
  weightedCostThrough(start: string, end: string, through: string, freeSet: Set<string>): number {
    const augmented = new Set([...freeSet, through.toLowerCase()]);
    const costTo = this.weightedShortestCost(start, through, augmented);
    const costFrom = this.weightedShortestCost(through, end, augmented);
    if (costTo === -1 || costFrom === -1) return -1;
    return costTo + costFrom;
  }
}
