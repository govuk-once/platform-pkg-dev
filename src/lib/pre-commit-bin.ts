import { toolVersion } from '../versions.js';
import { installPipTool, resolvePipTool, type PipToolConfig } from './pip-install.js';

function config(): PipToolConfig {
  return {
    pipPackage: 'pre-commit',
    binName: 'pre-commit',
    version: toolVersion('pre-commit'),
  };
}

export function resolvePreCommit(cwd: string): string | undefined {
  return resolvePipTool(cwd, config());
}

export function installPreCommit(cwd: string): string | undefined {
  return installPipTool(cwd, config());
}
