import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ResourceManager {
  static getResource(resourceName: string) {
    // check existence
    const filePath = path.join(
      __dirname,
      '../../../../',
      'resources',
      resourceName
    );
    if (!fs.existsSync(filePath)) {
      throw new Error(`Resource ${resourceName} not found at ${filePath}`);
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
}
