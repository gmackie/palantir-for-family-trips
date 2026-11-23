const {
  withPodfile,
  withPodfileProperties,
  withXcodeProject,
} = require("expo/config-plugins");

// Xcode 27.2 (FORGE-442): pods that still declare iOS < 15 no longer build,
// and expo-router's LinkPreview code (compiled in its pod) uses iOS 16 APIs.
// Copied from DailyDose's plugins/with-ios-pod-deployment-floor.js (DOSE-25,
// FORGE-356), with the floor as an option: Sortey uses expo-router, so it
// raises the app, its extensions and every pod to iOS 16.0. No build-time
// overrides needed, so local, Preflight and store builds behave the same.
const DEFAULT_FLOOR = "15.1";
const marker = "# Sortey: keep pods compatible with the app deployment target.";
const anchor = "  post_install do |installer|\n";

const floorHook = (floor) => `    ${marker}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        deployment_target = build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if deployment_target && deployment_target.match?(/\\A\\d+(?:\\.\\d+)*\\z/) && Gem::Version.new(deployment_target) < Gem::Version.new('${floor}')
          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${floor}'
        end
      end
    end
`;

function applyDeploymentFloor(contents, floor = DEFAULT_FLOOR) {
  if (contents.includes(marker)) return contents;
  if (contents.split(anchor).length !== 2) {
    throw new Error("Expected one Expo Podfile post_install hook");
  }
  return contents.replace(anchor, anchor + floorHook(floor));
}

const versionParts = (value) => value.split(".").map(Number);

/** Whether `value` is a plain version (no `$(inherited)`) below `floor`. */
function isBelow(value, floor) {
  const raw = String(value).replace(/"/g, "");
  if (!/^\d+(\.\d+)*$/.test(raw)) return false;
  const a = versionParts(raw);
  const b = versionParts(floor);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** Raises every native target (app, share extension) below `floor`. */
function raiseProjectTargets(project, floor = DEFAULT_FLOOR) {
  const configurations = project.pbxXCBuildConfigurationSection();
  for (const [key, entry] of Object.entries(configurations)) {
    if (key.endsWith("_comment") || !entry.buildSettings) continue;
    const current = entry.buildSettings.IPHONEOS_DEPLOYMENT_TARGET;
    if (current !== undefined && isBelow(current, floor)) {
      entry.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = floor;
    }
  }
  return project;
}

/** @type {import('expo/config-plugins').ConfigPlugin<{ floor?: string } | void>} */
module.exports = function withIosPodDeploymentFloor(config, options) {
  const floor = options?.floor ?? DEFAULT_FLOOR;
  config = withPodfileProperties(config, (mod) => {
    const current = mod.modResults["ios.deploymentTarget"];
    if (!current || isBelow(current, floor)) {
      mod.modResults["ios.deploymentTarget"] = floor;
    }
    return mod;
  });
  config = withXcodeProject(config, (mod) => {
    raiseProjectTargets(mod.modResults, floor);
    return mod;
  });
  return withPodfile(config, (mod) => {
    mod.modResults.contents = applyDeploymentFloor(
      mod.modResults.contents,
      floor,
    );
    return mod;
  });
};
module.exports.applyDeploymentFloor = applyDeploymentFloor;
module.exports.raiseProjectTargets = raiseProjectTargets;
module.exports.isBelow = isBelow;
