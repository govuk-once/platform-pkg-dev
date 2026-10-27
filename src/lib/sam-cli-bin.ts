import { toolVersion } from '../versions.js';
import { installPipTool, resolvePipTool, type PipToolConfig } from './pip-install.js';

function config(): PipToolConfig {
  return {
    pipPackage: 'aws-sam-cli',
    binName: 'sam',
    version: toolVersion('aws-sam-cli'),
  };
}

export function resolveSam(cwd: string): string | undefined {
  return resolvePipTool(cwd, config());
}

export function installSam(cwd: string): string | undefined {
  return installPipTool(cwd, config());
}
