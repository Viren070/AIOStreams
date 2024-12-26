import { ParsedStream } from '@aiostreams/types';
import { formatSize } from './utils';

export function torboxFormat(stream: ParsedStream): {
  name: string;
  description: string;
} {
  let name: string = '';

  name += `${stream.addonName}`;
  
  if (stream.provider) {
    name += stream.provider.cached
      ? ` (Instant ${stream.provider.name})`
      : ` (${stream.provider.name})`;
  }

  if (stream.torrent?.infoHash) {
    name += ` (P2P)`;
  }

  name += ` (${stream.resolution})`;



  let description: string = '';

  description += `Quality: ${stream.quality}\nName: ${stream.filename}\nSize: ${formatSize(stream.size || 0)}\nLanguage: ${stream.languages.length > 0 ? stream.languages.join(', ') : 'Unknown'}`;

  let streamType = stream.torrent ? 'Torrent' : stream.usenet ? 'Usenet' : stream.url ? 'Direct' : 'Unknown';
  description += `\nType: ${streamType}`;

  if (streamType === 'Torrent' || streamType === 'Usenet') {
    description += ` | ${streamType === 'Torrent' ? 'Seeders' : 'Age'}: ${streamType === 'Torrent' ? stream.torrent?.seeders : stream.usenet?.age}`;
  }

  return { name, description };
}