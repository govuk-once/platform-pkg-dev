export const GDS_ENVIRONMENT = {
  PRODUCTION: 'production',
  TEST: 'test',
  TESTING: 'testing',
  DEVELOPMENT: 'development',
  STAGING: 'staging',
  INTEGRATION: 'integration',
  PROTOTYPE: 'prototype',
  SANDBOX: 'sandbox',
  PREVIEW: 'preview',
} as const;

export const GDS_ENVIRONMENTS = Object.values(GDS_ENVIRONMENT);

export type GDSEnvironment = (typeof GDS_ENVIRONMENTS)[number];

export type ProcessEnvLike = Record<string, string | undefined>;

export class GDSEnv {
  // Expose underlying string constants on the class
  public static readonly PRODUCTION = GDS_ENVIRONMENT.PRODUCTION;
  public static readonly TEST = GDS_ENVIRONMENT.TEST;
  public static readonly TESTING = GDS_ENVIRONMENT.TESTING;
  public static readonly DEVELOPMENT = GDS_ENVIRONMENT.DEVELOPMENT;
  public static readonly STAGING = GDS_ENVIRONMENT.STAGING;
  public static readonly INTEGRATION = GDS_ENVIRONMENT.INTEGRATION;
  public static readonly PROTOTYPE = GDS_ENVIRONMENT.PROTOTYPE;
  public static readonly SANDBOX = GDS_ENVIRONMENT.SANDBOX;
  public static readonly PREVIEW = GDS_ENVIRONMENT.PREVIEW;

  /**
   * Resolves and validates the current environment string against allowed GDS environments.
   * Throws an Error if no environment variable is present or if it's invalid.
   */
  public static resolve(envSource?: ProcessEnvLike): GDSEnvironment {
    const source = envSource ?? process.env;
    const raw = (source['NODE_ENV'] ?? source['ENVIRONMENT'])?.trim();

    if (!raw) {
      throw new Error(
        'GDSEnv Error: Neither NODE_ENV nor ENVIRONMENT is set in the environment source.',
      );
    }

    const normalized = raw.toLowerCase();

    if (!(GDS_ENVIRONMENTS as readonly string[]).includes(normalized)) {
      throw new Error(
        `GDSEnv Error: Invalid environment "${raw}". Allowed environments are: ${GDS_ENVIRONMENTS.join(', ')}.`,
      );
    }

    return normalized as GDSEnvironment;
  }

  /**
   * Gets the validated GDS environment name (throws if invalid or missing).
   */
  public static get(envSource?: ProcessEnvLike): GDSEnvironment {
    return this.resolve(envSource);
  }

  /**
   * Checks if the active environment matches a specific target environment.
   */
  public static isEnv(
    targetEnv: GDSEnvironment | (string & {}),
    envSource?: ProcessEnvLike,
  ): boolean {
    const current = this.resolve(envSource);
    return current === targetEnv.toLowerCase();
  }

  /**
   * Checks if the active environment is 'production'.
   */
  public static isProd(envSource?: ProcessEnvLike): boolean {
    return this.resolve(envSource) === this.PRODUCTION;
  }

  /**
   * Checks if the active environment is 'staging'.
   */
  public static isStage(envSource?: ProcessEnvLike): boolean {
    return this.resolve(envSource) === this.STAGING;
  }

  /**
   * Checks if the active environment is 'development'.
   */
  public static isDev(envSource?: ProcessEnvLike): boolean {
    return this.resolve(envSource) === this.DEVELOPMENT;
  }

  /**
   * Checks if the active environment is 'test' or 'testing'.
   */
  public static isTest(envSource?: ProcessEnvLike): boolean {
    const current = this.resolve(envSource);
    return current === this.TEST || current === this.TESTING;
  }

  /**
   * Non-throwing utility to check if an arbitrary string is an approved GDS environment.
   */
  public static isValid(envName: string): envName is GDSEnvironment {
    return (GDS_ENVIRONMENTS as readonly string[]).includes(envName.toLowerCase().trim());
  }
}
