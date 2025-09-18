import { createLogger, maskSensitiveInfo } from './logger.js';
import { Env } from './env.js';

const logger = createLogger('startup');

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  // return `${days}d ${hours}h ${minutes}m ${secs}s`;
  let result = '';
  if (days > 0) result += `${days}d `;
  if (hours > 0) result += `${hours}h `;
  if (minutes > 0) result += `${minutes}m `;
  if (secs > 0) result += `${secs}s`;
  return result;
};

const formatMilliseconds = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return formatDuration(ms / 1000);
};

const parseBlockedItems = (
  envVar: string | undefined
): Array<{ name: string; reason: string }> => {
  if (!envVar) return [];

  return envVar.split(',').map((item) => {
    const [name, ...reasonParts] = item.split(':');
    const reason = reasonParts.join(':') || 'No reason specified';
    return { name: name.trim(), reason: reason.trim() };
  });
};

const logSection = (
  title: string,
  icon: string,
  content: () => void,
  spacing = true
) => {
  logger.info(`${icon} ${title}`);
  content();
  if (spacing) logger.info('');
};

const logKeyValue = (
  key: string,
  value: string | number | boolean,
  indent = '   '
) => {
  const formattedKey = key.padEnd(20);
  logger.info(`${indent}${formattedKey} ${value}`);
};

const logStartupInfo = () => {
  const currentTime = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Header
  logger.info(
    '╔═══════════════════════════════════════════════════════════════╗'
  );
  logger.info(
    '║                    🚀 AIOStreams Starting                     ║'
  );
  logger.info(
    '╚═══════════════════════════════════════════════════════════════╝'
  );
  logger.info('');

  // Core Information
  logSection('CORE INFORMATION', '📋', () => {
    logKeyValue('Version:', `${Env.VERSION} (${Env.TAG})`);
    logKeyValue('Node Environment:', Env.NODE_ENV.toUpperCase());
    logKeyValue('Git Commit:', `${Env.GIT_COMMIT.slice(0, 8)}`);
    logKeyValue('Build Time:', Env.BUILD_TIME);
    logKeyValue('Commit Time:', Env.BUILD_COMMIT_TIME);
    logKeyValue('Current Time:', `${currentTime} UTC`);
    logKeyValue('User:', process.env.USER || 'system');
    logKeyValue('Node Version:', process.version);
    logKeyValue('Platform:', `${process.platform} ${process.arch}`);
  });

  // Server Configuration
  logSection('SERVER CONFIGURATION', '🌐', () => {
    logKeyValue('Addon Name:', Env.ADDON_NAME);
    logKeyValue('Addon ID:', Env.ADDON_ID);
    logKeyValue('Port:', Env.PORT.toString());
    logKeyValue('Base URL:', Env.BASE_URL || 'Not configured');
    if (Env.ADDON_PROXY) {
      logKeyValue('Proxy URL:', Env.ADDON_PROXY.join(', '));
    }
    if (Env.ADDON_PROXY_CONFIG) {
      logKeyValue('Proxy Config:', Env.ADDON_PROXY_CONFIG);
    }
    if (Env.CUSTOM_HTML) {
      logKeyValue('Custom HTML:', '✅ Configured');
    }
    if (
      Env.REQUEST_URL_MAPPINGS &&
      Object.keys(Env.REQUEST_URL_MAPPINGS).length > 0
    ) {
      logKeyValue('Request URL Mappings:', '✅ Configured');
      for (const [key, value] of Object.entries(Env.REQUEST_URL_MAPPINGS)) {
        logKeyValue(`${key} → ${value}`, '', '       ');
      }
    }
    if (
      Env.STREAM_URL_MAPPINGS &&
      Object.keys(Env.STREAM_URL_MAPPINGS).length > 0
    ) {
      logKeyValue('Stream URL Mappings:', '✅ Configured');
      for (const [key, value] of Object.entries(Env.STREAM_URL_MAPPINGS)) {
        logKeyValue(`${key} → ${value}`, '', '       ');
      }
    }
  });

  // Database & Storage
  logSection('STORAGE & CACHE', '💾', () => {
    const dbType = Env.DATABASE_URI.split('://')[0].toUpperCase();
    const cacheType = Env.REDIS_URI ? 'Redis' : 'Memory';
    logKeyValue('Database Type:', dbType);
    if (Env.DATABASE_URI.includes('sqlite')) {
      const dbPath =
        Env.DATABASE_URI.replace('sqlite://', '') || './data/db.sqlite';
      logKeyValue('Database Path:', dbPath);
    } else {
      logKeyValue(
        'Database URI:',
        Env.DATABASE_URI.replace(/:\/\/.*@/, '://***@')
      ); // Hide credentials
    }
    logKeyValue('Cache Type:', cacheType);
    if (Env.REDIS_URI) {
      logKeyValue('Redis URI:', Env.REDIS_URI);
    }
  });

  // Logging Configuration
  logSection('LOGGING CONFIGURATION', '📝', () => {
    logKeyValue('Log Level:', Env.LOG_LEVEL.toUpperCase());
    logKeyValue('Log Format:', Env.LOG_FORMAT.toUpperCase());
    logKeyValue('Log Timezone:', Env.LOG_TIMEZONE);
    logKeyValue(
      'Sensitive Info:',
      Env.LOG_SENSITIVE_INFO ? '⚠️  ENABLED' : '❌ Disabled'
    );
  });

  // Cache Configuration
  logSection('CACHE CONFIGURATION', '⚡', () => {
    logKeyValue('Max Cache Size:', Env.DEFAULT_MAX_CACHE_SIZE);

    // Proxy IP Cache
    if (Env.PROXY_IP_CACHE_TTL === -1) {
      logKeyValue('Proxy IP Cache:', '❌ DISABLED');
    } else {
      logKeyValue('Proxy IP TTL:', formatDuration(Env.PROXY_IP_CACHE_TTL));
    }

    // Manifest Cache
    if (Env.MANIFEST_CACHE_TTL === -1) {
      logKeyValue('Manifest Cache:', '❌ DISABLED');
    } else {
      logKeyValue('Manifest TTL:', formatDuration(Env.MANIFEST_CACHE_TTL));
    }

    // Stream Cache
    if (Env.STREAM_CACHE_TTL === -1) {
      logKeyValue('Stream Cache:', '❌ DISABLED');
    } else {
      logKeyValue('Stream TTL:', formatDuration(Env.STREAM_CACHE_TTL));
    }

    // Subtitle Cache
    if (Env.SUBTITLE_CACHE_TTL === -1) {
      logKeyValue('Subtitle Cache:', '❌ DISABLED');
    } else {
      logKeyValue('Subtitle TTL:', formatDuration(Env.SUBTITLE_CACHE_TTL));
    }

    // Catalog Cache
    if (Env.CATALOG_CACHE_TTL === -1) {
      logKeyValue('Catalog Cache:', '❌ DISABLED');
    } else {
      logKeyValue('Catalog TTL:', formatDuration(Env.CATALOG_CACHE_TTL));
    }

    // Meta Cache
    if (Env.META_CACHE_TTL === -1) {
      logKeyValue('Meta Cache:', '❌ DISABLED');
    } else {
      logKeyValue('Meta TTL:', formatDuration(Env.META_CACHE_TTL));
    }

    // Addon Catalog Cache
    if (Env.ADDON_CATALOG_CACHE_TTL === -1) {
      logKeyValue('Addon Catalog Cache:', '❌ DISABLED');
    } else {
      logKeyValue(
        'Addon Catalog TTL:',
        formatDuration(Env.ADDON_CATALOG_CACHE_TTL)
      );
    }

    // RPDB API Cache
    if (Env.RPDB_API_KEY_VALIDITY_CACHE_TTL === -1) {
      logKeyValue('RPDB API Cache:', '❌ DISABLED');
    } else {
      logKeyValue(
        'RPDB API TTL:',
        formatDuration(Env.RPDB_API_KEY_VALIDITY_CACHE_TTL)
      );
    }
  });
  // Rate Limiting
  if (!Env.DISABLE_RATE_LIMITS) {
    logSection('RATE LIMITING', '🛡️', () => {
      logKeyValue(
        'Static Files:',
        `${Env.STATIC_RATE_LIMIT_MAX_REQUESTS}/${formatDuration(Env.STATIC_RATE_LIMIT_WINDOW)}`
      );
      logKeyValue(
        'User API:',
        `${Env.USER_API_RATE_LIMIT_MAX_REQUESTS}/${formatDuration(Env.USER_API_RATE_LIMIT_WINDOW)}`
      );
      logKeyValue(
        'Stream API:',
        `${Env.STREAM_API_RATE_LIMIT_MAX_REQUESTS}/${formatDuration(Env.STREAM_API_RATE_LIMIT_WINDOW)}`
      );
      logKeyValue(
        'Format API:',
        `${Env.FORMAT_API_RATE_LIMIT_MAX_REQUESTS}/${formatDuration(Env.FORMAT_API_RATE_LIMIT_WINDOW)}`
      );
      logKeyValue(
        'Catalog API:',
        `${Env.CATALOG_API_RATE_LIMIT_MAX_REQUESTS}/${formatDuration(Env.CATALOG_API_RATE_LIMIT_WINDOW)}`
      );
      logKeyValue(
        'Anime API:',
        `${Env.ANIME_API_RATE_LIMIT_MAX_REQUESTS}/${formatDuration(Env.ANIME_API_RATE_LIMIT_WINDOW)}`
      );
      logKeyValue(
        'Stremio Stream:',
        `${Env.STREMIO_STREAM_RATE_LIMIT_MAX_REQUESTS}/${formatDuration(Env.STREMIO_STREAM_RATE_LIMIT_WINDOW)}`
      );
      logKeyValue(
        'Stremio Catalog:',
        `${Env.STREMIO_CATALOG_RATE_LIMIT_MAX_REQUESTS}/${formatDuration(Env.STREMIO_CATALOG_RATE_LIMIT_WINDOW)}`
      );
      logKeyValue(
        'Stremio Manifest:',
        `${Env.STREMIO_MANIFEST_RATE_LIMIT_MAX_REQUESTS}/${formatDuration(Env.STREMIO_MANIFEST_RATE_LIMIT_WINDOW)}`
      );
      logKeyValue(
        'Stremio Subtitle:',
        `${Env.STREMIO_SUBTITLE_RATE_LIMIT_MAX_REQUESTS}/${formatDuration(Env.STREMIO_SUBTITLE_RATE_LIMIT_WINDOW)}`
      );
      logKeyValue(
        'Stremio Meta:',
        `${Env.STREMIO_META_RATE_LIMIT_MAX_REQUESTS}/${formatDuration(Env.STREMIO_META_RATE_LIMIT_WINDOW)}`
      );
    });
  } else {
    logSection(
      'RATE LIMITING',
      '🛡️',
      () => {
        logKeyValue('Status:', '❌ DISABLED');
      },
      true
    );
  }

  // Security & Access
  logSection('SECURITY & ACCESS', '🔐', () => {
    logKeyValue(
      'Password Protected:',
      Env.ADDON_PASSWORD.length ? '✅ YES' : '❌ NO'
    );
    logKeyValue('Secret Key:', Env.SECRET_KEY ? '✅ Configured' : '❌ Not set');
    logKeyValue('Regex Access:', Env.REGEX_FILTER_ACCESS.toUpperCase());

    if (Env.TRUSTED_UUIDS) {
      const trustedCount = Env.TRUSTED_UUIDS.split(',').length;
      logKeyValue('Trusted UUIDs:', `${trustedCount} configured`);
    } else {
      logKeyValue('Trusted UUIDs:', '❌ None');
    }

    if (Object.keys(Env.ALIASED_CONFIGURATIONS).length > 0) {
      logKeyValue(
        'Aliased Configs:',
        `${Object.keys(Env.ALIASED_CONFIGURATIONS).length} configured`
      );
      Object.entries(Env.ALIASED_CONFIGURATIONS).forEach(
        ([alias, { uuid, password }]) => {
          logKeyValue(`  → ${alias}:`, `${uuid}:${password}`, '       ');
        }
      );
    } else {
      logKeyValue('Aliased Configs:', '❌ None');
    }
  });

  // System Limits
  logSection('SYSTEM LIMITS', '📊', () => {
    logKeyValue('Max Addons:', Env.MAX_ADDONS.toString());
    logKeyValue('Max Groups:', Env.MAX_GROUPS.toString());
    logKeyValue('Max Keyword Filters:', Env.MAX_KEYWORD_FILTERS.toString());
    logKeyValue(
      'Max Stream Expression Filters:',
      Env.MAX_STREAM_EXPRESSION_FILTERS.toString()
    );
    logKeyValue(
      'Timeout Range:',
      `${formatMilliseconds(Env.MIN_TIMEOUT)} - ${formatMilliseconds(Env.MAX_TIMEOUT)}`
    );
    logKeyValue('Default Timeout:', formatMilliseconds(Env.DEFAULT_TIMEOUT));
    logKeyValue('Default User Agent:', Env.DEFAULT_USER_AGENT);
  });

  // Recursion Protection
  logSection('RECURSION PROTECTION', '🔄', () => {
    logKeyValue(
      'Self Scraping:',
      Env.DISABLE_SELF_SCRAPING ? '❌ Disabled' : '✅ Enabled'
    );
    logKeyValue('Threshold Limit:', Env.RECURSION_THRESHOLD_LIMIT.toString());
    logKeyValue('Time Window:', formatDuration(Env.RECURSION_THRESHOLD_WINDOW));
  });

  // Blocked Items
  const blockedHosts = parseBlockedItems(Env.DISABLED_HOSTS);
  const blockedAddons = parseBlockedItems(Env.DISABLED_ADDONS);
  const blockedServices = parseBlockedItems(Env.DISABLED_SERVICES);

  if (
    blockedHosts.length > 0 ||
    blockedAddons.length > 0 ||
    blockedServices.length > 0
  ) {
    logSection('BLOCKED ITEMS', '🚫', () => {
      if (blockedHosts.length > 0) {
        logKeyValue('Blocked Hosts:', `${blockedHosts.length} items`);
        blockedHosts.forEach(({ name, reason }) => {
          logKeyValue(`  → ${name}:`, reason, '       ');
        });
      } else {
        logKeyValue('Blocked Hosts:', '❌ None');
      }

      if (blockedAddons.length > 0) {
        logKeyValue('Blocked Addons:', `${blockedAddons.length} items`);
        blockedAddons.forEach(({ name, reason }) => {
          logKeyValue(`  → ${name}:`, reason, '       ');
        });
      } else {
        logKeyValue('Blocked Addons:', '❌ None');
      }

      if (blockedServices.length > 0) {
        logKeyValue('Blocked Services:', `${blockedServices.length} items`);
        blockedServices.forEach(({ name, reason }) => {
          logKeyValue(`  → ${name}:`, reason, '       ');
        });
      } else {
        logKeyValue('Blocked Services:', '❌ None');
      }
    });
  }

  // Default Service Credentials
  const defaultServices = [
    { name: 'RealDebrid', key: Env.DEFAULT_REALDEBRID_API_KEY },
    { name: 'AllDebrid', key: Env.DEFAULT_ALLDEBRID_API_KEY },
    { name: 'Premiumize', key: Env.DEFAULT_PREMIUMIZE_API_KEY },
    { name: 'DebridLink', key: Env.DEFAULT_DEBRIDLINK_API_KEY },
    { name: 'TorBox', key: Env.DEFAULT_TORBOX_API_KEY },
    { name: 'OffCloud', key: Env.DEFAULT_OFFCLOUD_API_KEY },
    { name: 'OffCloud Email', key: Env.DEFAULT_OFFCLOUD_EMAIL },
    { name: 'OffCloud Password', key: Env.DEFAULT_OFFCLOUD_PASSWORD },
    { name: 'PutIO Client', key: Env.DEFAULT_PUTIO_CLIENT_ID },
    { name: 'PutIO Secret', key: Env.DEFAULT_PUTIO_CLIENT_SECRET },
    { name: 'EasyNews', key: Env.DEFAULT_EASYNEWS_USERNAME },
    { name: 'EasyNews Password', key: Env.DEFAULT_EASYNEWS_PASSWORD },
    { name: 'EasyDebrid', key: Env.DEFAULT_EASYDEBRID_API_KEY },
    { name: 'Debrider', key: Env.DEFAULT_DEBRIDER_API_KEY },
    { name: 'PikPak', key: Env.DEFAULT_PIKPAK_EMAIL },
    { name: 'PikPak Password', key: Env.DEFAULT_PIKPAK_PASSWORD },
    { name: 'Seedr', key: Env.DEFAULT_SEEDR_ENCODED_TOKEN },
  ];

  logSection('DEFAULT SERVICE CREDENTIALS', '🔑', () => {
    const configuredServices = defaultServices.filter((service) => service.key);
    if (configuredServices.length > 0) {
      logKeyValue('Status:', '✅ Configured');
      configuredServices.forEach((service) => {
        logKeyValue(service.name + ':', '✅ Configured');
      });
    } else {
      logKeyValue('Status:', '❌ None configured');
    }
  });

  // Forced Service Credentials
  const forcedServices = [
    { name: 'RealDebrid', key: Env.FORCED_REALDEBRID_API_KEY },
    { name: 'AllDebrid', key: Env.FORCED_ALLDEBRID_API_KEY },
    { name: 'Premiumize', key: Env.FORCED_PREMIUMIZE_API_KEY },
    { name: 'DebridLink', key: Env.FORCED_DEBRIDLINK_API_KEY },
    { name: 'TorBox', key: Env.FORCED_TORBOX_API_KEY },
    { name: 'OffCloud', key: Env.FORCED_OFFCLOUD_API_KEY },
    { name: 'OffCloud Email', key: Env.FORCED_OFFCLOUD_EMAIL },
    { name: 'OffCloud Password', key: Env.FORCED_OFFCLOUD_PASSWORD },
    { name: 'PutIO Client', key: Env.FORCED_PUTIO_CLIENT_ID },
    { name: 'PutIO Secret', key: Env.FORCED_PUTIO_CLIENT_SECRET },
    { name: 'EasyNews', key: Env.FORCED_EASYNEWS_USERNAME },
    { name: 'EasyNews Password', key: Env.FORCED_EASYNEWS_PASSWORD },
    { name: 'EasyDebrid', key: Env.FORCED_EASYDEBRID_API_KEY },
    { name: 'Debrider', key: Env.FORCED_DEBRIDER_API_KEY },
    { name: 'PikPak', key: Env.FORCED_PIKPAK_EMAIL },
    { name: 'PikPak Password', key: Env.FORCED_PIKPAK_PASSWORD },
    { name: 'Seedr', key: Env.FORCED_SEEDR_ENCODED_TOKEN },
  ];

  const configuredForcedServices = forcedServices.filter(
    (service) => service.key
  );
  if (configuredForcedServices.length > 0) {
    logSection('FORCED SERVICE CREDENTIALS', '🔒', () => {
      logKeyValue('Status:', '✅ Configured');
      configuredForcedServices.forEach((service) => {
        logKeyValue(service.name + ':', '⚠️  ENFORCED');
      });
    });
  } else {
    logSection('FORCED SERVICE CREDENTIALS', '🔒', () => {
      logKeyValue('Status:', '❌ None configured');
    });
  }

  // Proxy Configuration
  const hasForceProxy = Env.FORCE_PROXY_ENABLED || Env.FORCE_PROXY_URL;
  const hasDefaultProxy = Env.DEFAULT_PROXY_ENABLED || Env.DEFAULT_PROXY_URL;

  if (hasForceProxy || hasDefaultProxy) {
    logSection('PROXY CONFIGURATION', '🌐', () => {
      if (hasForceProxy) {
        logKeyValue('Forced Proxy:', '⚠️  ENABLED');
        if (Env.FORCE_PROXY_ID) {
          logKeyValue('Force Service:', Env.FORCE_PROXY_ID);
        }
        if (Env.FORCE_PROXY_URL) {
          logKeyValue('Force URL:', Env.FORCE_PROXY_URL);
        }
        if (Env.FORCE_PROXY_CREDENTIALS) {
          logKeyValue('Force Credentials:', '✅ Configured');
        }
        if (Env.FORCE_PROXY_PUBLIC_IP) {
          logKeyValue('Force Public IP:', Env.FORCE_PROXY_PUBLIC_IP);
        }
        logKeyValue(
          'Disable Proxied:',
          Env.FORCE_PROXY_DISABLE_PROXIED_ADDONS ? '✅ Yes' : '❌ No'
        );
        if (Env.FORCE_PROXY_PROXIED_SERVICES) {
          logKeyValue(
            'Proxied Services:',
            JSON.stringify(Env.FORCE_PROXY_PROXIED_SERVICES)
          );
        }
      }

      if (hasDefaultProxy) {
        logKeyValue('Default Proxy:', '✅ CONFIGURED');
        if (Env.DEFAULT_PROXY_ID) {
          logKeyValue('Default Service:', Env.DEFAULT_PROXY_ID);
        }
        if (Env.DEFAULT_PROXY_URL) {
          logKeyValue('Default URL:', Env.DEFAULT_PROXY_URL);
        }
        if (Env.DEFAULT_PROXY_CREDENTIALS) {
          logKeyValue('Default Credentials:', '✅ Configured');
        }
        if (Env.DEFAULT_PROXY_PUBLIC_IP) {
          logKeyValue('Default Public IP:', Env.DEFAULT_PROXY_PUBLIC_IP);
        }
        if (Env.DEFAULT_PROXY_PROXIED_SERVICES) {
          logKeyValue(
            'Proxied Services:',
            JSON.stringify(Env.DEFAULT_PROXY_PROXIED_SERVICES)
          );
        }
      }
    });
  }

  // External Services Configuration
  logSection('EXTERNAL SERVICES', '🌍', () => {
    // Stremio Config
    logKeyValue('Stremio Config Issuer:', Env.STREMIO_ADDONS_CONFIG_ISSUER);
    logKeyValue(
      'Stremio Signature:',
      Env.STREMIO_ADDONS_CONFIG_SIGNATURE ? '✅ Configured' : '❌ None'
    );

    // TMDB
    logKeyValue(
      'TMDB Access Token:',
      Env.TMDB_ACCESS_TOKEN ? '✅ Configured' : '❌ None'
    );
    logKeyValue(
      'TMDB API Key:',
      Env.TMDB_API_KEY ? '✅ Configured' : '❌ None'
    );
    logKeyValue(
      'Trakt Client ID:',
      Env.TRAKT_CLIENT_ID ? '✅ Configured' : '❌ None'
    );
  });

  logSection('BUILT-IN ADDONS', '🔧', () => {
    // Torznab
    logKeyValue('*znab:', '');
    logKeyValue(
      'Search Timeout:',
      formatMilliseconds(Env.BUILTIN_NAB_SEARCH_TIMEOUT),
      '       '
    );
    logKeyValue(
      'Search Cache TTL:',
      formatDuration(Env.BUILTIN_NAB_SEARCH_CACHE_TTL),
      '       '
    );
    logKeyValue(
      'Capabilities Cache TTL:',
      formatDuration(Env.BUILTIN_NAB_CAPABILITIES_CACHE_TTL),
      '       '
    );

    // Prowlarr
    const prowlarrSearchEnabled =
      Env.BUILTIN_PROWLARR_URL && Env.BUILTIN_PROWLARR_API_KEY;
    logKeyValue(
      'Prowlarr:',
      prowlarrSearchEnabled
        ? '✅ Enabled'
        : '❌ Disabled (Set PROWLARR_URL, PROWLARR_API_KEY)'
    );
    if (prowlarrSearchEnabled) {
      logKeyValue('    URL:', Env.BUILTIN_PROWLARR_URL!, '       ');
      logKeyValue(
        '    API Key:',
        Env.BUILTIN_PROWLARR_API_KEY ? '✅ Configured' : '❌ None',
        '       '
      );
      logKeyValue(
        '    Indexers:',
        Env.BUILTIN_PROWLARR_INDEXERS ? '✅ Configured' : '❌ None',
        '       '
      );
      logKeyValue(
        '    Search Timeout:',
        formatMilliseconds(Env.BUILTIN_PROWLARR_SEARCH_TIMEOUT),
        '       '
      );
      logKeyValue(
        '    Search Cache TTL:',
        formatDuration(Env.BUILTIN_PROWLARR_SEARCH_CACHE_TTL),
        '       '
      );
      logKeyValue(
        '    Indexers Cache TTL:',
        formatDuration(Env.BUILTIN_PROWLARR_INDEXERS_CACHE_TTL),
        '       '
      );
    }

    // animetosho
    logKeyValue('AnimeTosho:', Env.BUILTIN_ANIMETOSHO_URL);
    if (Env.BUILTIN_ANIMETOSHO_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.BUILTIN_ANIMETOSHO_TIMEOUT),
        '     '
      );
    }

    logKeyValue('Zilean', Env.BUILTIN_ZILEAN_URL);
    if (Env.BUILTIN_ZILEAN_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.BUILTIN_ZILEAN_TIMEOUT),
        '     '
      );
    }

    const torboxSearchEnabled = Env.BASE_URL;
    logKeyValue(
      'Torbox Search:',
      torboxSearchEnabled ? '✅ Enabled' : '❌ Disabled (Set BASE_URL)'
    );
    if (torboxSearchEnabled) {
      logKeyValue(
        '    Metadata Cache TTL:',
        formatDuration(Env.BUILTIN_TORBOX_SEARCH_METADATA_CACHE_TTL)
      );
      logKeyValue(
        '    Search API Cache TTL:',
        formatDuration(Env.BUILTIN_TORBOX_SEARCH_SEARCH_API_CACHE_TTL)
      );

      if (Env.BUILTIN_TORBOX_SEARCH_TIMEOUT) {
        logKeyValue(
          '    Timeout:',
          formatMilliseconds(Env.BUILTIN_TORBOX_SEARCH_TIMEOUT)
        );
      }
      if (Env.BUILTIN_TORBOX_SEARCH_USER_AGENT) {
        logKeyValue('    User Agent:', Env.BUILTIN_TORBOX_SEARCH_USER_AGENT);
      }
    }
    const gdriveEnabled =
      Env.BUILTIN_GDRIVE_CLIENT_ID &&
      Env.BUILTIN_GDRIVE_CLIENT_SECRET &&
      Env.BASE_URL;
    logKeyValue(
      'Gdrive:',
      gdriveEnabled
        ? '✅ Enabled'
        : '❌ Disabled (Set GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, BASE_URL)'
    );
    if (gdriveEnabled) {
      logKeyValue('    Client ID:', Env.BUILTIN_GDRIVE_CLIENT_ID!, '     ');
      logKeyValue(
        '    Client Secret:',
        maskSensitiveInfo(Env.BUILTIN_GDRIVE_CLIENT_SECRET!),
        '     '
      );
      logKeyValue(
        '    Page Size Limit:',
        Env.BUILTIN_GDRIVE_PAGE_SIZE_LIMIT.toString(),
        '     '
      );
      if (Env.BUILTIN_GDRIVE_TIMEOUT) {
        logKeyValue(
          '    Timeout:',
          formatMilliseconds(Env.BUILTIN_GDRIVE_TIMEOUT),
          '     '
        );
      }
      if (Env.BUILTIN_GDRIVE_USER_AGENT) {
        logKeyValue('    User Agent:', Env.BUILTIN_GDRIVE_USER_AGENT, '     ');
      }
    }
  });

  // Addon Sources
  logSection('ADDONS', '🎬', () => {
    // Comet
    logKeyValue('Comet:', Env.COMET_URL.join(', '));
    if (Env.DEFAULT_COMET_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_COMET_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_COMET_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_COMET_USER_AGENT, '     ');
    }
    if (Env.FORCE_COMET_HOSTNAME) {
      logKeyValue(
        '  Force Host:',
        `${Env.FORCE_COMET_PROTOCOL || 'https'}://${Env.FORCE_COMET_HOSTNAME}:${Env.FORCE_COMET_PORT || 443}`,
        '     '
      );
    }

    // MediaFusion
    logKeyValue('MediaFusion:', Env.MEDIAFUSION_URL.join(', '));
    if (Env.DEFAULT_MEDIAFUSION_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_MEDIAFUSION_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_MEDIAFUSION_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_MEDIAFUSION_USER_AGENT, '     ');
    }
    logKeyValue(
      '  API Password:',
      Env.MEDIAFUSION_API_PASSWORD ? '✅ Configured' : '❌ None',
      '     '
    );
    if (
      Env.MEDIAFUSION_FORCED_USE_CACHED_RESULTS_ONLY ||
      Env.MEDIAFUSION_DEFAULT_USE_CACHED_RESULTS_ONLY
    ) {
      const value =
        Env.MEDIAFUSION_FORCED_USE_CACHED_RESULTS_ONLY ||
        Env.MEDIAFUSION_DEFAULT_USE_CACHED_RESULTS_ONLY
          ? '✅ Enabled'
          : '❌ Disabled';
      logKeyValue(
        '  Cached Searches Default:',
        `${value}${Env.MEDIAFUSION_FORCED_USE_CACHED_RESULTS_ONLY ? '  ⚠️  ENFORCED' : ''}`,
        '     '
      );
    }

    // Jackettio
    logKeyValue('Jackettio:', Env.JACKETTIO_URL.join(', '));
    if (Env.DEFAULT_JACKETTIO_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_JACKETTIO_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_JACKETTIO_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_JACKETTIO_USER_AGENT, '     ');
    }
    logKeyValue(
      '  Indexers:',
      JSON.stringify(Env.DEFAULT_JACKETTIO_INDEXERS),
      '     '
    );
    logKeyValue(
      '  StremThru URL:',
      Env.DEFAULT_JACKETTIO_STREMTHRU_URL,
      '     '
    );
    if (Env.FORCE_JACKETTIO_HOSTNAME) {
      logKeyValue(
        '  Force Host:',
        `${Env.FORCE_JACKETTIO_PROTOCOL || 'https'}://${Env.FORCE_JACKETTIO_HOSTNAME}:${Env.FORCE_JACKETTIO_PORT || 443}`,
        '     '
      );
    }

    // Torrentio
    logKeyValue('Torrentio:', Env.TORRENTIO_URL);
    if (Env.DEFAULT_TORRENTIO_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_TORRENTIO_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_TORRENTIO_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_TORRENTIO_USER_AGENT, '     ');
    }

    // Orion
    logKeyValue('Orion:', Env.ORION_STREMIO_ADDON_URL);
    if (Env.DEFAULT_ORION_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_ORION_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_ORION_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_ORION_USER_AGENT, '     ');
    }

    // Peerflix
    logKeyValue('Peerflix:', Env.PEERFLIX_URL);
    if (Env.DEFAULT_PEERFLIX_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_PEERFLIX_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_PEERFLIX_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_PEERFLIX_USER_AGENT, '     ');
    }

    // Torbox Stremio
    logKeyValue('Torbox Stremio:', Env.TORBOX_STREMIO_URL);
    if (Env.DEFAULT_TORBOX_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_TORBOX_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_TORBOX_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_TORBOX_USER_AGENT, '     ');
    }

    // Easynews
    logKeyValue('Easynews:', Env.EASYNEWS_URL);
    if (Env.DEFAULT_EASYNEWS_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_EASYNEWS_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_EASYNEWS_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_EASYNEWS_USER_AGENT, '     ');
    }

    // Easynews+
    logKeyValue('Easynews+:', Env.EASYNEWS_PLUS_URL);
    if (Env.DEFAULT_EASYNEWS_PLUS_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_EASYNEWS_PLUS_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_EASYNEWS_PLUS_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_EASYNEWS_PLUS_USER_AGENT,
        '     '
      );
    }

    // Easynews++
    logKeyValue('Easynews++:', Env.EASYNEWS_PLUS_PLUS_URL);
    if (Env.DEFAULT_EASYNEWS_PLUS_PLUS_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_EASYNEWS_PLUS_PLUS_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_EASYNEWS_PLUS_PLUS_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_EASYNEWS_PLUS_PLUS_USER_AGENT,
        '     '
      );
    }
    if (Env.EASYNEWS_PLUS_PLUS_PUBLIC_URL) {
      logKeyValue('  Public URL:', Env.EASYNEWS_PLUS_PLUS_PUBLIC_URL, '     ');
    }

    // Debridio (Main)
    logKeyValue('Debridio:', Env.DEBRIDIO_URL);
    if (Env.DEFAULT_DEBRIDIO_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_DEBRIDIO_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_DEBRIDIO_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_DEBRIDIO_USER_AGENT, '     ');
    }

    // Debridio TVDB
    logKeyValue('Debridio TVDB:', Env.DEBRIDIO_TVDB_URL);
    if (Env.DEFAULT_DEBRIDIO_TVDB_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_DEBRIDIO_TVDB_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_DEBRIDIO_TVDB_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_DEBRIDIO_TVDB_USER_AGENT,
        '     '
      );
    }

    // Debridio TMDB
    logKeyValue('Debridio TMDB:', Env.DEBRIDIO_TMDB_URL);
    if (Env.DEFAULT_DEBRIDIO_TMDB_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_DEBRIDIO_TMDB_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_DEBRIDIO_TMDB_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_DEBRIDIO_TMDB_USER_AGENT,
        '     '
      );
    }

    // Debridio TV
    logKeyValue('Debridio TV:', Env.DEBRIDIO_TV_URL);
    if (Env.DEFAULT_DEBRIDIO_TV_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_DEBRIDIO_TV_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_DEBRIDIO_TV_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_DEBRIDIO_TV_USER_AGENT, '     ');
    }

    // Debridio Watchtower
    logKeyValue('Debridio Watchtower:', Env.DEBRIDIO_WATCHTOWER_URL);
    if (Env.DEFAULT_DEBRIDIO_WATCHTOWER_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_DEBRIDIO_WATCHTOWER_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_DEBRIDIO_WATCHTOWER_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_DEBRIDIO_WATCHTOWER_USER_AGENT,
        '     '
      );
    }

    // StremThru Store
    logKeyValue('StremThru Store:', Env.STREMTHRU_STORE_URL.join(', '));
    if (Env.DEFAULT_STREMTHRU_STORE_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_STREMTHRU_STORE_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_STREMTHRU_STORE_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_STREMTHRU_STORE_USER_AGENT,
        '     '
      );
    }
    if (Env.FORCE_STREMTHRU_STORE_HOSTNAME) {
      logKeyValue(
        '  Force Host:',
        `${Env.FORCE_STREMTHRU_STORE_PROTOCOL || 'https'}://${Env.FORCE_STREMTHRU_STORE_HOSTNAME}:${Env.FORCE_STREMTHRU_STORE_PORT || 443}`,
        '     '
      );
    }
    if (Env.FORCE_STREMTHRU_STORE_PORT !== undefined) {
      logKeyValue('  Force Port:', Env.FORCE_STREMTHRU_STORE_PORT, '     ');
    }
    if (Env.FORCE_STREMTHRU_STORE_PROTOCOL !== undefined) {
      logKeyValue(
        '  Force Protocol:',
        Env.FORCE_STREMTHRU_STORE_PROTOCOL,
        '     '
      );
    }

    // StremThru Torz
    logKeyValue('StremThru Torz:', Env.STREMTHRU_TORZ_URL.join(', '));
    if (Env.DEFAULT_STREMTHRU_TORZ_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_STREMTHRU_TORZ_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_STREMTHRU_TORZ_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_STREMTHRU_TORZ_USER_AGENT,
        '     '
      );
    }
    if (Env.FORCE_STREMTHRU_TORZ_HOSTNAME) {
      logKeyValue(
        '  Force Host:',
        `${Env.FORCE_STREMTHRU_TORZ_PROTOCOL || 'https'}://${Env.FORCE_STREMTHRU_TORZ_HOSTNAME}:${Env.FORCE_STREMTHRU_TORZ_PORT || 443}`,
        '     '
      );
    }
    if (Env.FORCE_STREMTHRU_TORZ_PORT !== undefined) {
      logKeyValue('  Force Port:', Env.FORCE_STREMTHRU_TORZ_PORT, '     ');
    }
    if (Env.FORCE_STREMTHRU_TORZ_PROTOCOL !== undefined) {
      logKeyValue(
        '  Force Protocol:',
        Env.FORCE_STREMTHRU_TORZ_PROTOCOL,
        '     '
      );
    }

    // StreamFusion
    logKeyValue('StreamFusion:', Env.DEFAULT_STREAMFUSION_URL);
    if (Env.DEFAULT_STREAMFUSION_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_STREAMFUSION_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_STREAMFUSION_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_STREAMFUSION_USER_AGENT,
        '     '
      );
    }
    logKeyValue(
      '  StremThru URL:',
      Env.DEFAULT_STREAMFUSION_STREMTHRU_URL,
      '     '
    );

    // DMM Cast (Note: no URL env var, only timeout and user agent)
    if (Env.DEFAULT_DMM_CAST_TIMEOUT || Env.DEFAULT_DMM_CAST_USER_AGENT) {
      logKeyValue('DMM Cast:', 'Configuration only');
      if (Env.DEFAULT_DMM_CAST_TIMEOUT) {
        logKeyValue(
          '  Timeout:',
          formatMilliseconds(Env.DEFAULT_DMM_CAST_TIMEOUT),
          '     '
        );
      }
      if (Env.DEFAULT_DMM_CAST_USER_AGENT) {
        logKeyValue('  User Agent:', Env.DEFAULT_DMM_CAST_USER_AGENT, '     ');
      }
    }

    // OpenSubtitles
    logKeyValue('OpenSubtitles:', Env.OPENSUBTITLES_URL);
    if (Env.DEFAULT_OPENSUBTITLES_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_OPENSUBTITLES_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_OPENSUBTITLES_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_OPENSUBTITLES_USER_AGENT,
        '     '
      );
    }

    // Marvel Universe
    logKeyValue('Marvel Universe:', Env.MARVEL_UNIVERSE_URL);
    if (Env.DEFAULT_MARVEL_CATALOG_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_MARVEL_CATALOG_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_MARVEL_CATALOG_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_MARVEL_CATALOG_USER_AGENT,
        '     '
      );
    }

    // DC Universe
    logKeyValue('DC Universe:', Env.DC_UNIVERSE_URL);
    if (Env.DEFAULT_DC_UNIVERSE_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_DC_UNIVERSE_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_DC_UNIVERSE_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_DC_UNIVERSE_USER_AGENT, '     ');
    }

    // Star Wars Universe
    logKeyValue('Star Wars Universe:', Env.DEFAULT_STAR_WARS_UNIVERSE_URL);
    if (Env.DEFAULT_STAR_WARS_UNIVERSE_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_STAR_WARS_UNIVERSE_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_STAR_WARS_UNIVERSE_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_STAR_WARS_UNIVERSE_USER_AGENT,
        '     '
      );
    }

    // Anime Kitsu
    logKeyValue('Anime Kitsu:', Env.ANIME_KITSU_URL);
    if (Env.DEFAULT_ANIME_KITSU_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_ANIME_KITSU_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_ANIME_KITSU_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_ANIME_KITSU_USER_AGENT, '     ');
    }

    // NuvioStreams
    logKeyValue('NuvioStreams:', Env.NUVIOSTREAMS_URL);
    if (Env.DEFAULT_NUVIOSTREAMS_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_NUVIOSTREAMS_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_NUVIOSTREAMS_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_NUVIOSTREAMS_USER_AGENT,
        '     '
      );
    }

    // Torrent Catalogs
    logKeyValue('Torrent Catalogs:', Env.TORRENT_CATALOGS_URL);
    if (Env.DEFAULT_TORRENT_CATALOGS_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_TORRENT_CATALOGS_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_TORRENT_CATALOGS_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_TORRENT_CATALOGS_USER_AGENT,
        '     '
      );
    }

    // TMDB Collections
    logKeyValue('TMDB Collections:', Env.TMDB_COLLECTIONS_URL);
    if (Env.DEFAULT_TMDB_COLLECTIONS_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_TMDB_COLLECTIONS_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_TMDB_COLLECTIONS_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_TMDB_COLLECTIONS_USER_AGENT,
        '     '
      );
    }

    // RPDB Catalogs
    logKeyValue('RPDB Catalogs:', Env.RPDB_CATALOGS_URL);
    if (Env.DEFAULT_RPDB_CATALOGS_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_RPDB_CATALOGS_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_RPDB_CATALOGS_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_RPDB_CATALOGS_USER_AGENT,
        '     '
      );
    }

    // Streaming Catalogs
    logKeyValue('Streaming Catalogs:', Env.STREAMING_CATALOGS_URL);
    if (Env.DEFAULT_STREAMING_CATALOGS_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_STREAMING_CATALOGS_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_STREAMING_CATALOGS_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_STREAMING_CATALOGS_USER_AGENT,
        '     '
      );
    }

    // Anime Catalogs
    logKeyValue('Anime Catalogs:', Env.ANIME_CATALOGS_URL);
    if (Env.DEFAULT_ANIME_CATALOGS_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_ANIME_CATALOGS_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_ANIME_CATALOGS_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_ANIME_CATALOGS_USER_AGENT,
        '     '
      );
    }

    // Doctor Who Universe
    logKeyValue('Doctor Who Universe:', Env.DOCTOR_WHO_UNIVERSE_URL);
    if (Env.DEFAULT_DOCTOR_WHO_UNIVERSE_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_DOCTOR_WHO_UNIVERSE_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_DOCTOR_WHO_UNIVERSE_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_DOCTOR_WHO_UNIVERSE_USER_AGENT,
        '     '
      );
    }

    // WebStreamr
    logKeyValue('WebStreamr:', Env.WEBSTREAMR_URL);
    if (Env.DEFAULT_WEBSTREAMR_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_WEBSTREAMR_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_WEBSTREAMR_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_WEBSTREAMR_USER_AGENT, '     ');
    }

    // TMDB Addon
    logKeyValue('TMDB Addon:', Env.TMDB_ADDON_URL);
    if (Env.DEFAULT_TMDB_ADDON_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_TMDB_ADDON_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_TMDB_ADDON_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_TMDB_ADDON_USER_AGENT, '     ');
    }

    // Torrents DB
    logKeyValue('Torrents DB:', Env.TORRENTS_DB_URL);
    if (Env.DEFAULT_TORRENTS_DB_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_TORRENTS_DB_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_TORRENTS_DB_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_TORRENTS_DB_USER_AGENT, '     ');
    }

    // USA TV
    logKeyValue('USA TV:', Env.USA_TV_URL);
    if (Env.DEFAULT_USA_TV_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_USA_TV_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_USA_TV_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_USA_TV_USER_AGENT, '     ');
    }

    // Argentina TV
    logKeyValue('Argentina TV:', Env.ARGENTINA_TV_URL);
    if (Env.DEFAULT_ARGENTINA_TV_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_ARGENTINA_TV_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_ARGENTINA_TV_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_ARGENTINA_TV_USER_AGENT,
        '     '
      );
    }

    // SubDL
    logKeyValue('SubDL:', Env.SUBDL_URL);
    if (Env.DEFAULT_SUBDL_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_SUBDL_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_SUBDL_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_SUBDL_USER_AGENT, '     ');
    }

    // SubSource
    logKeyValue('SubSource:', Env.SUBSOURCE_URL);
    if (Env.DEFAULT_SUBSOURCE_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_SUBSOURCE_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_SUBSOURCE_USER_AGENT) {
      logKeyValue('  User Agent:', Env.DEFAULT_SUBSOURCE_USER_AGENT, '     ');
    }

    // OpenSubtitles V3 Plus
    logKeyValue('OpenSubtitles V3 Plus:', Env.OPENSUBTITLES_V3_PLUS_URL);
    if (Env.DEFAULT_OPENSUBTITLES_V3_PLUS_TIMEOUT) {
      logKeyValue(
        '  Timeout:',
        formatMilliseconds(Env.DEFAULT_OPENSUBTITLES_V3_PLUS_TIMEOUT),
        '     '
      );
    }
    if (Env.DEFAULT_OPENSUBTITLES_V3_PLUS_USER_AGENT) {
      logKeyValue(
        '  User Agent:',
        Env.DEFAULT_OPENSUBTITLES_V3_PLUS_USER_AGENT,
        '     '
      );
    }
  });

  // AI Search
  logKeyValue('AI Search:', Env.AI_SEARCH_URL);
  if (Env.DEFAULT_AI_SEARCH_TIMEOUT) {
    logKeyValue(
      '  Timeout:',
      formatMilliseconds(Env.DEFAULT_AI_SEARCH_TIMEOUT),
      '     '
    );
  }
  if (Env.DEFAULT_AI_SEARCH_USER_AGENT) {
    logKeyValue('  User Agent:', Env.DEFAULT_AI_SEARCH_USER_AGENT, '     ');
  }

  // FKStream
  logKeyValue('FKStream:', Env.FKSTREAM_URL);
  if (Env.DEFAULT_FKSTREAM_TIMEOUT) {
    logKeyValue(
      '  Timeout:',
      formatMilliseconds(Env.DEFAULT_FKSTREAM_TIMEOUT),
      '     '
    );
  }
  if (Env.DEFAULT_FKSTREAM_USER_AGENT) {
    logKeyValue('  User Agent:', Env.DEFAULT_FKSTREAM_USER_AGENT, '     ');
  }

  // AIO Subtitles
  logKeyValue('AIO Subtitles:', Env.AIOSUBTITLE_URL);
  if (Env.DEFAULT_AIOSUBTITLE_TIMEOUT) {
    logKeyValue(
      '  Timeout:',
      formatMilliseconds(Env.DEFAULT_AIOSUBTITLE_TIMEOUT),
      '     '
    );
  }
  if (Env.DEFAULT_AIOSUBTITLE_USER_AGENT) {
    logKeyValue('  User Agent:', Env.DEFAULT_AIOSUBTITLE_USER_AGENT, '     ');
  }

  // Subhero
  logKeyValue('Subhero:', Env.SUBHERO_URL);
  if (Env.DEFAULT_SUBHERO_TIMEOUT) {
    logKeyValue(
      '  Timeout:',
      formatMilliseconds(Env.DEFAULT_SUBHERO_TIMEOUT),
      '     '
    );
  }
  if (Env.DEFAULT_SUBHERO_USER_AGENT) {
    logKeyValue('  User Agent:', Env.DEFAULT_SUBHERO_USER_AGENT, '     ');
  }

  // StreamAsia
  logKeyValue('StreamAsia:', Env.STREAMASIA_URL);
  if (Env.DEFAULT_STREAMASIA_TIMEOUT) {
    logKeyValue(
      '  Timeout:',
      formatMilliseconds(Env.DEFAULT_STREAMASIA_TIMEOUT),
      '     '
    );
  }
  if (Env.DEFAULT_STREAMASIA_USER_AGENT) {
    logKeyValue('  User Agent:', Env.DEFAULT_STREAMASIA_USER_AGENT, '     ');
  }

  // More Like This
  logKeyValue('More Like This:', Env.MORE_LIKE_THIS_URL);
  if (Env.DEFAULT_MORE_LIKE_THIS_TIMEOUT) {
    logKeyValue(
      '  Timeout:',
      formatMilliseconds(Env.DEFAULT_MORE_LIKE_THIS_TIMEOUT),
      '     '
    );
  }
  if (Env.DEFAULT_MORE_LIKE_THIS_USER_AGENT) {
    logKeyValue(
      '  User Agent:',
      Env.DEFAULT_MORE_LIKE_THIS_USER_AGENT,
      '     '
    );
  }

  // Additional Features
  const features: string[] = [];
  if (Env.CUSTOM_HTML) features.push('Custom HTML');
  if (Env.ENCRYPT_MEDIAFLOW_URLS) features.push('Encrypt MediaFlow URLs');
  if (Env.ENCRYPT_STREMTHRU_URLS) features.push('Encrypt StremThru URLs');

  if (features.length > 0) {
    logSection('ADDITIONAL FEATURES', '✨', () => {
      features.forEach((feature) => {
        logKeyValue(feature + ':', '✅ ENABLED');
      });
    });
  }

  // Maintenance & Cleanup
  logSection('MAINTENANCE', '🧹', () => {
    if (Env.PRUNE_MAX_DAYS > 0) {
      logKeyValue('Prune Interval:', formatDuration(Env.PRUNE_INTERVAL));
      logKeyValue('Prune Max Age:', `${Env.PRUNE_MAX_DAYS} days`);
    } else {
      logKeyValue('Pruning :', '❌ DISABLED');
    }
  });
};

const logStartupFooter = () => {
  // Footer
  logger.info(
    '╔═══════════════════════════════════════════════════════════════╗'
  );
  logger.info(
    '║                  🎬 AIOStreams Ready!                         ║'
  );
  logger.info(
    '║           All systems initialised successfully                ║'
  );
  logger.info(
    '╚═══════════════════════════════════════════════════════════════╝'
  );
  logger.info('');
};

export { logStartupInfo, logStartupFooter };
