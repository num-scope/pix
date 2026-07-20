import { describe, expect, it } from "vite-plus/test";
import {
  colorModeFromPiTheme,
  isThemePreference,
  nextThemePreference,
  resolveColorMode,
} from "./theme.ts";

describe("resolveColorMode", () => {
  it("resolves fixed preferences", () => {
    expect(resolveColorMode("dark", true)).toBe("dark");
    expect(resolveColorMode("dark", false)).toBe("dark");
    expect(resolveColorMode("light", true)).toBe("light");
    expect(resolveColorMode("light", false)).toBe("light");
  });

  it("follows system when preference is system", () => {
    expect(resolveColorMode("system", true)).toBe("dark");
    expect(resolveColorMode("system", false)).toBe("light");
  });

  it("cycles toolbar preference system → light → dark", () => {
    expect(nextThemePreference("system")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
  });

  it("validates preference and maps pi theme names", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("auto")).toBe(false);
    expect(colorModeFromPiTheme("dark")).toBe("dark");
    expect(colorModeFromPiTheme("Dark Plus")).toBe("dark");
    expect(colorModeFromPiTheme("light")).toBe("light");
    expect(colorModeFromPiTheme("default")).toBe("light");
    expect(colorModeFromPiTheme("solarized")).toBeUndefined();
    expect(colorModeFromPiTheme(undefined)).toBeUndefined();
  });
});
