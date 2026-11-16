import { M3uAddon, M3uError } from '@aiostreams/core';
import { liveTvRouter } from './livetv.js';

export default liveTvRouter((config) => new M3uAddon(config), M3uError);
