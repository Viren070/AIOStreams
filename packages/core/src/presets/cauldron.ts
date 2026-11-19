import { Addon, Option, UserData } from '../db/index.js';
import { CustomPreset } from './custom.js';

export class CauldronPreset extends CustomPreset {
  static override get METADATA() {
    const options: Option[] = [
      {
        id: 'name',
        name: 'Name',
        description: 'What to call this addon',
        type: 'string',
        required: true,
        default: 'Cauldron',
      },
      {
        id: 'baseUrl',
        name: 'Cauldron Base URL',
        description:
          'The base URL of your Cauldron instance. AIOStreams will use its manifest endpoint.',
        type: 'url',
        required: true,
      },
      ...CustomPreset.METADATA.OPTIONS.filter(
        (option) => !['name', 'manifestUrl'].includes(option.id)
      ),
    ];

    return {
      ...CustomPreset.METADATA,
      ID: 'cauldron',
      NAME: 'Cauldron',
      LOGO: '/assets/cauldron_logo.png',
      DESCRIPTION:
        'Add your Cauldron instance to AIOStreams using its Stremio addon manifest.',
      OPTIONS: options,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    let manifestUrl: URL;
    try {
      manifestUrl = new URL(options.baseUrl);
      if (!['http:', 'https:'].includes(manifestUrl.protocol)) {
        throw new Error('Unsupported URL protocol');
      }
      if (!manifestUrl.pathname.endsWith('/manifest.json')) {
        manifestUrl.pathname = `${manifestUrl.pathname.replace(/\/+$/, '')}/manifest.json`;
      }
      manifestUrl.search = '';
      manifestUrl.hash = '';
    } catch {
      throw new Error('Cauldron Base URL must be a valid HTTP or HTTPS URL.');
    }

    return super.generateAddons(userData, {
      ...options,
      manifestUrl: manifestUrl.toString(),
    });
  }
}
