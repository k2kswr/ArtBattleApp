import { describe, expect, it } from "vitest";
import { rankArtworks } from "./game";

describe("rankArtworks", () => {
  it("同点を同順位にして順位ポイントを付与する", () => {
    const ranked = rankArtworks([{ playerId: "a", image: "", votes: 3 }, { playerId: "b", image: "", votes: 3 }, { playerId: "c", image: "", votes: 1 }], a => a.votes ?? 0);
    expect(ranked.map(a => [a.rank, a.points])).toEqual([[1, 5], [1, 5], [3, 1]]);
  });
});
