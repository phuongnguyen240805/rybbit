import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../messages/en.json";
import vi from "../../messages/vi.json";
import { withEnglishFallback } from "./messageFallback";

describe("Vietnamese dashboard catalog", () => {
  it("translates the customer SEO and analytics navigation", () => {
    const t = createTranslator({ locale: "vi", messages: withEnglishFallback(en, vi) });
    for (const [source, translated] of [["SEO Audit", "Kiểm tra SEO"], ["Run SEO audit", "Chạy kiểm tra SEO"],
      ["Main", "Tổng quan"], ["Today", "Hôm nay"], ["Add Site", "Thêm website"]]) {
      const key = Object.keys(en).find(key => en[key as keyof typeof en] === source)!;
      expect(t(key)).toBe(translated);
    }
  });
});
