import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SiteSessionChart } from "./SiteSessionChart";

const mocks = vi.hoisted(() => ({ chart: vi.fn() }));
vi.mock("@nivo/line", () => ({ ResponsiveLine: mocks.chart }));
vi.mock("next-intl", () => ({ useExtracted: () => (message: string) => message }));
vi.mock("@/lib/nivo", () => ({ useNivoTheme: () => ({}) }));
vi.mock("../lib/store", () => ({ useStore: () => ({ bucket: "hour" }) }));
afterEach(() => { cleanup(); mocks.chart.mockClear(); });

it("shows an accessible empty chart without passing an empty series to Nivo", () => {
  render(<SiteSessionChart data={[]} />);
  expect(screen.getByRole("img", { name: "No data" })).toBeTruthy();
  expect(mocks.chart).not.toHaveBeenCalled();
});
