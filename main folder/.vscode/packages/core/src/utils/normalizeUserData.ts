
import { UserData } from '../db/schemas';

// Define a backend default config here (loose typing to avoid TS errors)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DefaultUserData: any = {
  language: 'en',
  theme: 'dark',
  // ...add all required default fields for your app...
};

/**
 * Deep merge two objects, giving priority to the first argument's values.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, source: any): any {
  if (typeof target !== 'object' || typeof source !== 'object' || !target || !source) return target;
  const result: any = Array.isArray(target) ? [...target] : { ...source, ...target };
  for (const key of Object.keys(source)) {
    if (key in target) {
      if (typeof target[key] === 'object' && typeof source[key] === 'object' && target[key] && source[key]) {
        result[key] = deepMerge(target[key], source[key]);
      } else {
        result[key] = target[key];
      }
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Normalize a user config by merging it with the latest default config.
 */
export function normalizeUserData(userData: UserData): UserData {
  // Deep merge userData over DefaultUserData, so missing fields are filled in
  return deepMerge(userData, DefaultUserData);
}
