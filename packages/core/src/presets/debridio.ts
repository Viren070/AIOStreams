import { Option } from '../db/index.js';

export const debridioSocialOption: Option = {
  id: 'socials',
  name: '',
  description: '',
  type: 'socials',
  socials: [{ id: 'website', url: 'https://debridio.com' }],
};
export const debridioApiKeyOption: Option = {
  id: 'debridioApiKey',
  name: 'Debridio API Key',
  description:
    'Your Debridio API Key, located at your [account settings](https://debridio.com/account)',
  type: 'password',
  required: true,
};

export const debridioLogo = 'https://cdn.lb.debridio.com/site/logo.png';
