import { describe, expect, it } from "vitest";
import english from "../../messages/en.json";
import french from "../../messages/fr.json";
import { withEnglishFallback } from "./messageFallback";

describe("untranslated UI messages", () => {
  it("keeps the SEO menu and connection form visible in French", () => {
    const messages = withEnglishFallback(english, french);
    expect(messages["zIaww+"]).toBe("SEO Audit");
    expect(messages.gmQdaD).toBe("Connect your OpenSEO account");
    expect(messages.AQ3P5X).toBe("OpenSEO project");
  });

  it("preserves real translations and falls back for blank or missing entries", () => {
    expect(
      withEnglishFallback({ menu: "Main", seo: "SEO Audit", status: "Status" }, { menu: "Principal", seo: "  " })
    ).toEqual({ menu: "Principal", seo: "SEO Audit", status: "Status" });
  });
});
