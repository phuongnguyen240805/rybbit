import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KediEmbedProvider, useKediEmbed } from "./KediEmbedProvider";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
const parentWindow = {} as Window;
const parentDescriptor = Object.getOwnPropertyDescriptor(window, "parent")!;
function Probe() { const value = useKediEmbed(); return <p>{value ? `${value.locale}:${value.theme}` : "standalone"}</p>; }
function message(origin: string, source: Window, appearance: unknown) {
  const event = new MessageEvent("message", { origin, data: { type: "kedi-seo:appearance", appearance } });
  Object.defineProperty(event, "source", { value: source });
  act(() => window.dispatchEvent(event));
}
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "parent", parentDescriptor);
  delete document.documentElement.dataset.kediEmbed;
  mocks.refresh.mockClear();
});
function mount() {
  Object.defineProperty(window, "parent", { configurable: true, value: parentWindow });
  render(<KediEmbedProvider adminOrigin="https://admin.example.com" initialAppearance={null}><Probe /></KediEmbedProvider>);
}
describe("Kedi iframe appearance", () => {
  it("accepts language and theme only from the configured parent window", () => {
    mount();
    message("https://evil.example.com", parentWindow, { locale: "vi", theme: "dark" });
    message("https://admin.example.com", window, { locale: "vi", theme: "dark" });
    expect(screen.getByText("standalone")).toBeTruthy();
    message("https://admin.example.com", parentWindow, { locale: "vi", theme: "dark" });
    expect(screen.getByText("vi:dark")).toBeTruthy();
    expect(document.documentElement.dataset.kediEmbed).toBe("true");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it("rejects unrecognized preferences", () => {
    mount();
    message("https://admin.example.com", parentWindow, { locale: "<script>", theme: "dark" });
    message("https://admin.example.com", parentWindow, { locale: "vi", theme: "url(evil)" });
    expect(screen.getByText("standalone")).toBeTruthy();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("leaves standalone pages outside Kedi embed mode", () => {
    render(<KediEmbedProvider adminOrigin="https://admin.example.com" initialAppearance={{ locale: "vi", theme: "dark" }}><Probe /></KediEmbedProvider>);
    expect(screen.getByText("standalone")).toBeTruthy();
  });
});
