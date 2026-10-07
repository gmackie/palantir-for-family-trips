const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { IOSConfig, withPlugins } = require("expo/config-plugins");
const xcode = require("xcode");
const plist = require("@expo/plist").default;

const appRoot = path.resolve(__dirname, "..");
const parents = {
  development: "com.gmacko.sortey.expo",
  preview: "com.gmacko.sortey.dev",
  production: "com.gmacko.sortey",
};

function loadConfig(variant) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "-e",
        'console.log(JSON.stringify(require("@expo/config/build/evalConfig").evalConfig("app.config.ts", { config: {}, projectRoot: process.cwd() }).config))',
      ],
      {
        cwd: appRoot,
        env: { ...process.env, APP_VARIANT: variant },
        encoding: "utf8",
      },
    ),
  );
}

function existingProject(parent) {
  const project = xcode.project("unused-fixture.pbxproj");
  project.hash = {
    project: {
      objects: {
        PBXNativeTarget: {
          SHARE_comment: "SorteyShare",
          SHARE: {
            isa: "PBXNativeTarget",
            name: "SorteyShare",
            buildConfigurationList: "SHARE_LIST",
          },
        },
        XCConfigurationList: {
          SHARE_LIST: {
            isa: "XCConfigurationList",
            buildConfigurations: [{ value: "DEBUG" }, { value: "RELEASE" }],
          },
        },
        XCBuildConfiguration: {
          DEBUG: {
            isa: "XCBuildConfiguration",
            name: "Debug",
            buildSettings: {
              PRODUCT_BUNDLE_IDENTIFIER: `"${parent}.share-extension"`,
              CODE_SIGN_ENTITLEMENTS:
                '"SorteyShare/ShareExtension.entitlements"',
            },
          },
          RELEASE: {
            isa: "XCBuildConfiguration",
            name: "Release",
            buildSettings: {
              PRODUCT_BUNDLE_IDENTIFIER: `"${parent}.share-extension"`,
            },
          },
          UNRELATED: {
            isa: "XCBuildConfiguration",
            name: "Release",
            buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: "com.example.widget" },
          },
        },
      },
    },
  };
  return project;
}

for (const [variant, parent] of Object.entries(parents)) {
  test(`${variant}: fresh config and reused share target follow the actual parent`, async () => {
    const config = loadConfig(variant);
    assert.equal(config.ios.bundleIdentifier, parent);
    const identityPlugins = config.plugins.filter(
      (plugin) =>
        (Array.isArray(plugin) && plugin[0] === "expo-share-intent") ||
        plugin === "./plugins/with-share-extension-identity.cjs",
    );
    config._internal = { projectRoot: appRoot };
    const configured = withPlugins(config, identityPlugins);
    const extensions =
      configured.extra.eas.build.experimental.ios.appExtensions;
    assert.equal(extensions.length, 1);
    assert.equal(extensions[0].bundleIdentifier, `${parent}.share-extension`);
    assert.deepEqual(extensions[0].entitlements, {
      "com.apple.security.application-groups": ["group.com.gmacko.sortey"],
    });
    const directory = mkdtempSync(
      path.join(tmpdir(), "sortey-share-identity-"),
    );
    try {
      for (const previousParent of Object.values(parents)) {
        const project = existingProject(previousParent);
        const modInput = {
          ...configured,
          modResults: project,
          modRequest: { platformProjectRoot: directory, projectRoot: appRoot },
        };
        await configured.mods.ios.xcodeproj(modInput);
        // Repeat to verify idempotence on the same generated target.
        await configured.mods.ios.xcodeproj(modInput);
        const settings = project.pbxXCBuildConfigurationSection();
        for (const key of ["DEBUG", "RELEASE"]) {
          assert.equal(
            settings[key].buildSettings.PRODUCT_BUNDLE_IDENTIFIER,
            `"${parent}.share-extension"`,
            `${previousParent} -> ${parent}: ${key}`,
          );
        }
        assert.equal(
          settings.DEBUG.buildSettings.CODE_SIGN_ENTITLEMENTS,
          '"SorteyShare/ShareExtension.entitlements"',
        );
        assert.equal(
          settings.UNRELATED.buildSettings.PRODUCT_BUNDLE_IDENTIFIER,
          "com.example.widget",
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

// Captured failed preview project (SHA-256 76e7ab04a7b74939374394ec3c0e4f2bd169e60d4702dcd0de8e3e5cf9618888).
// Fresh cases rename the old extension in memory, as in the independent repro,
// so the installed upstream plugin must create the real target and files.
function realProject(previousParent) {
  const project = xcode.project(
    path.join(__dirname, "fixtures/share-extension-project.pbxproj"),
  );
  project.parseSync();
  const target = project.pbxTargetByName("SorteyShare");
  assert.ok(target);
  const configurations = IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
    project,
    target.buildConfigurationList,
  );
  if (previousParent === "fresh") {
    target.name = "LegacyShare";
    const targets = project.pbxNativeTargetSection();
    for (const key of Object.keys(targets)) {
      if (key.endsWith("_comment") && targets[key] === "SorteyShare") {
        targets[key] = "LegacyShare";
      }
    }
    for (const [, configuration] of configurations) {
      configuration.buildSettings.PRODUCT_NAME = '"LegacyShare"';
    }
    // PBX sections contain objects and string comments; ignore comment entries.
    for (const [key, group] of Object.entries(
      project.hash.project.objects.PBXGroup,
    )) {
      if (!key.endsWith("_comment") && group.name === "SorteyShare") {
        group.name = "LegacyShare";
      }
    }
    assert.equal(project.pbxTargetByName("SorteyShare"), null);
    assert.equal(project.pbxTargetByName('"SorteyShare"'), null);
  } else {
    for (const [, configuration] of configurations) {
      configuration.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${previousParent}.share-extension"`;
    }
  }
  return project;
}

function targetConfigurations(project, target) {
  return IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
    project,
    target.buildConfigurationList,
  );
}

for (const [variant, parent] of Object.entries(parents)) {
  for (const previousParent of ["fresh", ...Object.values(parents)]) {
    test(`${variant}: actual upstream creation/composition from ${previousParent}`, async () => {
      const config = loadConfig(variant);
      config._internal = { projectRoot: appRoot };
      config.sdkVersion = "56.0.0";
      const identityPlugins = config.plugins.filter(
        (plugin) =>
          (Array.isArray(plugin) && plugin[0] === "expo-share-intent") ||
          plugin === "./plugins/with-share-extension-identity.cjs",
      );
      const configured = IOSConfig.BundleIdentifier.withBundleIdentifier(
        withPlugins(config, identityPlugins),
        {},
      );
      const project = realProject(previousParent);
      const legacyTarget = project.pbxTargetByName("LegacyShare");
      const legacySettings = legacyTarget
        ? JSON.stringify(targetConfigurations(project, legacyTarget))
        : null;
      const directory = mkdtempSync(path.join(tmpdir(), "sortey-real-share-"));
      try {
        const input = {
          ...configured,
          modResults: project,
          modRequest: {
            platform: "ios",
            projectRoot: appRoot,
            platformProjectRoot: directory,
          },
        };
        await configured.mods.ios.xcodeproj(input);
        const firstProject = project.writeSync();
        const target =
          project.pbxTargetByName("SorteyShare") ??
          project.pbxTargetByName('"SorteyShare"');
        assert.ok(target);
        if (previousParent === "fresh") {
          assert.equal(target.name, '"SorteyShare"');
          assert.equal(project.pbxTargetByName("SorteyShare"), null);
        }
        await configured.mods.ios.xcodeproj(input);
        assert.equal(project.writeSync(), firstProject, "repeated Xcode mod");
        const configurations = targetConfigurations(project, target);
        assert.deepEqual(configurations.map(([, entry]) => entry.name).sort(), [
          "Debug",
          "Release",
        ]);
        for (const [, entry] of configurations) {
          const settings = entry.buildSettings;
          assert.equal(
            settings.PRODUCT_BUNDLE_IDENTIFIER,
            `"${parent}.share-extension"`,
          );
          assert.equal(
            settings.CODE_SIGN_ENTITLEMENTS.replaceAll('"', ""),
            "SorteyShare/ShareExtension.entitlements",
          );
          assert.equal(
            settings.INFOPLIST_FILE,
            '"SorteyShare/ShareExtension-Info.plist"',
          );
        }
        for (const [, entry] of targetConfigurations(
          project,
          project.getFirstTarget().firstTarget,
        )) {
          assert.equal(
            entry.buildSettings.PRODUCT_BUNDLE_IDENTIFIER.replaceAll('"', ""),
            parent,
          );
        }
        if (legacyTarget) {
          assert.equal(
            JSON.stringify(targetConfigurations(project, legacyTarget)),
            legacySettings,
          );
        }
        const extensionDirectory = path.join(directory, "SorteyShare");
        const entitlements = plist.parse(
          readFileSync(
            path.join(extensionDirectory, "ShareExtension.entitlements"),
            "utf8",
          ),
        );
        const info = plist.parse(
          readFileSync(
            path.join(extensionDirectory, "ShareExtension-Info.plist"),
            "utf8",
          ),
        );
        const group = "group.com.gmacko.sortey";
        assert.deepEqual(
          entitlements["com.apple.security.application-groups"],
          [group],
        );
        assert.equal(info.CFBundleIdentifier, "$(PRODUCT_BUNDLE_IDENTIFIER)");
        assert.equal(info.AppGroupIdentifier, group);
        assert.ok(
          readFileSync(
            path.join(extensionDirectory, "ShareViewController.swift"),
            "utf8",
          ).includes(group),
        );
        const parentEntitlements = await configured.mods.ios.entitlements({
          ...input,
          modResults: {},
        });
        assert.deepEqual(
          parentEntitlements.modResults[
            "com.apple.security.application-groups"
          ],
          [group],
        );
        const parentInfo = await configured.mods.ios.infoPlist({
          ...input,
          modResults: {},
        });
        assert.equal(parentInfo.modResults.AppGroupIdentifier, group);
        const extensions =
          configured.extra.eas.build.experimental.ios.appExtensions;
        assert.equal(extensions.length, 1);
        assert.equal(
          extensions[0].bundleIdentifier,
          `${parent}.share-extension`,
        );
        assert.deepEqual(
          extensions[0].entitlements["com.apple.security.application-groups"],
          [group],
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
}
