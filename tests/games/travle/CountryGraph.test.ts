import { CountryGraph } from '../../../games/travle/CountryGraph';

let graph: CountryGraph;

beforeAll(async () => {
  graph = new CountryGraph();
  await graph.initialize();
});

describe('CountryGraph', () => {
  describe('basic graph operations', () => {
    it('loads countries from adjacency data', () => {
      const countries = graph.getAllCountries();
      expect(countries.length).toBeGreaterThan(100);
    });

    it('validates known countries', () => {
      expect(graph.isValidCountry('france')).toBe(true);
      expect(graph.isValidCountry('germany')).toBe(true);
      expect(graph.isValidCountry('atlantis')).toBe(false);
    });

    it('returns neighbors for a country', () => {
      const neighbors = graph.getNeighbors('france');
      expect(neighbors).toContain('germany');
      expect(neighbors).toContain('spain');
      expect(neighbors).not.toContain('japan');
    });

    it('checks adjacency correctly', () => {
      expect(graph.areNeighbors('france', 'germany')).toBe(true);
      expect(graph.areNeighbors('france', 'japan')).toBe(false);
    });

    it('spain and morocco are not connected', () => {
      expect(graph.areNeighbors('spain', 'morocco')).toBe(false);
      expect(graph.getNeighbors('spain')).not.toContain('morocco');
      expect(graph.getNeighbors('morocco')).not.toContain('spain');
    });
  });

  describe('alias resolution', () => {
    it('resolves common aliases', () => {
      expect(graph.resolveAlias('usa')).toBe('united states');
      expect(graph.resolveAlias('uk')).toBe('united kingdom');
      expect(graph.resolveAlias('uae')).toBe('united arab emirates');
    });

    it('validates countries via aliases', () => {
      expect(graph.isValidCountry('usa')).toBe(true);
      expect(graph.isValidCountry('uae')).toBe(true);
    });

    it('returns neighbors via aliases', () => {
      const neighbors = graph.getNeighbors('usa');
      expect(neighbors).toContain('canada');
      expect(neighbors).toContain('mexico');
    });
  });

  describe('findShortestPath (BFS)', () => {
    it('finds a path between connected countries', () => {
      const path = graph.findShortestPath('france', 'germany');
      expect(path).not.toBeNull();
      expect(path![0]).toBe('france');
      expect(path![path!.length - 1]).toBe('germany');
    });

    it('returns direct neighbors as 2-element path', () => {
      const path = graph.findShortestPath('france', 'germany');
      expect(path).toEqual(['france', 'germany']);
    });

    it('returns null for disconnected countries (islands)', () => {
      const path = graph.findShortestPath('france', 'japan');
      expect(path).toBeNull();
    });

    it('returns single element for same start and end', () => {
      const path = graph.findShortestPath('france', 'france');
      expect(path).toEqual(['france']);
    });

    it('finds the Ghana → UAE path through the Middle East', () => {
      const path = graph.findShortestPath('ghana', 'united arab emirates');
      expect(path).not.toBeNull();
      // Must go through Egypt → Israel bridge (only Africa→Asia route)
      expect(path).toContain('egypt');
      expect(path).toContain('israel');
    });

    it('each consecutive pair in the path are neighbors', () => {
      const path = graph.findShortestPath('ghana', 'united arab emirates')!;
      for (let i = 0; i < path.length - 1; i++) {
        expect(graph.areNeighbors(path[i]!, path[i + 1]!)).toBe(true);
      }
    });
  });

  describe('weightedShortestCost (0-1 BFS)', () => {
    it('returns path length when no countries are free', () => {
      const pathLen = graph.shortestPathLength('ghana', 'united arab emirates');
      const cost = graph.weightedShortestCost('ghana', 'united arab emirates', new Set());
      // Cost should equal the number of intermediate countries (path length - 1 for start, but start/end are free)
      // Actually cost = number of non-free intermediate nodes
      expect(cost).toBe(pathLen - 1);
    });

    it('returns 0 when all intermediate countries are free', () => {
      const path = graph.findShortestPath('ghana', 'united arab emirates')!;
      // Make all intermediate countries free
      const freeSet = new Set(path.slice(1, -1));
      const cost = graph.weightedShortestCost('ghana', 'united arab emirates', freeSet);
      expect(cost).toBe(0);
    });

    it('reduces cost when a country on the path is guessed', () => {
      const costBefore = graph.weightedShortestCost('ghana', 'united arab emirates', new Set());
      const costAfter = graph.weightedShortestCost('ghana', 'united arab emirates', new Set(['egypt']));
      expect(costAfter).toBeLessThan(costBefore);
    });

    it('returns -1 for unreachable countries', () => {
      const cost = graph.weightedShortestCost('france', 'japan', new Set());
      expect(cost).toBe(-1);
    });

    it('returns 0 for same start and end', () => {
      const cost = graph.weightedShortestCost('france', 'france', new Set());
      expect(cost).toBe(0);
    });
  });

  describe('weightedCostThrough', () => {
    it('computes cost of path forced through a specific country', () => {
      const cost = graph.weightedCostThrough(
        'ghana', 'united arab emirates', 'egypt',
        new Set(['egypt'])
      );
      expect(cost).toBeGreaterThanOrEqual(0);
    });

    it('returns -1 when forced country is unreachable', () => {
      const cost = graph.weightedCostThrough('france', 'germany', 'japan', new Set());
      expect(cost).toBe(-1);
    });
  });

  describe('findChainFromGuesses', () => {
    it('finds a chain when guesses complete the path', () => {
      const path = graph.findShortestPath('france', 'poland')!;
      const intermediates = path.slice(1, -1);
      const chain = graph.findChainFromGuesses('france', 'poland', intermediates);
      expect(chain).not.toBeNull();
      expect(chain![0]).toBe('france');
      expect(chain![chain!.length - 1]).toBe('poland');
    });

    it('returns null when guesses do not complete a path', () => {
      const chain = graph.findChainFromGuesses('ghana', 'united arab emirates', ['brazil']);
      expect(chain).toBeNull();
    });
  });
});
