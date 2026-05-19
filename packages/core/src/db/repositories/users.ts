import { UserData } from '../schemas.js';
import { getDb } from '../db.js';
import { sql } from '../sql.js';
import { config as appConfig } from '../../config/index.js';
import {
  decryptString,
  deriveKey,
  encryptString,
  generateUUID,
  getTextHash,
  createLogger,
  constants,
  Env,
  verifyHash,
  validateConfig,
  applyMigrations,
  mergeConfigs,
  assertConfigAccessKey,
} from '../../utils/index.js';

const APIError = constants.APIError;
const logger = createLogger('users');

interface UserRow {
  uuid: string;
  password_hash: string;
  config: string;
  config_salt: string;
  created_at: string | Date;
  updated_at?: string | Date;
  accessed_at?: string | Date;
  [k: string]: unknown;
}

function dbError(err: unknown, fallback = constants.ErrorCode.DATABASE_ERROR) {
  if (err instanceof constants.APIError) return err;
  return new APIError(fallback);
}

function toDateString(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export class UserRepository {
  static async createUser(
    config: UserData,
    password: string
  ): Promise<{ uuid: string; encryptedPassword: string }> {
    if (password.length < 6) {
      throw new APIError(constants.ErrorCode.USER_NEW_PASSWORD_TOO_SHORT);
    }
    assertConfigAccessKey(config);
    config.trusted = false;
    config.ip = undefined;

    let configToValidate: UserData = config;
    if (config.parentConfig?.uuid) {
      let parent: UserData;
      try {
        const rawParent = await this.getRawUser(
          config.parentConfig.uuid,
          config.parentConfig.password
        );
        if (!rawParent) throw new Error('Parent config not found');
        parent = rawParent;
      } catch (error) {
        throw new APIError(
          constants.ErrorCode.PARENT_CONFIG_UNAVAILABLE,
          undefined,
          error instanceof APIError ? error.message : String(error)
        );
      }
      const merged = mergeConfigs(parent, config);
      merged.trusted = parent.trusted || config.trusted;
      configToValidate = merged;
    }

    let validatedConfig: UserData;
    try {
      validatedConfig = await validateConfig(configToValidate, {
        skipErrorsFromAddonsOrProxies: false,
        decryptValues: false,
        increasedManifestTimeout: true,
        bypassManifestCache: true,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Invalid config for new user: ${msg}`);
      throw new APIError(
        constants.ErrorCode.USER_INVALID_CONFIG,
        undefined,
        msg
      );
    }

    const uuid = await this.generateUUID();
    const { encryptedConfig, salt: configSalt } = await this.encryptConfig(
      config.parentConfig?.uuid ? config : validatedConfig,
      password
    );
    const hashedPassword = await getTextHash(password);

    const { success, data } = encryptString(password);
    if (!success) {
      throw new APIError(constants.ErrorCode.ENCRYPTION_ERROR);
    }
    const encryptedPassword = data;

    try {
      await getDb().tx(async (tx) => {
        await tx.exec(
          sql`INSERT INTO users (uuid, password_hash, config, config_salt)
              VALUES (${uuid}, ${hashedPassword}, ${encryptedConfig}, ${configSalt})`
        );
      });
      logger.info(`Created a new user with UUID: ${uuid}`);
      return { uuid, encryptedPassword };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to create user: ${msg}`);
      throw dbError(error);
    }
  }

  static async checkUserExists(uuid: string): Promise<boolean> {
    try {
      const row = await getDb().maybeOne(
        sql`SELECT uuid FROM users WHERE uuid = ${uuid}`
      );
      return row !== null;
    } catch (error) {
      logger.error(`Error checking user existence: ${error}`);
      throw new APIError(constants.ErrorCode.DATABASE_ERROR);
    }
  }

  static async getRawUser(
    uuid: string,
    password: string
  ): Promise<UserData | null> {
    try {
      const config = await this.loadRawUser(uuid, password);
      logger.info(`Retrieved raw configuration for user ${uuid}`);
      return config;
    } catch (error) {
      if (error instanceof APIError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Error retrieving user ${uuid}: ${msg}`);
      throw new APIError(constants.ErrorCode.DATABASE_ERROR);
    }
  }

  static async getUser(
    uuid: string,
    password: string
  ): Promise<UserData | null> {
    try {
      let config = await this.loadRawUser(uuid, password);

      if (config.parentConfig?.uuid) {
        try {
          const parent = await this.loadRawUser(
            config.parentConfig.uuid,
            config.parentConfig.password
          );
          config = mergeConfigs(parent, config);
          logger.info(
            `Merged parent config ${config.parentConfig!.uuid} for user ${uuid}`
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn(
            `Could not load parent config ${config.parentConfig!.uuid} for user ${uuid}: ${msg}`
          );
        }
      }

      logger.info(`Retrieved configuration for user ${uuid}`);
      return config;
    } catch (error) {
      if (error instanceof APIError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Error retrieving user ${uuid}: ${msg}`);
      throw new APIError(constants.ErrorCode.DATABASE_ERROR);
    }
  }

  private static async loadRawUser(
    uuid: string,
    password: string
  ): Promise<UserData> {
    const db = getDb();
    const row = await db.maybeOne<UserRow>(
      sql`SELECT config, config_salt, password_hash FROM users WHERE uuid = ${uuid}`
    );

    if (!row || !row.config) {
      throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
    }

    await db.exec(
      sql`UPDATE users SET accessed_at = CURRENT_TIMESTAMP WHERE uuid = ${uuid}`
    );

    const isValid = await verifyHash(password, row.password_hash);
    if (!isValid) {
      throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
    }

    const decryptedConfig = await this.decryptConfig(
      row.config,
      password,
      row.config_salt
    );

    decryptedConfig.trusted =
      appConfig.userLimits.trusted.uuids
        ?.split(',')
        .some((u) => new RegExp(u).test(uuid)) ?? false;
    decryptedConfig.uuid = uuid;
    decryptedConfig.ip = undefined;
    return applyMigrations(decryptedConfig);
  }

  static async verifyUser(
    uuid: string,
    password: string
  ): Promise<{ createdAt: string }> {
    try {
      const row = await getDb().maybeOne<UserRow>(
        sql`SELECT password_hash, created_at FROM users WHERE uuid = ${uuid}`
      );

      if (!row) {
        throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
      }

      const isValid = await verifyHash(password, row.password_hash);
      if (!isValid) {
        throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
      }

      return { createdAt: toDateString(row.created_at) };
    } catch (error) {
      if (error instanceof APIError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Error verifying user ${uuid}: ${msg}`);
      throw new APIError(constants.ErrorCode.DATABASE_ERROR);
    }
  }

  static async updateUser(
    uuid: string,
    password: string,
    config: UserData
  ): Promise<void> {
    // Do async pre-work (validation, parent fetch, encryption) outside the
    // transaction. The transaction itself is fast and synchronous-ish.

    if (config.parentConfig?.uuid === uuid) {
      throw new APIError(constants.ErrorCode.PARENT_CONFIG_SELF_REFERENCE);
    }
    assertConfigAccessKey(config);
    config.trusted =
      appConfig.userLimits.trusted.uuids
        ?.split(',')
        .some((u) => new RegExp(u).test(uuid)) ?? false;
    config.ip = undefined;

    const db = getDb();
    const current = await db.maybeOne<UserRow>(
      sql`SELECT config_salt, password_hash FROM users WHERE uuid = ${uuid}`
    );
    if (!current) {
      throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
    }
    const isValid = await verifyHash(password, current.password_hash);
    if (!isValid) {
      throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
    }

    let configToValidate: UserData = config;
    if (config.parentConfig?.uuid) {
      const rawParent = await this.getRawUser(
        config.parentConfig.uuid,
        config.parentConfig.password
      );
      if (!rawParent) {
        throw new APIError(constants.ErrorCode.PARENT_CONFIG_UNAVAILABLE);
      }
      const merged = mergeConfigs(rawParent, config);
      merged.trusted = rawParent.trusted || config.trusted;
      configToValidate = merged;
    }

    let validatedConfig: UserData;
    try {
      validatedConfig = await validateConfig(configToValidate, {
        skipErrorsFromAddonsOrProxies: false,
        decryptValues: false,
        increasedManifestTimeout: true,
        bypassManifestCache: true,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new APIError(
        constants.ErrorCode.USER_INVALID_CONFIG,
        undefined,
        msg
      );
    }

    const { encryptedConfig } = await this.encryptConfig(
      config.parentConfig?.uuid ? config : validatedConfig,
      password,
      current.config_salt
    );

    try {
      await db.tx(async (tx) => {
        await tx.exec(
          sql`UPDATE users SET config = ${encryptedConfig}, updated_at = CURRENT_TIMESTAMP WHERE uuid = ${uuid}`
        );
      });
      logger.info(`Updated user ${uuid} with an updated configuration`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to update user ${uuid}: ${msg}`);
      throw dbError(error);
    }
  }

  static async getUserCount(): Promise<number> {
    try {
      return await getDb().count(sql`SELECT COUNT(*) AS count FROM users`);
    } catch (error) {
      logger.error(`Error getting user count: ${error}`);
      throw new APIError(constants.ErrorCode.DATABASE_ERROR);
    }
  }

  static async deleteUser(uuid: string, password: string): Promise<void> {
    const db = getDb();
    try {
      await db.tx(async (tx) => {
        const row = await tx.maybeOne<UserRow>(
          sql`SELECT password_hash FROM users WHERE uuid = ${uuid}`
        );
        if (!row) {
          throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
        }
        const isValid = await verifyHash(password, row.password_hash);
        if (!isValid) {
          throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
        }
        await tx.exec(sql`DELETE FROM users WHERE uuid = ${uuid}`);
      });
      logger.info(`Deleted user ${uuid}`);
    } catch (error) {
      if (error instanceof APIError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to delete user ${uuid}: ${msg}`);
      throw new APIError(constants.ErrorCode.DATABASE_ERROR);
    }
  }

  static async pruneUsers(maxDays: number = 30): Promise<number> {
    if (maxDays < 0) {
      return 0;
    }
    try {
      const db = getDb();
      const result = await db.exec(
        sql`DELETE FROM users WHERE accessed_at < ${db.intervalAgo(maxDays, 'days')}`
      );
      const deletedCount = result.rowCount;
      logger.info(`Pruned ${deletedCount} users older than ${maxDays} days`);
      return deletedCount;
    } catch (error) {
      logger.error('Failed to prune users:', error);
      throw new APIError(constants.ErrorCode.DATABASE_ERROR);
    }
  }

  static async changePassword(
    uuid: string,
    currentPassword: string,
    newPassword: string
  ): Promise<{ encryptedPassword: string }> {
    if (newPassword.length < 6) {
      throw new APIError(constants.ErrorCode.USER_NEW_PASSWORD_TOO_SHORT);
    }

    const db = getDb();

    // Load + verify + decrypt outside the transaction.
    const row = await db.maybeOne<UserRow>(
      sql`SELECT config, config_salt, password_hash FROM users WHERE uuid = ${uuid}`
    );
    if (!row) {
      throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
    }
    if (!(await verifyHash(currentPassword, row.password_hash))) {
      throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
    }
    if (await verifyHash(newPassword, row.password_hash)) {
      throw new APIError(
        constants.ErrorCode.USER_NEW_PASSWORD_TOO_SIMPLE,
        undefined,
        'New password cannot be the same as the current password'
      );
    }

    const currentConfig = await this.decryptConfig(
      row.config,
      currentPassword,
      row.config_salt
    );

    const { encryptedConfig, salt: newConfigSalt } = await this.encryptConfig(
      currentConfig,
      newPassword
    );
    const newPasswordHash = await getTextHash(newPassword);
    const { success, data: newEncryptedPasswordToken } =
      encryptString(newPassword);
    if (!success) {
      throw new APIError(constants.ErrorCode.ENCRYPTION_ERROR);
    }

    try {
      await db.tx(async (tx) => {
        await tx.exec(
          sql`UPDATE users
              SET password_hash = ${newPasswordHash},
                  config = ${encryptedConfig},
                  config_salt = ${newConfigSalt},
                  updated_at = CURRENT_TIMESTAMP
              WHERE uuid = ${uuid}`
        );
      });
      logger.info(`Changed password for user ${uuid}`);
      return { encryptedPassword: newEncryptedPasswordToken };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to change password for user ${uuid}: ${msg}`);
      throw dbError(error);
    }
  }

  // --- helpers (unchanged from v2) ---

  private static async encryptConfig(
    config: UserData,
    password: string,
    salt?: string
  ): Promise<{ encryptedConfig: string; salt: string }> {
    const { key, salt: saltUsed } = await deriveKey(
      `${password}:${appConfig.bootstrap.secretKey}`,
      salt
    );
    const configString = JSON.stringify(config);
    const { success, data } = encryptString(configString, key);
    if (!success) {
      throw new APIError(constants.ErrorCode.ENCRYPTION_ERROR);
    }
    return { encryptedConfig: data, salt: saltUsed };
  }

  private static async decryptConfig(
    encryptedConfig: string,
    password: string,
    salt: string
  ): Promise<UserData> {
    const { key } = await deriveKey(
      `${password}:${appConfig.bootstrap.secretKey}`,
      salt
    );
    const { success, data: decryptedString } = decryptString(
      encryptedConfig,
      key
    );
    if (!success || !decryptedString) {
      throw new APIError(constants.ErrorCode.ENCRYPTION_ERROR);
    }
    return JSON.parse(decryptedString);
  }

  private static async generateUUID(count = 1): Promise<string> {
    if (count > 10) {
      throw new APIError(
        constants.ErrorCode.DATABASE_ERROR,
        undefined,
        'Failed to generate a unique UUID'
      );
    }
    const uuid = generateUUID();
    const existing = await this.checkUserExists(uuid);
    return existing ? this.generateUUID(count + 1) : uuid;
  }
}
