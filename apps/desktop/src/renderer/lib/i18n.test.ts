import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_LOCALE, isLocale, t } from "./i18n.ts";

describe("i18n", () => {
  it("defaults to Chinese", () => {
    expect(DEFAULT_LOCALE).toBe("zh");
    expect(t("zh", "nav.newThread")).toBe("新建会话");
    expect(t("en", "nav.newThread")).toBe("New session");
  });

  it("interpolates variables and validates locales", () => {
    expect(t("zh", "empty.title", { name: "pix" })).toBe("在 pix 中开始");
    expect(t("zh", "empty.titleNoWorkspace")).toBe("打开工作区以开始");
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });

  it("localizes packages and resources pages", () => {
    expect(t("zh", "packages.title")).toBe("插件");
    expect(t("en", "packages.title")).toBe("Packages");
    expect(t("zh", "resources.title")).toBe("资源");
    expect(t("en", "resources.emptyTitle")).toBe("No resources loaded");
  });
});
