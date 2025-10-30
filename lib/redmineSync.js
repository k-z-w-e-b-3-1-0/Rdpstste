const fs = require('fs');

const DEFAULT_MIN_INTERVAL_MS = 60_000;

let activeSyncPromise = null;
let lastSyncFinishedAt = 0;

function parseInteger(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function normalizeBaseUrl(candidate) {
  if (!candidate) {
    return null;
  }
  try {
    const parsed = new URL(candidate);
    const normalized = parsed.toString();
    return normalized.replace(/\/+$/, '/');
  } catch (error) {
    return null;
  }
}

function readApiKeyFromFile(filePath, logger) {
  if (!filePath) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.trim();
  } catch (error) {
    if (logger && typeof logger.error === 'function') {
      logger.error(
        `[RedmineSync] Failed to read API key file "${filePath}": ${error.message}`
      );
    }
    return null;
  }
}

function normalizeUsernameField(value) {
  if (!value) {
    return 'login';
  }
  const lowered = String(value).trim().toLowerCase();
  return lowered === 'mail' ? 'mail' : 'login';
}

function loadConfigFromEnv(overrides = {}, options = {}) {
  const { logger = console } = options;
  const baseUrl =
    normalizeBaseUrl(overrides.baseUrl) ||
    normalizeBaseUrl(process.env.REDMINE_BASE_URL) ||
    normalizeBaseUrl(process.env.REDMINE_URL);

  const customFieldIdCandidate =
    overrides.customFieldId ?? process.env.REDMINE_CUSTOM_FIELD_ID;
  const customFieldId = parseInteger(customFieldIdCandidate);

  let apiKey = overrides.apiKey || process.env.REDMINE_API_KEY || null;
  if (apiKey) {
    apiKey = String(apiKey).trim();
  }
  const apiKeyFile = overrides.apiKeyFile || process.env.REDMINE_API_KEY_FILE || null;
  if (!apiKey && apiKeyFile) {
    apiKey = readApiKeyFromFile(apiKeyFile, logger);
  }

  const usernameField = normalizeUsernameField(
    overrides.usernameField || process.env.REDMINE_USERNAME_FIELD
  );

  const minIntervalCandidate = overrides.minIntervalMs ?? process.env.REDMINE_SYNC_INTERVAL_MS;
  const minIntervalMs = parseInteger(minIntervalCandidate);

  const resolvedConfig = {
    baseUrl,
    customFieldId: Number.isFinite(customFieldId) ? customFieldId : null,
    apiKey: apiKey || null,
    usernameField,
    minIntervalMs:
      Number.isFinite(minIntervalMs) && minIntervalMs >= 0
        ? minIntervalMs
        : DEFAULT_MIN_INTERVAL_MS,
  };

  resolvedConfig.enabled = Boolean(
    resolvedConfig.baseUrl &&
      resolvedConfig.apiKey &&
      Number.isFinite(resolvedConfig.customFieldId)
  );

  return resolvedConfig;
}

function extractHostsByUser(sessions) {
  const map = new Map();
  if (!Array.isArray(sessions)) {
    return map;
  }
  for (const session of sessions) {
    if (!session || !session.username) {
      continue;
    }
    const username = String(session.username).trim();
    if (!username) {
      continue;
    }

    const candidates = [];
    if (session.remoteHost && typeof session.remoteHost === 'string') {
      const trimmed = session.remoteHost.trim();
      if (trimmed) {
        candidates.push(trimmed);
      }
    }
    if (
      session.remoteHostIpAddress &&
      typeof session.remoteHostIpAddress === 'string'
    ) {
      const trimmed = session.remoteHostIpAddress.trim();
      if (trimmed) {
        candidates.push(trimmed);
      }
    }

    if (candidates.length === 0) {
      continue;
    }

    if (!map.has(username)) {
      map.set(username, new Set());
    }
    const set = map.get(username);
    for (const value of candidates) {
      set.add(value);
    }
  }
  return map;
}

function formatHostList(hostSet) {
  return Array.from(hostSet).sort((a, b) => a.localeCompare(b)).join(', ');
}

async function redmineFetch(config, path, options = {}, fetchImpl = fetch) {
  const url = new URL(path, config.baseUrl);
  const headers = new Headers(options.headers || {});
  headers.set('X-Redmine-API-Key', config.apiKey);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetchImpl(url, { ...options, headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Redmine request to ${url.toString()} failed with status ${response.status}: ${body}`
    );
  }
  return response;
}

async function findRedmineUser(config, username, fetchImpl = fetch) {
  const url = new URL('/users.json', config.baseUrl);
  url.searchParams.set('status', '1');
  url.searchParams.set('limit', '100');
  url.searchParams.set('name', username);
  const response = await redmineFetch(config, url.pathname + url.search, { method: 'GET' }, fetchImpl);
  const data = await response.json();
  if (!data || !Array.isArray(data.users)) {
    return null;
  }
  const lowered = username.toLowerCase();
  return (
    data.users.find(user => {
      if (!user) {
        return false;
      }
      if (config.usernameField === 'mail' && user.mail) {
        return String(user.mail).toLowerCase() === lowered;
      }
      if (user.login) {
        return String(user.login).toLowerCase() === lowered;
      }
      return false;
    }) || null
  );
}

async function getUserDetails(config, userId, fetchImpl = fetch) {
  const response = await redmineFetch(
    config,
    `/users/${userId}.json`,
    { method: 'GET' },
    fetchImpl
  );
  return response.json();
}

function needsUpdate(currentValue, newValue) {
  return String(currentValue || '').trim() !== String(newValue || '').trim();
}

async function updateCustomField(config, userId, value, fetchImpl = fetch) {
  const body = JSON.stringify({
    user: {
      custom_fields: [
        {
          id: config.customFieldId,
          value,
        },
      ],
    },
  });
  await redmineFetch(
    config,
    `/users/${userId}.json`,
    {
      method: 'PUT',
      body,
    },
    fetchImpl
  );
}

async function syncSessionsWithRedmine({
  sessions,
  config,
  fetchImpl = fetch,
  logger = console,
}) {
  if (!config || !config.enabled) {
    return { status: 'skipped', reason: 'disabled' };
  }
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return { status: 'skipped', reason: 'no-sessions' };
  }

  const hostsByUser = extractHostsByUser(sessions);
  if (hostsByUser.size === 0) {
    return { status: 'skipped', reason: 'no-hosts' };
  }

  const summary = {
    status: 'completed',
    updated: 0,
    skipped: 0,
    missingUsers: 0,
    errors: 0,
  };

  for (const [username, hostSet] of hostsByUser) {
    const hostList = formatHostList(hostSet);
    try {
      const user = await findRedmineUser(config, username, fetchImpl);
      if (!user) {
        summary.missingUsers += 1;
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`[RedmineSync] Could not find Redmine user for ${username}`);
        }
        continue;
      }
      const details = await getUserDetails(config, user.id, fetchImpl);
      const currentValue =
        details?.user?.custom_fields?.find(field => field.id === config.customFieldId)?.value ?? '';
      if (!needsUpdate(currentValue, hostList)) {
        summary.skipped += 1;
        continue;
      }
      await updateCustomField(config, user.id, hostList, fetchImpl);
      summary.updated += 1;
      if (logger && typeof logger.log === 'function') {
        logger.log(
          `[RedmineSync] Updated custom field for ${username} (user #${user.id}) -> ${hostList}`
        );
      }
    } catch (error) {
      summary.errors += 1;
      const message = `[RedmineSync] Failed to update user ${username}: ${error.message}`;
      if (logger && typeof logger.error === 'function') {
        logger.error(message);
      } else {
        console.error(message);
      }
    }
  }

  return summary;
}

async function fetchSessionsFromApi(rdpApiBase, fetchImpl = fetch) {
  const normalizedBase = normalizeBaseUrl(rdpApiBase);
  if (!normalizedBase) {
    throw new Error(`Invalid Rdpstste base URL: ${rdpApiBase}`);
  }
  const url = new URL('/api/sessions', normalizedBase);
  const response = await fetchImpl(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Request to ${url.toString()} failed with status ${response.status}: ${body}`
    );
  }
  const data = await response.json();
  if (Array.isArray(data)) {
    return data;
  }
  if (data && Array.isArray(data.sessions)) {
    return data.sessions;
  }
  throw new Error('Unexpected response structure from Rdpstste API');
}

function snapshotSessionsForSync(sessions) {
  if (!Array.isArray(sessions)) {
    return [];
  }
  return sessions.map(session => ({
    username: session.username || '',
    remoteHost: session.remoteHost || '',
    remoteHostIpAddress: session.remoteHostIpAddress || '',
  }));
}

function triggerRedmineSyncFromEnv(sessions, options = {}) {
  const logger = options.logger || console;
  const config = loadConfigFromEnv(options.overrides || {}, { logger });
  if (!config.enabled) {
    return null;
  }

  const now = Date.now();
  if (activeSyncPromise) {
    return activeSyncPromise;
  }
  if (
    config.minIntervalMs > 0 &&
    lastSyncFinishedAt > 0 &&
    now - lastSyncFinishedAt < config.minIntervalMs
  ) {
    return null;
  }

  const sessionsSnapshot = snapshotSessionsForSync(sessions);

  activeSyncPromise = syncSessionsWithRedmine({
    sessions: sessionsSnapshot,
    config,
    logger,
  })
    .catch(error => {
      if (logger && typeof logger.error === 'function') {
        logger.error(`[RedmineSync] Sync failed: ${error.message}`);
      } else {
        console.error(`[RedmineSync] Sync failed: ${error.message}`);
      }
    })
    .finally(() => {
      lastSyncFinishedAt = Date.now();
      activeSyncPromise = null;
    });

  return activeSyncPromise;
}

module.exports = {
  loadConfigFromEnv,
  syncSessionsWithRedmine,
  fetchSessionsFromApi,
  triggerRedmineSyncFromEnv,
};
