const {
  withPodfile,
  withPodfileProperties,
  withXcodeProject,
} = require("expo/config-plugins");

// Xcode 27.2 (FORGE-442): pods that still declare iOS < 15 no longer build,
// and expo-router's LinkPreview code (compiled in its pod) uses iOS 16 APIs.
// Copied from DailyDose's plugins/with-ios-pod-deployment-floor.js (DOSE-25,
// FORGE-356), with the floor as an option: Sortey uses expo-router, so it
// raises every pod, and the app and its extensions if they are set lower,
// to at least iOS 16.0 (Expo SDK 56 itself defaults the app to 16.4). No build-time
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

/**
 * Raises `ios.deploymentTarget` in Podfile.properties.json when it is set
 * below the floor. Unset means Expo's own default (16.4 on SDK 56), which is
 * already above the floor and must not be lowered.
 */
function raisePodfileProperties(properties, floor = DEFAULT_FLOOR) {
  const current = properties["ios.deploymentTarget"];
  if (current && isBelow(current, floor)) {
    properties["ios.deploymentTarget"] = floor;
  }
  return properties;
}

/** @type {import('expo/config-plugins').ConfigPlugin<{ floor?: string } | void>} */
module.exports = function withIosPodDeploymentFloor(config, options) {
  const floor = options?.floor ?? DEFAULT_FLOOR;
  config = withPodfileProperties(config, (mod) => {
    raisePodfileProperties(mod.modResults, floor);
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
module.exports.raisePodfileProperties = raisePodfileProperties;
