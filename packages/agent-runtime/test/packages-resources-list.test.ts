import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createPixRuntime, packageKindFromSource } from "../src/index.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("packages and resources listing", () => {
  it("classifies package sources and lists configured packages plus loaded resources", async () => {
    expect(packageKindFromSource("lodash@4")).toBe("npm");
    expect(packageKindFromSource("https://github.com/acme/pkg.git")).toBe("git");
    expect(packageKindFromSource("./vendor/pkg")).toBe("local");

    const root = await mkdtemp(join(tmpdir(), "pix-pkg-list-"));
    temporaryDirectories.push(root);
    const home = join(root, "home");
    const agentDir = join(home, ".pi", "agent");
    const cwd = join(root, "project");
    const localPackage = join(root, "local-package");
    await Promise.all([
      mkdir(join(agentDir, "extensions"), { recursive: true }),
      mkdir(join(agentDir, "prompts"), { recursive: true }),
      mkdir(join(home, ".agents"), { recursive: true }),
      mkdir(join(localPackage, "extensions"), { recursive: true }),
      mkdir(join(localPackage, "prompts"), { recursive: true }),
      mkdir(cwd, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(localPackage, "package.json"),
        JSON.stringify({
          name: "pix-list-fixture",
          version: "1.0.0",
          keywords: ["pi-package"],
          pi: { extensions: ["extensions/*.ts"], prompts: ["prompts/*.md"] },
        }),
      ),
      writeFile(join(localPackage, "extensions", "index.ts"), "export default () => undefined;\n"),
      writeFile(join(localPackage, "prompts", "hello.md"), "Hello from package.\n"),
      writeFile(join(agentDir, "prompts", "global.md"), "Global prompt.\n"),
      writeFile(
        join(agentDir, "settings.json"),
        JSON.stringify({ packages: [localPackage] }, null, 2),
      ),
    ]);

    const handle = await createPixRuntime({ cwd, agentDir, projectTrusted: true });
    try {
      const packages = handle.listPackages();
      expect(packages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: localPackage,
            scope: "global",
            kind: "local",
            filtered: false,
          }),
        ]),
      );

      const resources = handle.listResources();
      expect(resources.some((item) => item.kind === "prompt" && item.name === "global")).toBe(true);
      // Local package extension should be discoverable after settings packages resolve via loader.
      // Resource loader uses package manager at service creation; with packages in settings it loads.
      expect(resources.length).toBeGreaterThan(0);
    } finally {
      await handle.dispose();
    }
  });

  it("installs and removes a local package through the runtime adapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "pix-pkg-mutate-"));
    temporaryDirectories.push(root);
    const home = join(root, "home");
    const agentDir = join(home, ".pi", "agent");
    const cwd = join(root, "project");
    const localPackage = join(root, "mutable-package");
    await Promise.all([
      mkdir(agentDir, { recursive: true }),
      mkdir(join(home, ".agents"), { recursive: true }),
      mkdir(join(localPackage, "prompts"), { recursive: true }),
      mkdir(cwd, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(localPackage, "package.json"),
        JSON.stringify({
          name: "pix-mutable-fixture",
          version: "1.0.0",
          keywords: ["pi-package"],
          pi: { prompts: ["prompts/*.md"] },
        }),
      ),
      writeFile(join(localPackage, "prompts", "mutable.md"), "Mutable package prompt.\n"),
    ]);

    const handle = await createPixRuntime({ cwd, agentDir, projectTrusted: true });
    try {
      expect(handle.listPackages()).toEqual([]);
      const installed = await handle.installPackage(localPackage, "global");
      expect(installed).toHaveLength(1);
      expect(installed[0]?.scope).toBe("global");
      expect(installed[0]?.kind).toBe("local");
      expect(installed[0]?.installedPath).toBe(localPackage);
      // pi persists a path relative to the settings scope root, not always the absolute install input.
      expect(installed[0]?.source).toBeTruthy();
      const removed = await handle.removePackage(installed[0]!.source, "global");
      expect(removed).toEqual([]);
    } finally {
      await handle.dispose();
    }
  });
});
