import { UserData } from './schemas.js';
import { TransactionQueue } from './queue.js';
import { DB } from './db.js';
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
} from '../utils/index.js';

const APIError = constants.APIError;
const logger = createLogger('users');
const db = DB.getInstance();
const txQueue = TransactionQueue.getInstance();

export class UserRepository {
  static async createUser(
    config: UserData,
    password: string
  ): Promise<{ uuid: string; encryptedPassword: string }> {
    return txQueue.enqueue(async () => {
      if (password.length < 6) {
        return Promise.reject(
          new APIError(constants.ErrorCode.USER_NEW_PASSWORD_TOO_SHORT)
        );
      }
      let validatedConfig: UserData;
      if (
        Env.ADDON_PASSWORD.length > 0 &&
        !Env.ADDON_PASSWORD.includes(config.addonPassword || '')
      ) {
        return Promise.reject(
          new APIError(constants.ErrorCode.USER_INVALID_DETAILS)
        );
      }
      config.trusted = false;
      try {
        // don't skip errors, but don't decrypt credentials
        // as we need to store the encrypted version
        validatedConfig = await validateConfig(config, {
          skipErrorsFromAddonsOrProxies: false,
          decryptValues: false,
          // when creating a user, time isnt a concern
          increasedManifestTimeout: true,
          // ensure we cache the latest manifest
          bypassManifestCache: true,
        });
      } catch (error: any) {
        logger.error(`Invalid config for new user: ${error.message}`);
        return Promise.reject(
          new APIError(
            constants.ErrorCode.USER_INVALID_CONFIG,
            undefined,
            error.message
          )
        );
      }

      const uuid = await this.generateUUID();

      const { encryptedConfig, salt: configSalt } = await this.encryptConfig(
        validatedConfig,
        password
      );
      const hashedPassword = await getTextHash(password);

      const { success, data } = encryptString(password);
      if (success === false) {
        return Promise.reject(
          new APIError(constants.ErrorCode.ENCRYPTION_ERROR)
        );
      }

      const encryptedPassword = data;
      let tx;
      let committed = false;
      try {
        tx = await db.begin();
        await tx.execute(
          'INSERT INTO users (uuid, password_hash, config, config_salt) VALUES (?, ?, ?, ?)',
          [uuid, hashedPassword, encryptedConfig, configSalt]
        );
        await tx.commit();
        committed = true;
        logger.info(`Created a new user with UUID: ${uuid}`);
        return { uuid, encryptedPassword };
      } catch (error) {
        logger.error(
          `Failed to create user: ${error instanceof Error ? error.message : String(error)}`
        );
        if (error instanceof APIError) {
          throw error;
        }
        throw new APIError(constants.ErrorCode.DATABASE_ERROR);
      } finally {
        if (tx && !committed) {
          await tx.rollback();
        }
      }
    });
  }

  static async checkUserExists(uuid: string): Promise<boolean> {
    try {
      const result = await db.query('SELECT uuid FROM users WHERE uuid = ?', [
        uuid,
      ]);
      return result.length > 0;
    } catch (error) {
      logger.error(`Error checking user existence: ${error}`);
      return Promise.reject(new APIError(constants.ErrorCode.DATABASE_ERROR));
    }
  }

  // with stremio auth, we are given the encrypted password
  // with api use, we are given the password
  // GET /user should also return

  static async getUser(
    uuid: string,
    password: string
  ): Promise<UserData | null> {
    try {
      const result = await db.query(
        'SELECT config, config_salt, password_hash FROM users WHERE uuid = ?',
        [uuid]
      );

      if (!result.length || !result[0].config) {
        return Promise.reject(
          new APIError(constants.ErrorCode.USER_INVALID_DETAILS)
        );
      }

      await db.execute(
        'UPDATE users SET accessed_at = CURRENT_TIMESTAMP WHERE uuid = ?',
        [uuid]
      );

      const isValid = await this.verifyUserPassword(
        password,
        result[0].password_hash
      );
      if (!isValid) {
        return Promise.reject(
          new APIError(constants.ErrorCode.USER_INVALID_DETAILS)
        );
      }

      const decryptedConfig = await this.decryptConfig(
        result[0].config,
        password,
        result[0].config_salt
      );

      // try {
      //   // skip errors, and dont decrypt credentials either, as this would make
      //   // encryption pointless
      //   validatedConfig = await validateConfig(decryptedConfig, true, false);
      // } catch (error: any) {
      //   return Promise.reject(
      //     new APIError(
      //       constants.ErrorCode.USER_INVALID_CONFIG,
      //       undefined,
      //       error.message
      //     )
      //   );
      // }
      // const {
      //   success,
      //   data: validatedConfig,
      //   error,
      // } = UserDataSchema.safeParse(decryptedConfig);
      // if (!success) {
      //   return Promise.reject(
      //     new APIError(
      //       constants.ErrorCode.USER_INVALID_CONFIG,
      //       undefined,
      //       formatZodError(error)
      //     )
      //   );
      // }
      decryptedConfig.trusted =
        Env.TRUSTED_UUIDS?.split(',').some((u) => new RegExp(u).test(uuid)) ??
        false;
      logger.info(`Retrieved configuration for user ${uuid}`);
      return applyMigrations(decryptedConfig);
    } catch (error) {
      logger.error(
        `Error retrieving user ${uuid}: ${error instanceof Error ? error.message : String(error)}`
      );
      return Promise.reject(new APIError(constants.ErrorCode.DATABASE_ERROR));
    }
  }

  static async updateUser(
    uuid: string,
    password: string,
    config: UserData
  ): Promise<void> {
    return txQueue.enqueue(async () => {
      let tx;
      let committed = false;
      try {
        tx = await db.begin();
        const currentUser = await tx.execute(
          'SELECT config_salt, password_hash FROM users WHERE uuid = ?',
          [uuid]
        );

        if (!currentUser.rows.length) {
          throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
        }

        if (
          Env.ADDON_PASSWORD.length > 0 &&
          !Env.ADDON_PASSWORD.includes(config.addonPassword || '')
        ) {
          throw new APIError(
            constants.ErrorCode.USER_INVALID_DETAILS,
            undefined,
            'Invalid password'
          );
        }
        config.trusted =
          Env.TRUSTED_UUIDS?.split(',').some((u) => new RegExp(u).test(uuid)) ??
          false;
        let validatedConfig: UserData;
        try {
          validatedConfig = await validateConfig(config, {
            skipErrorsFromAddonsOrProxies: false,
            decryptValues: false,
            // when updating a user, time isnt a concern
            increasedManifestTimeout: true,
            // ensure we cache the latest manifest
            bypassManifestCache: true,
          });
        } catch (error: any) {
          throw new APIError(
            constants.ErrorCode.USER_INVALID_CONFIG,
            undefined,
            error.message
          );
        }
        const storedHash = currentUser.rows[0].password_hash;
        const isValid = await this.verifyUserPassword(password, storedHash);
        if (!isValid) {
          throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
        }
        const { encryptedConfig } = await this.encryptConfig(
          validatedConfig,
          password,
          currentUser.rows[0].config_salt
        );
        await tx.execute(
          'UPDATE users SET config = ?, updated_at = CURRENT_TIMESTAMP WHERE uuid = ?',
          [encryptedConfig, uuid]
        );
        await tx.commit();
        committed = true;
        logger.info(`Updated user ${uuid} with an updated configuration`);
      } catch (error) {
        logger.error(
          `Failed to update user ${uuid}: ${error instanceof Error ? error.message : String(error)}`
        );
        if (error instanceof APIError) {
          throw error;
        }
        throw new APIError(constants.ErrorCode.DATABASE_ERROR);
      } finally {
        if (tx && !committed) {
          await tx.rollback();
        }
      }
    });
  }

  static async getUserCount(): Promise<number> {
    try {
      const result = await db.query('SELECT * FROM users');
      return result.length;
    } catch (error) {
      logger.error(`Error getting user count: ${error}`);
      return Promise.reject(new APIError(constants.ErrorCode.DATABASE_ERROR));
    }
  }

  static async deleteUser(uuid: string, password: string): Promise<void> {
    return txQueue.enqueue(async () => {
      let tx;
      let committed = false;
      try {
        tx = await db.begin();
        const result = await tx.execute(
          'SELECT password_hash FROM users WHERE uuid = ?',
          [uuid]
        );
        if (!result.rowCount) {
          throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
        }
        const isValid = await this.verifyUserPassword(
          password,
          result.rows[0].password_hash
        );
        if (!isValid) {
          throw new APIError(constants.ErrorCode.USER_INVALID_DETAILS);
        }

        await tx.execute('DELETE FROM users WHERE uuid = ?', [uuid]);

        await tx.commit();
        committed = true;
        logger.info(`Deleted user ${uuid}`);
      } catch (error) {
        logger.error(
          `Failed to delete user ${uuid}: ${error instanceof Error ? error.message : String(error)}`
        );
        if (error instanceof APIError) {
          throw error;
        }
        throw new APIError(constants.ErrorCode.DATABASE_ERROR);
      } finally {
        if (tx && !committed) {
          await tx.rollback();
        }
      }
    });
  }

  static async pruneUsers(maxDays: number = 30): Promise<number> {
    if (maxDays < 0) {
      return 0;
    }
    try {
      const query =
        db.getDialect() === 'postgres'
          ? `DELETE FROM users WHERE accessed_at < NOW() - INTERVAL '${maxDays} days'`
          : `DELETE FROM users WHERE accessed_at < datetime('now', '-' || ${maxDays} || ' days')`;

      const result = await db.execute(query);
      const deletedCount = result.changes || result.rowCount || 0;
      logger.info(`Pruned ${deletedCount} users older than ${maxDays} days`);
      return deletedCount;
    } catch (error) {
      logger.error('Failed to prune users:', error);
      return Promise.reject(new APIError(constants.ErrorCode.DATABASE_ERROR));
    }
  }

  private static async verifyUserPassword(
    password: string,
    storedHash: string
  ): Promise<boolean> {
    return verifyHash(password, storedHash);
  }

  private static async encryptConfig(
    config: UserData,
    password: string,
    salt?: string
  ): Promise<{
    encryptedConfig: string;
    salt: string;
  }> {
    const { key, salt: saltUsed } = await deriveKey(
      `${password}:${Env.SECRET_KEY}`,
      salt
    );
    const configString = JSON.stringify(config);
    const { success, data, error } = encryptString(configString, key);

    if (!success) {
      return Promise.reject(new APIError(constants.ErrorCode.ENCRYPTION_ERROR));
    }

    return { encryptedConfig: data, salt: saltUsed };
  }

  private static async decryptConfig(
    encryptedConfig: string,
    password: string,
    salt: string
  ): Promise<UserData> {
    const { key } = await deriveKey(`${password}:${Env.SECRET_KEY}`, salt);
    const {
      success,
      data: decryptedString,
      error,
    } = decryptString(encryptedConfig, key);

    if (!success || !decryptedString) {
      return Promise.reject(new APIError(constants.ErrorCode.ENCRYPTION_ERROR));
    }

    return JSON.parse(decryptedString);
  }

  private static async generateUUID(count: number = 1): Promise<string> {
    if (count > 10) {
      return Promise.reject(
        new APIError(
          constants.ErrorCode.DATABASE_ERROR,
          undefined,
          'Failed to generate a unique UUID'
        )
      );
    }

    const uuid = generateUUID();
    const existingUser = await this.checkUserExists(uuid);

    if (existingUser) {
      return this.generateUUID(count + 1);
    }

    return uuid;
  }
}
