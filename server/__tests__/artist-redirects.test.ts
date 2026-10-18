import { describe, it, expect } from "vitest";
import { ARTIST_DUPLICATE_REDIRECTS, artistRedirectTarget } from "../lib/artist-redirects";

describe("artistRedirectTarget", () => {
  it("вещает служебные слаг-клоны на публичные адреса", () => {
    expect(artistRedirectTarget("artist-1772386526792")).toBe("/@molodostvnutri");
    expect(artistRedirectTarget("artist-1772387909100")).toBe("/tula-designers");
  });

  it("не трогает живые публичные слаги", () => {
    for (const slug of ["molodostvnutri", "vashana", "mark-i-monti", "lyudmil-ogurchenko", "dragni"]) {
      expect(artistRedirectTarget(slug)).toBeNull();
    }
  });

  it("все цели — абсолютные пути, а не внешние ссылки", () => {
    for (const [from, to] of Object.entries(ARTIST_DUPLICATE_REDIRECTS)) {
      expect(to.startsWith("/")).toBe(true);
      expect(to).not.toContain("//");
      expect(to).not.toBe(`/@${from}`);
    }
  });
});
