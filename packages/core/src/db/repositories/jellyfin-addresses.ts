import { constants } from '../../utils/index.js';
import { getDb } from '../db.js';
import type { DbDriver } from '../driver/types.js';
import { join, sql } from '../sql.js';
import type { JellyfinPersona } from '../schemas.js';

/** What a separate user's own sign-in address opens. */
export interface JellyfinAddressTarget {
  uuid: string;
  encryptedPassword: string;
  persona: string;
}

interface AddressRow {
  uuid: string;
  persona: string;
  encrypted_password: string;
  [k: string]: unknown;
}

/** Bounds how long a changed or removed address keeps working on a replica that did not write it. */
const ADDRESS_TTL_MS = 15_000;

export class JellyfinAddressRepository {
  /** Found addresses only, so probing for codes cannot grow it. */
  private static cache = new Map<
    string,
    { value: JellyfinAddressTarget; at: number }
  >();

  static async resolve(code: string): Promise<JellyfinAddressTarget | null> {
    const cached = this.cache.get(code);
    if (cached && Date.now() - cached.at < ADDRESS_TTL_MS) return cached.value;
    this.cache.delete(code);
    const row = await getDb().maybeOne<AddressRow>(
      sql`SELECT uuid, persona, encrypted_password FROM jellyfin_user_addresses
           WHERE code = ${code}`
    );
    if (!row) return null;
    const value = {
      uuid: row.uuid,
      encryptedPassword: row.encrypted_password,
      persona: row.persona,
    };
    this.cache.set(code, { value, at: Date.now() });
    return value;
  }

  private static forget(uuid: string): void {
    for (const [code, entry] of this.cache)
      if (entry.value.uuid === uuid) this.cache.delete(code);
  }

  /**
   * Makes the stored addresses those of the configuration's hidden users.
   * Takes the save's transaction, so a refused address refuses the save.
   */
  static async syncForUuid(
    tx: DbDriver,
    uuid: string,
    encryptedPassword: string,
    personas: JellyfinPersona[]
  ): Promise<void> {
    const wanted = personas.filter((p) => p.hidden && p.address);
    if (wanted.length) {
      const taken = await tx.query<{ code: string }>(
        sql`SELECT code FROM jellyfin_user_addresses
             WHERE uuid <> ${uuid}
               AND code IN (${join(wanted.map((p) => sql`${p.address}`))})`
      );
      if (taken.length) {
        const name = wanted.find((p) => p.address === taken[0].code)?.name;
        throw new constants.APIError(
          constants.ErrorCode.USER_INVALID_CONFIG,
          undefined,
          `${name}’s sign-in address is already in use. Make a new one.`
        );
      }
    }
    await tx.exec(
      sql`DELETE FROM jellyfin_user_addresses WHERE uuid = ${uuid}`
    );
    for (const persona of wanted) {
      await tx.exec(
        sql`INSERT INTO jellyfin_user_addresses (code, uuid, persona, encrypted_password)
            VALUES (${persona.address}, ${uuid}, ${persona.id}, ${encryptedPassword})`
      );
    }
    this.forget(uuid);
  }

  /** Refreshes the stored blob after a password change, in the change's transaction. */
  static async reencryptForUuid(
    tx: DbDriver,
    uuid: string,
    encryptedPassword: string
  ): Promise<void> {
    await tx.exec(
      sql`UPDATE jellyfin_user_addresses
             SET encrypted_password = ${encryptedPassword}
           WHERE uuid = ${uuid}`
    );
    this.forget(uuid);
  }
}
