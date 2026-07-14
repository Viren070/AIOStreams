import type { BackboneGrouping } from './types.js';

/**
 * Known usenet backbone groupings: canonical backbone id to the provider
 * hosts known to ride that backbone. Values may be root domains (covering
 * every subdomain) or full hostnames (winning over the root when a
 * provider's servers sit on different backbones per subdomain). Used only
 * when comparing verdict scopes; stored and exported values stay raw
 * hostnames.
 *
 * Groupings follow https://usenet.rexum.space/api/providers.
 */
export const KNOWN_BACKBONES: Record<string, readonly string[]> = {
  omicron: [
    'anonynews.com',
    'astraweb.com',
    'bintube.com',
    'easynews.com',
    'extremeusenet.nl',
    'fastusenet.org',
    'iload-usenet.com',
    'ixinews.com',
    'newsgroup.ninja',
    'newshosting.com',
    'newsleecher.com',
    'ngroups.net',
    'prepaid-usenet.de',
    'pureusenet.nl',
    'shemes.com',
    'simonews.com',
    'sunnyusenet.com',
    'usenet-news.net',
    'usenet.se',
    'usenet4u.nl',
    'usenetbucket.com',
    'usenetserver.com',
    'usenetstorm.com',
    'xlned.com',
  ],
  usenetexpress: [
    'binaryboy.com',
    'maximumusenet.com',
    'newsdemon.com',
    'newsgroupdirect.com',
    'thecubenet.com',
    'thundernews.com',
    'usenetexpress.com',
    'usenetprime.com',
    'green-eu.usenetnews.net',
    'green.usenetnews.net',
  ],
  giganews: ['giganews.com', 'supernews.com', 'super.newsgroupdirect.com'],
  abavia: [
    'bulknews.eu',
    'cheapnews.eu',
    'easyusenet.nl',
    'freediscussions.com',
    'gebruikhet.net',
    'hitnews.com',
    'latinusenet.com',
    'newsxs.nl',
    'spotnews.nl',
    'stingyusenet.com',
    'turbousenet.com',
    'usenet.agency',
    'usenetdeal.com',
    'usenetdiscounter.com',
    'usenext.de',
    'usenight.com',
    'xsnews.nl',
    'bonus.frugalusenet.com',
    'bonus.usenetprime.com',
    'torbox.app',
  ],
  netnews: ['blocknews.net', 'frugalusenet.com', 'usenetnow.net'],
  'usenet-farm': [
    'usenet.farm',
    'usenetfarm.eu',
    'blue.usenetnews.net',
    'farm.newsgroupdirect.com',
  ],
  'eweka-internet-services': ['eweka.nl'],
  'base-ip': ['tweaknews.eu'],
  elbracht: ['premium-news.net', 'united-newsserver.de'],
  'uzo-reto': [
    'vipernews.com',
    'gold.usenetnews.net',
    'viper.newsgroupdirect.com',
  ],
};

function invert(
  groups: Record<string, readonly string[]>
): Record<string, string> {
  const byHost: Record<string, string> = {};
  for (const [backbone, hosts] of Object.entries(groups)) {
    for (const host of hosts) byHost[host] = backbone;
  }
  return byHost;
}

export const BACKBONE_BY_HOST: Record<string, string> = invert(KNOWN_BACKBONES);

const IPV4_REGEX =
  /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/**
 * Lowercase a host and strip brackets/ports, keeping subdomains. Returns
 * `unknown` for unusable input.
 */
export function cleanHost(host: string | null | undefined): string {
  if (!host) return 'unknown';
  let h = host.trim().toLowerCase();

  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end > 1 ? h.slice(1, end) : 'unknown';
  }
  if ((h.match(/:/g)?.length ?? 0) >= 2) return h;

  const colon = h.indexOf(':');
  if (colon > 0) h = h.slice(0, colon);
  h = h.replace(/^\.+|\.+$/g, '');
  return h.length === 0 ? 'unknown' : h;
}

/**
 * Collapse a host to its registrable root domain, e.g. `news.example.com`
 * to `example.com` and `a.b.co.uk` to `b.co.uk`. Bare IPs pass through.
 * Must keep producing the same values as other Warden-format consumers so
 * exchanged backbone scopes stay comparable.
 */
export function rootDomain(host: string | null | undefined): string {
  const h = cleanHost(host);
  if (h === 'unknown' || h.includes(':') || IPV4_REGEX.test(h)) return h;

  const labels = h.split('.').filter(Boolean);
  if (labels.length <= 2) return h;
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  const take = tld.length === 2 && sld.length <= 3 ? 3 : 2;
  return labels.slice(labels.length - take).join('.');
}

/**
 * Canonical comparison value for a host. Under `backbone` grouping an exact
 * hostname match in the backbone map wins, then its root domain in the map,
 * then the root domain itself; a backbone id falls through unchanged. Under
 * `domain` grouping hosts collapse to their root domain only, except that a
 * hostname listed in the map stays a full hostname: those entries exist
 * because the subdomain rides a different backbone than its root, so they
 * must not merge with it.
 */
export function normalizeBackbone(
  host: string | null | undefined,
  grouping: BackboneGrouping = 'backbone'
): string {
  const h = cleanHost(host);
  if (h === 'unknown') return 'unknown';
  if (grouping === 'domain') {
    return BACKBONE_BY_HOST[h] ? h : rootDomain(h);
  }
  const exact = BACKBONE_BY_HOST[h];
  if (exact) return exact;
  const root = rootDomain(h);
  return BACKBONE_BY_HOST[root] ?? root;
}
