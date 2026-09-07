export {
  buildPackageJson,
  validatePackageName,
  validateTeam,
  type ScaffoldAnswers,
} from './lib/package-json.js';
export {
  inspectEnvironment,
  isSatisfied,
  reportPreflight,
  REQUIREMENTS,
  type PreflightResult,
  type Requirement,
} from './lib/preflight.js';
export {
  applicablePins,
  applyDrift,
  computeDrift,
  describeDrift,
  MANAGED_FIELDS,
  MANAGED_PINS,
  type Drift,
  type ManagedPin,
  type Manifest,
  type PinGroup,
  type PinSection,
} from './lib/pins.js';
export {
  inspectTool,
  inspectTools,
  parseVersion,
  toolSpecs,
  type ToolSpec,
  type ToolStatus,
} from './lib/tools.js';
export { which } from './lib/which.js';
export {
  applyExtend,
  describeConfigDrift,
  renderConfig,
  CONFIG_FILE,
  EXTEND_FILE,
  ExtendError,
  MANAGED_REPOS,
} from './lib/pre-commit.js';
export { findProjectRoot, resolveWorkingDir } from './lib/project.js';
export { substitute, targetName, type TemplateVars, type WriteReport } from './lib/render.js';
export { binPath, packageRoot, runTool } from './lib/toolchain.js';
export {
  CDK,
  NODE_MAJOR,
  PACKAGE_MANAGER,
  PINNED_NAMES,
  TOOLCHAIN,
  TOOLS,
  TOOL_NAMES,
  TYPES_NODE,
  toolVersion,
  versionOf,
} from './versions.js';
