const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  applyDeploymentFloor,
  isBelow,
  raisePodfileProperties,
  raiseProjectTargets,
} = require("../plugins/with-ios-pod-deployment-floor.cjs");

const podfile = `target 'App' do
  post_install do |installer|
    react_native_post_install(installer)
  end
end
`;

const hasRuby = spawnSync("ruby", ["-v"]).status === 0;

test("raises older pod targets to the floor and keeps newer and inherited values", {
  skip: !hasRuby && "ruby is not installed",
}, () => {
  const ruby = `require 'json'
require 'rubygems'
Config = Struct.new(:build_settings)
Target = Struct.new(:build_configurations)
Project = Struct.new(:targets)
Installer = Struct.new(:pods_project)
values = ['9.0', '12.4', '15.1', '16.0', '16.4', '18.0', nil, '$(inherited)']
configs = values.map { |value| Config.new({'IPHONEOS_DEPLOYMENT_TARGET' => value}) }
$installer = Installer.new(Project.new([Target.new(configs)]))
def target(name); yield; end
def post_install; yield $installer; end
def react_native_post_install(installer); end
${applyDeploymentFloor(podfile, "16.0")}
puts JSON.generate(configs.map { |config| config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] })
`;
  assert.deepEqual(
    JSON.parse(execFileSync("ruby", ["-e", ruby], { encoding: "utf8" })),
    ["16.0", "16.0", "16.0", "16.0", "16.4", "18.0", null, "$(inherited)"],
  );
});

test("incremental prebuild adds the pod floor only once", () => {
  const once = applyDeploymentFloor(podfile, "16.0");
  assert.match(once, /Gem::Version.new\('16.0'\)/);
  assert.equal(applyDeploymentFloor(once, "16.0"), once);
});

test("refuses missing or ambiguous post-install hooks", () => {
  assert.throws(() => applyDeploymentFloor(""), /Expected one Expo Podfile/);
  assert.throws(
    () => applyDeploymentFloor(podfile + podfile),
    /Expected one Expo Podfile/,
  );
});

test("compares versions numerically and ignores build-setting macros", () => {
  assert.equal(isBelow("15.1", "16.0"), true);
  assert.equal(isBelow('"12.4"', "16.0"), true);
  assert.equal(isBelow("16", "16.0"), false);
  assert.equal(isBelow("16.4", "16.0"), false);
  assert.equal(isBelow("$(inherited)", "16.0"), false);
});

test("raises app and extension build configurations below the floor", () => {
  const section = {
    A: { buildSettings: { IPHONEOS_DEPLOYMENT_TARGET: "15.1" } },
    A_comment: "Debug",
    B: { buildSettings: { IPHONEOS_DEPLOYMENT_TARGET: "17.0" } },
    C: { buildSettings: { PRODUCT_NAME: "SorteyShare" } },
  };
  raiseProjectTargets(
    { pbxXCBuildConfigurationSection: () => section },
    "16.0",
  );
  assert.equal(section.A.buildSettings.IPHONEOS_DEPLOYMENT_TARGET, "16.0");
  assert.equal(section.B.buildSettings.IPHONEOS_DEPLOYMENT_TARGET, "17.0");
  assert.equal(section.C.buildSettings.IPHONEOS_DEPLOYMENT_TARGET, undefined);
});

test("raises a low Podfile deployment target but never lowers or adds one", () => {
  assert.deepEqual(
    raisePodfileProperties({ "ios.deploymentTarget": "15.1" }, "16.0"),
    {
      "ios.deploymentTarget": "16.0",
    },
  );
  assert.deepEqual(
    raisePodfileProperties({ "ios.deploymentTarget": "16.4" }, "16.0"),
    {
      "ios.deploymentTarget": "16.4",
    },
  );
  assert.deepEqual(raisePodfileProperties({}, "16.0"), {});
});
