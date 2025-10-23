const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');
const { randomUUID } = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_PATH = path.join(DATA_DIR, 'sessions.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const commandLineOptions = parseCommandLineOptions(process.argv.slice(2));

const DASHBOARD_PROTOCOL_ENV = normalizeProtocol(
  process.env.DASHBOARD_PUBLIC_PROTOCOL || process.env.PUBLIC_DASHBOARD_PROTOCOL
);
const DEFAULT_PROTOCOL = DASHBOARD_PROTOCOL_ENV || 'http';
const DASHBOARD_PORT_ENV = parsePort(
  process.env.DASHBOARD_PUBLIC_PORT || process.env.PUBLIC_DASHBOARD_PORT
);
const DEFAULT_PUBLIC_PORT = DASHBOARD_PORT_ENV || PORT;
const CONFIGURED_DASHBOARD_URL = sanitizeDashboardUrl(
  process.env.DASHBOARD_PUBLIC_URL || process.env.PUBLIC_DASHBOARD_URL,
  DEFAULT_PROTOCOL
);
const DEFAULT_EXTERNAL_HOST = detectPrimaryExternalAddress();

let slackWebhook = null;
let slackWebhookValue = null;
let slackWebhookSourceLabel = null;

if (commandLineOptions.slackWebhookProvided) {
  slackWebhookValue = commandLineOptions.slackWebhook;
  slackWebhookSourceLabel = 'command line option';
} else if (typeof process.env.SLACK_WEBHOOK_URL === 'string') {
  slackWebhookValue = process.env.SLACK_WEBHOOK_URL;
  slackWebhookSourceLabel = 'environment variable';
}

if (typeof slackWebhookValue === 'string') {
  slackWebhookValue = slackWebhookValue.trim();
}

if (slackWebhookValue) {
  try {
    slackWebhook = new URL(slackWebhookValue);
  } catch (error) {
    const messagePrefix = slackWebhookSourceLabel
      ? `Invalid Slack webhook URL provided via ${slackWebhookSourceLabel}; disabling Slack notifications.`
      : 'Invalid Slack webhook URL provided; disabling Slack notifications.';
    console.error(messagePrefix, error.message);
  }
} else if (commandLineOptions.slackWebhookProvided) {
  console.warn(
    'No Slack webhook URL provided with the --webhook option; Slack notifications are disabled.'
  );
}

function parseCommandLineOptions(argv) {
  const options = {
    slackWebhook: undefined,
    slackWebhookProvided: false,
  };

  if (!Array.isArray(argv)) {
    return options;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (typeof argument !== 'string' || !argument.startsWith('--')) {
      continue;
    }

    const [flagName, inlineValue] = argument.split('=', 2);
    if (flagName === '--slack-webhook' || flagName === '--webhook') {
      options.slackWebhookProvided = true;
      if (inlineValue !== undefined) {
        options.slackWebhook = inlineValue;
        continue;
      }

      const nextValue = argv[index + 1];
      if (typeof nextValue === 'string' && !nextValue.startsWith('--')) {
        options.slackWebhook = nextValue;
        index += 1;
      } else {
        options.slackWebhook = '';
      }
    }
  }

  return options;
}

function normalizeBoolean(value) {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (['true', '1', 'yes', 'y', 'on', 'remote', 'rdp'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n', 'off', 'local', 'console'].includes(normalized)) {
      return false;
    }
    if (['null', 'unknown', 'unset'].includes(normalized)) {
      return null;
    }
  }
  return null;
}

function detectRemoteControlled(payload, previousValue) {
  const directKeys = [
    'remoteControlled',
    'isRemoteControlled',
    'remoteSession',
    'isRemoteSession',
    'remoteDesktopActive',
    'rdpActive',
  ];
  for (const key of directKeys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      const normalized = normalizeBoolean(payload[key]);
      if (normalized === true) {
        return { value: true, explicit: true };
      }
      if (
        normalized === false ||
        payload[key] === false ||
        payload[key] === null ||
        (typeof payload[key] === 'string' &&
          (!payload[key].trim() || ['null', 'unknown', 'unset'].includes(payload[key].trim().toLowerCase())))
      ) {
        return { value: null, explicit: true };
      }
    }
  }

  const sessionNameCandidate =
    typeof payload.sessionName === 'string'
      ? payload.sessionName
      : typeof payload.session === 'string'
      ? payload.session
      : null;
  if (sessionNameCandidate) {
    const normalized = sessionNameCandidate.trim().toLowerCase();
    if (normalized.startsWith('rdp')) {
      return { value: true, explicit: true };
    }
  }

  const protocolCandidate =
    typeof payload.sessionProtocol === 'string'
      ? payload.sessionProtocol
      : typeof payload.protocol === 'string'
      ? payload.protocol
      : null;
  if (protocolCandidate) {
    const normalized = protocolCandidate.trim().toLowerCase();
    if (normalized.includes('rdp')) {
      return { value: true, explicit: true };
    }
  }

  if (typeof payload.clientName === 'string' && payload.clientName.trim().length > 0) {
    return { value: true, explicit: true };
  }

  if (typeof payload.remoteHost === 'string' && payload.remoteHost.trim().length > 0) {
    return { value: true, explicit: true };
  }

  if (previousValue === true) {
    return { value: true, explicit: false };
  }

  return { value: null, explicit: false };
}

function postSlackMessage(payload) {
  return new Promise(resolve => {
    if (!slackWebhook) {
      resolve();
      return;
    }

    const body = JSON.stringify(payload);
    const isHttps = slackWebhook.protocol === 'https:';
    const options = {
      method: 'POST',
      hostname: slackWebhook.hostname,
      port: slackWebhook.port || (isHttps ? 443 : 80),
      path: `${slackWebhook.pathname}${slackWebhook.search}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const transport = isHttps ? https : http;
    const request = transport.request(options, response => {
      response.on('data', () => {});
      response.on('end', resolve);
    });

    request.on('error', error => {
      console.error('Slack webhook request failed', error);
      resolve();
    });

    request.setTimeout(5000, () => {
      console.warn('Slack webhook request timed out');
      request.destroy();
      resolve();
    });

    request.write(body);
    request.end();
  });
}

function normalizeProtocol(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim().toLowerCase();
  if (!text) {
    return null;
  }
  if (text === 'http' || text === 'https') {
    return text;
  }
  if (text === 'http:' || text === 'https:') {
    return text.slice(0, -1);
  }
  return null;
}

function parsePort(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0 && numeric <= 65535) {
    return numeric;
  }
  return null;
}

function isLoopbackHost(hostname) {
  if (!hostname) {
    return true;
  }
  const normalized = String(hostname)
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized === 'localhost' || normalized === '0.0.0.0') {
    return true;
  }
  if (normalized === '::1' || normalized === '::') {
    return true;
  }
  if (normalized.startsWith('127.')) {
    return true;
  }
  if (normalized.startsWith('::ffff:127.')) {
    return true;
  }
  return false;
}

function parseHostHeader(value) {
  if (!value) {
    return { hostname: null, port: null };
  }
  const text = String(value).trim();
  if (!text) {
    return { hostname: null, port: null };
  }
  if (text.startsWith('[')) {
    const closingIndex = text.indexOf(']');
    if (closingIndex !== -1) {
      const host = text.slice(1, closingIndex);
      const remainder = text.slice(closingIndex + 1);
      const port = remainder.startsWith(':') ? parsePort(remainder.slice(1)) : null;
      return { hostname: host || null, port };
    }
    return { hostname: text, port: null };
  }
  const parts = text.split(':');
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    return { hostname: parts[0], port: parsePort(parts[1]) };
  }
  return { hostname: text, port: null };
}

function formatHostForUrl(hostname) {
  if (!hostname) {
    return '';
  }
  let normalized = hostname;
  const zoneIndex = normalized.indexOf('%');
  if (zoneIndex !== -1) {
    normalized = normalized.slice(0, zoneIndex);
  }
  if (normalized.includes(':') && !normalized.startsWith('[')) {
    return `[${normalized}]`;
  }
  return normalized;
}

function buildUrlFromParts(protocolCandidate, hostname, portCandidate) {
  if (!hostname) {
    return null;
  }
  const normalizedProtocol = normalizeProtocol(protocolCandidate) || DEFAULT_PROTOCOL;
  const parsedPort = parsePort(portCandidate);
  const effectivePort = parsedPort || DEFAULT_PUBLIC_PORT;
  const omitPort =
    !effectivePort ||
    (normalizedProtocol === 'http' && effectivePort === 80) ||
    (normalizedProtocol === 'https' && effectivePort === 443);
  const portSegment = omitPort ? '' : `:${effectivePort}`;
  const formattedHost = formatHostForUrl(hostname);
  return `${normalizedProtocol}://${formattedHost}${portSegment}/`;
}

function sanitizeDashboardUrl(candidate, defaultProtocol = DEFAULT_PROTOCOL) {
  if (!candidate) {
    return null;
  }
  const raw = String(candidate).trim();
  if (!raw) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    try {
      parsed = new URL(`${defaultProtocol}://${raw}`);
    } catch (nestedError) {
      return null;
    }
  }
  if (!parsed.hostname || isLoopbackHost(parsed.hostname)) {
    return null;
  }
  const protocol = normalizeProtocol(parsed.protocol) || normalizeProtocol(defaultProtocol) || 'http';
  const port = parsePort(parsed.port);
  let pathname = parsed.pathname || '/';
  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }
  if (pathname !== '/' && !pathname.endsWith('/')) {
    pathname = `${pathname}/`;
  }
  const omitPort =
    !port ||
    (protocol === 'http' && port === 80) ||
    (protocol === 'https' && port === 443);
  const portSegment = omitPort ? '' : `:${port}`;
  const formattedHost = formatHostForUrl(parsed.hostname);
  return `${protocol}://${formattedHost}${portSegment}${pathname}`;
}

function detectPrimaryExternalAddress() {
  const interfaces = os.networkInterfaces();
  const ipv4Candidates = [];
  for (const key of Object.keys(interfaces)) {
    const entries = interfaces[key];
    if (!Array.isArray(entries)) {
      continue;
    }
    entries.forEach(entry => {
      if (!entry || entry.internal) {
        return;
      }
      if (entry.family === 'IPv4') {
        ipv4Candidates.push(entry.address);
      }
    });
  }
  if (ipv4Candidates.length > 0) {
    return ipv4Candidates[0];
  }
  for (const key of Object.keys(interfaces)) {
    const entries = interfaces[key];
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (!entry || entry.internal) {
        continue;
      }
      if (entry.family === 'IPv6') {
        return entry.address;
      }
    }
  }
  return null;
}

function resolveDashboardUrl(options = {}) {
  const protocol = normalizeProtocol(options.requestProtocol) || DEFAULT_PROTOCOL;
  const candidates = [];
  if (options.dashboardUrl) {
    candidates.push(options.dashboardUrl);
  }
  if (CONFIGURED_DASHBOARD_URL) {
    candidates.push(CONFIGURED_DASHBOARD_URL);
  }
  if (options.requestHostHeader) {
    const { hostname, port } = parseHostHeader(options.requestHostHeader);
    if (hostname && !isLoopbackHost(hostname)) {
      const candidate = buildUrlFromParts(protocol, hostname, port || DEFAULT_PUBLIC_PORT);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }
  if (DEFAULT_EXTERNAL_HOST && !isLoopbackHost(DEFAULT_EXTERNAL_HOST)) {
    const candidate = buildUrlFromParts(protocol, DEFAULT_EXTERNAL_HOST, DEFAULT_PUBLIC_PORT);
    if (candidate) {
      candidates.push(candidate);
    }
  }
  for (const candidate of candidates) {
    const sanitized = sanitizeDashboardUrl(candidate, protocol);
    if (sanitized) {
      return sanitized;
    }
  }
  return null;
}

function getFirstHeaderValue(headers, name) {
  if (!headers) {
    return null;
  }
  const value = headers[name];
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? String(value[0]) : null;
  }
  return String(value);
}

function getRequestHostHeader(req) {
  const forwarded = getFirstHeaderValue(req.headers, 'x-forwarded-host');
  if (forwarded) {
    const primary = forwarded.split(',')[0].trim();
    if (primary) {
      return primary;
    }
  }
  const host = getFirstHeaderValue(req.headers, 'host');
  return host ? host.trim() : '';
}

function getRequestProtocol(req) {
  const forwardedProto = getFirstHeaderValue(req.headers, 'x-forwarded-proto');
  if (forwardedProto) {
    const primary = forwardedProto.split(',')[0].trim().toLowerCase();
    const normalized = normalizeProtocol(primary);
    if (normalized) {
      return normalized;
    }
    if (primary) {
      return primary;
    }
  }
  if (req.socket && req.socket.encrypted) {
    return 'https';
  }
  return DEFAULT_PROTOCOL;
}

function extractRequesterUser(req) {
  const headerNames = [
    'x-remote-user',
    'x-forwarded-user',
    'remote-user',
    'x-authenticated-user',
    'x-authenticated-userid',
    'x-authenticated-username',
    'x-user',
    'x-forwarded-preferred-username',
    'x-forwarded-email',
  ];
  for (const headerName of headerNames) {
    const value = getFirstHeaderValue(req.headers, headerName);
    if (value && value.trim()) {
      return value.trim();
    }
  }
  const authorization = getFirstHeaderValue(req.headers, 'authorization');
  if (authorization && authorization.startsWith('Basic ')) {
    const encoded = authorization.slice(6).trim();
    if (encoded) {
      try {
        const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
        const colonIndex = decoded.indexOf(':');
        if (colonIndex > 0) {
          const username = decoded.slice(0, colonIndex).trim();
          if (username) {
            return username;
          }
        }
      } catch (error) {
        // Basic 認証のデコードに失敗した場合は利用者名を取得しない
      }
    }
  }
  return null;
}

function buildRequesterInfo(req) {
  const host = getClientIp(req);
  const user = extractRequesterUser(req);
  if (!host && !user) {
    return null;
  }
  return {
    host: host || null,
    user: user || null,
  };
}

function formatUsageIntentRequester(requester) {
  if (!requester) {
    return null;
  }
  const parts = [];
  if (requester.user) {
    parts.push(requester.user);
  }
  if (requester.host) {
    parts.push(requester.host);
  }
  if (parts.length === 0) {
    return null;
  }
  return `利用希望者: ${parts.join(' @ ')}`;
}

function buildNotificationContext(req, baseContext = {}) {
  const requestHostHeader = getRequestHostHeader(req);
  const requestProtocol = getRequestProtocol(req);
  const requester = buildRequesterInfo(req);
  const context = { ...baseContext };
  if (!context.requestHostHeader && requestHostHeader) {
    context.requestHostHeader = requestHostHeader;
  }
  if (!context.requestProtocol && requestProtocol) {
    context.requestProtocol = requestProtocol;
  }
  if (!context.requester && requester) {
    context.requester = requester;
  }
  const dashboardUrl = resolveDashboardUrl({
    dashboardUrl: baseContext.dashboardUrl,
    requestHostHeader,
    requestProtocol,
  });
  if (dashboardUrl) {
    context.dashboardUrl = dashboardUrl;
  }
  return context;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(`${hours}時間`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}分`);
  }
  if (secs > 0 || parts.length === 0) {
    parts.push(`${secs}秒`);
  }
  return parts.join('');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return null;
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${formatted}${units[unitIndex]}`;
}

async function notifySessionEvent(eventType, session, context = {}) {
  if (!slackWebhook) {
    return;
  }

  let headline = '📢 RDP セッション通知';
  const extraLines = [];

  if (eventType === 'created') {
    headline = '🆕 新規 RDP セッションが登録されました';
  } else if (eventType === 'connected') {
    headline = '📡 RDP セッションへの接続を検知しました';
  } else if (eventType === 'usage-intent') {
    headline = '🧑‍💻 端末の利用予定が共有されました';
    extraLines.push('アクション: これから端末を利用予定です');
    const requesterLine = formatUsageIntentRequester(context.requester);
    if (requesterLine) {
      extraLines.push(requesterLine);
    }
  } else if (eventType === 'ended') {
    headline = '🔚 RDP セッションの終了を検知しました';
    extraLines.push('アクション: 端末の利用が終了しました');
    if (typeof context.sessionDurationSeconds === 'number') {
      const formatted = formatDuration(context.sessionDurationSeconds);
      if (formatted) {
        extraLines.push(`利用時間: ${formatted}`);
      }
    }
    if (typeof context.lastIdleSeconds === 'number') {
      const formatted = formatDuration(context.lastIdleSeconds);
      if (formatted) {
        extraLines.push(`最終入力からの経過: ${formatted}`);
      }
    }
    if (typeof context.secondsSinceLastHeartbeat === 'number') {
      const formatted = formatDuration(context.secondsSinceLastHeartbeat);
      if (formatted) {
        extraLines.push(`最終ハートビートからの経過: ${formatted}`);
      }
    }
    if (typeof context.resourceMetrics === 'object' && context.resourceMetrics) {
      const metricsLines = [];
      if (typeof context.resourceMetrics.cpuTimeSeconds === 'number') {
        const formatted = formatDuration(context.resourceMetrics.cpuTimeSeconds);
        if (formatted) {
          metricsLines.push(`CPU時間 ${formatted}`);
        }
      }
      if (typeof context.resourceMetrics.workingSetBytes === 'number') {
        const formatted = formatBytes(context.resourceMetrics.workingSetBytes);
        if (formatted) {
          metricsLines.push(`メモリ使用量 ${formatted}`);
        }
      }
      if (typeof context.resourceMetrics.processCount === 'number') {
        metricsLines.push(`プロセス数 ${context.resourceMetrics.processCount}`);
      }
      if (metricsLines.length > 0) {
        extraLines.push(`終了時のリソース状況: ${metricsLines.join(' / ')}`);
      }
    }
    if (context.disconnectReason) {
      extraLines.push(`切断理由: ${context.disconnectReason}`);
    }
  }

  if (session.remoteControlled === true) {
    extraLines.push('遠隔操作: リモートデスクトップ経由');
  }

  const lines = [
    headline,
    `端末: ${session.hostname || '(名称未設定)'} (${session.ipAddress || 'IP不明'})`,
    session.remoteHostIpAddress ? `接続元IP: ${session.remoteHostIpAddress}` : '',
    session.remoteHost ? `接続元ホスト: ${session.remoteHost}` : '',
    session.notes ? `備考: ${session.notes}` : '',
    ...extraLines,
    context.trigger ? `トリガー: ${context.trigger}` : '',
  ];

  const dashboardUrl = resolveDashboardUrl({
    dashboardUrl: context.dashboardUrl,
    requestHostHeader: context.requestHostHeader,
    requestProtocol: context.requestProtocol,
  });
  if (dashboardUrl) {
    lines.push(`RDP監視ダッシュボード: ${dashboardUrl}`);
  }

  try {
    await postSlackMessage({ text: lines.filter(Boolean).join('\n') });
  } catch (error) {
    console.error('Failed to send Slack notification', error);
  }
}

function normalizeStringList(value) {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(entry => entry.trim())
      .filter(entry => entry.length > 0);
  }
  if (Array.isArray(value)) {
    return value
      .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(entry => entry.length > 0);
  }
  return [];
}

function normalizeProcessStatuses(value) {
  if (!value) {
    return [];
  }
  const entries = Array.isArray(value) ? value : [value];
  const normalized = [];
  entries.forEach(entry => {
    if (entry && typeof entry === 'object' && typeof entry.name === 'string') {
      normalized.push({
        name: entry.name.trim(),
        running: Boolean(entry.running),
      });
    }
  });
  return normalized.filter(entry => entry.name.length > 0);
}

function toOptionalString(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sanitizeEventPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch (error) {
    const sanitized = {};
    Object.keys(payload).forEach(key => {
      const value = payload[key];
      if (
        value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        sanitized[key] = value;
      } else if (Array.isArray(value)) {
        sanitized[key] = value
          .map(entry =>
            entry === null ||
            entry === undefined ||
            typeof entry === 'string' ||
            typeof entry === 'number' ||
            typeof entry === 'boolean'
              ? entry
              : null
          )
          .filter(entry => entry !== null);
      } else if (typeof value === 'object') {
        sanitized[key] = sanitizeEventPayload(value);
      }
    });
    return sanitized;
  }
}

function sanitizeResourceMetrics(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const metrics = {};
  const cpuSeconds = toOptionalNumber(value.cpuTimeSeconds ?? value.cpuSeconds);
  if (cpuSeconds !== null) {
    metrics.cpuTimeSeconds = cpuSeconds;
  }
  const workingSet = toOptionalNumber(value.workingSetBytes ?? value.workingSet);
  if (workingSet !== null) {
    metrics.workingSetBytes = Math.max(0, Math.trunc(workingSet));
  }
  if (value.processCount !== undefined) {
    const processCount = Number(value.processCount);
    if (Number.isFinite(processCount)) {
      metrics.processCount = Math.max(0, Math.round(processCount));
    }
  }
  return Object.keys(metrics).length > 0 ? metrics : null;
}

function findSessionForEvent(sessions, identifiers) {
  if (!Array.isArray(sessions)) {
    return null;
  }
  const sessionId = toOptionalString(identifiers?.sessionId);
  const resourceId = toOptionalString(identifiers?.resourceId);
  if (sessionId) {
    const sessionIdLower = sessionId.toLowerCase();
    let match = sessions.find(session =>
      typeof session.externalSessionId === 'string' &&
      session.externalSessionId.trim().toLowerCase() === sessionIdLower
    );
    if (match) {
      return match;
    }
    match = sessions.find(session =>
      typeof session.id === 'string' && session.id.trim().toLowerCase() === sessionIdLower
    );
    if (match) {
      return match;
    }
  }
  if (resourceId) {
    const resourceIdLower = resourceId.toLowerCase();
    const match = sessions.find(session =>
      typeof session.hostname === 'string' &&
      session.hostname.trim().toLowerCase() === resourceIdLower
    );
    if (match) {
      return match;
    }
  }
  return null;
}

function isLikelyIp(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(trimmed)) {
    return trimmed.split('.').every(octet => {
      const numeric = Number(octet);
      return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255;
    });
  }
  if (trimmed.includes(':')) {
    // 簡易的な IPv6 判定。厳密なバリデーションは不要なため、コロンを含むかのみ確認。
    return /^[0-9a-fA-F:]+$/.test(trimmed);
  }
  return false;
}

function normalizeRemoteHostIp(value, fallbackHost = '') {
  if (value === null || value === undefined) {
    if (isLikelyIp(fallbackHost)) {
      return fallbackHost.trim();
    }
    return '';
  }
  const asString = String(value).trim();
  if (asString) {
    return asString;
  }
  if (isLikelyIp(fallbackHost)) {
    return fallbackHost.trim();
  }
  return '';
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const remoteAddress = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';
  if (remoteAddress.startsWith('::ffff:')) {
    return remoteAddress.slice(7);
  }
  return remoteAddress;
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(
      DATA_PATH,
      JSON.stringify({ sessions: [], sessionEvents: [] }, null, 2)
    );
    return;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid JSON structure');
    }
    if (!Array.isArray(parsed.sessions) || !Array.isArray(parsed.sessionEvents)) {
      const normalized = {
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        sessionEvents: Array.isArray(parsed.sessionEvents)
          ? parsed.sessionEvents
          : [],
      };
      fs.writeFileSync(DATA_PATH, JSON.stringify(normalized, null, 2));
    }
  } catch (error) {
    fs.writeFileSync(
      DATA_PATH,
      JSON.stringify({ sessions: [], sessionEvents: [] }, null, 2)
    );
  }
}

function loadDataFile() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf-8');
    const data = JSON.parse(raw);
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    const sessionEvents = Array.isArray(data.sessionEvents)
      ? data.sessionEvents
      : [];
    return { sessions, sessionEvents };
  } catch (error) {
    return { sessions: [], sessionEvents: [] };
  }
}

function saveDataFile(data) {
  ensureDataFile();
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const sessionEvents = Array.isArray(data.sessionEvents)
    ? data.sessionEvents
    : [];
  fs.writeFileSync(
    DATA_PATH,
    JSON.stringify({ sessions, sessionEvents }, null, 2)
  );
}

function loadSessions() {
  const { sessions } = loadDataFile();
  try {
    if (Array.isArray(sessions)) {
      return sessions.map(session => {
        if (!session || typeof session !== 'object') {
          return session;
        }
        const normalized = { ...session };
        if (!Array.isArray(normalized.expectedProcesses)) {
          normalized.expectedProcesses = [];
        } else {
          normalized.expectedProcesses = normalized.expectedProcesses
            .map(name => (typeof name === 'string' ? name.trim() : ''))
            .filter(name => name.length > 0);
        }
        if (normalized.remoteControlled === true) {
          normalized.remoteControlled = true;
        } else {
          normalized.remoteControlled = null;
        }
        if (typeof normalized.remoteHost !== 'string') {
          normalized.remoteHost = normalized.remoteHost ? String(normalized.remoteHost) : '';
        }
        if (typeof normalized.remoteHostIpAddress !== 'string') {
          normalized.remoteHostIpAddress = normalized.remoteHostIpAddress
            ? String(normalized.remoteHostIpAddress)
            : '';
        }
        if (typeof normalized.remoteUser !== 'string') {
          normalized.remoteUser = normalized.remoteUser ? String(normalized.remoteUser) : '';
        }
        if (typeof normalized.username !== 'string') {
          normalized.username = normalized.username ? String(normalized.username) : '';
        }
        if (typeof normalized.notes !== 'string') {
          normalized.notes = normalized.notes ? String(normalized.notes) : '';
        }
        if (!Array.isArray(normalized.processStatuses)) {
          normalized.processStatuses = [];
        } else {
          normalized.processStatuses = normalized.processStatuses
            .filter(entry => entry && typeof entry.name === 'string')
            .map(entry => {
              const trimmedName = entry.name.trim();
              const parsed = entry.lastChecked ? new Date(entry.lastChecked) : null;
              const iso = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : undefined;
              return {
                name: trimmedName,
                running: Boolean(entry.running),
                lastChecked: iso,
              };
            })
            .filter(entry => entry.name.length > 0);
        }
        if (typeof normalized.startedAt !== 'string') {
          normalized.startedAt = null;
        }
        if (typeof normalized.endedAt !== 'string') {
          normalized.endedAt = null;
        }
        if (typeof normalized.externalSessionId !== 'string') {
          normalized.externalSessionId = null;
        }
        if (typeof normalized.disconnectReason !== 'string') {
          normalized.disconnectReason = '';
        }
        if (
          normalized.lastIdleSeconds !== null &&
          normalized.lastIdleSeconds !== undefined
        ) {
          const parsed = Number(normalized.lastIdleSeconds);
          normalized.lastIdleSeconds = Number.isFinite(parsed)
            ? parsed
            : null;
        } else {
          normalized.lastIdleSeconds = null;
        }
        return normalized;
      });
    }
  } catch (error) {
    console.error('Failed to parse session data, resetting file', error);
  }
  return [];
}

function loadSessionEvents() {
  const { sessionEvents } = loadDataFile();
  if (!Array.isArray(sessionEvents)) {
    return [];
  }
  return sessionEvents
    .map(entry => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const normalized = { ...entry };
      normalized.id = typeof normalized.id === 'string' ? normalized.id : randomUUID();
      normalized.type = typeof normalized.type === 'string' ? normalized.type : 'unknown';
      normalized.timestamp =
        typeof normalized.timestamp === 'string'
          ? normalized.timestamp
          : new Date().toISOString();
      return normalized;
    })
    .filter(Boolean);
}

function saveSessions(sessions, sessionEvents = undefined) {
  const existing = loadDataFile();
  const eventsToSave =
    sessionEvents === undefined ? existing.sessionEvents : sessionEvents;
  saveDataFile({ sessions, sessionEvents: eventsToSave });
}

function sendJSON(res, statusCode, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function collectRequestData(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error('Request body too large'));
        req.connection.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (error) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function getIfMatchHeader(req) {
  const header = req.headers['if-match'];
  if (!header) {
    return null;
  }
  if (Array.isArray(header)) {
    return header.length > 0 ? String(header[0]) : null;
  }
  const token = String(header).trim();
  return token.length > 0 ? token : null;
}

function isConcurrencyConflict(req, session) {
  const token = getIfMatchHeader(req);
  return Boolean(token && session && token !== session.lastUpdated);
}

function sendConcurrencyConflict(res) {
  sendJSON(res, 409, {
    error: '他のユーザーが先に更新しました。画面を再読み込みして再度操作してください。',
  });
}

function serveStatic(req, res) {
  let filePath = url.parse(req.url).pathname || '/';
  if (filePath === '/') {
    filePath = '/index.html';
  }
  const resolvedPath = path.join(PUBLIC_DIR, path.normalize(filePath).replace(/^\/+/, ''));
  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(resolvedPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml; charset=utf-8',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const method = req.method || 'GET';
  const pathname = parsedUrl.pathname || '';

  if (pathname.startsWith('/api/')) {
    try {
      const sessions = loadSessions();
      if (method === 'GET' && pathname === '/api/sessions') {
        sendJSON(res, 200, { sessions });
        return;
      }

      if (method === 'POST' && pathname === '/api/sessions') {
        const payload = await collectRequestData(req);
        if (!payload.hostname || !payload.ipAddress) {
          sendJSON(res, 400, { error: 'hostname and ipAddress are required' });
          return;
        }
        const now = new Date().toISOString();
        const expectedProcesses = normalizeStringList(payload.expectedProcesses);
        const processStatuses = normalizeProcessStatuses(payload.processStatuses).map(entry => ({
          ...entry,
          lastChecked: now,
        }));
        const { value: initialRemoteControlled } = detectRemoteControlled(payload);
        const remoteHostRaw = payload.remoteHost ? String(payload.remoteHost) : '';
        const remoteHostIpInput =
          payload.remoteHostIpAddress ??
          payload.remoteHostIp ??
          payload.remoteIpAddress ??
          payload.remoteIp ??
          null;
        const session = {
          id: randomUUID(),
          hostname: String(payload.hostname),
          ipAddress: String(payload.ipAddress),
          username: payload.username ? String(payload.username) : '',
          remoteUser: payload.remoteUser ? String(payload.remoteUser) : '',
          remoteHost: remoteHostRaw,
          remoteHostIpAddress: normalizeRemoteHostIp(remoteHostIpInput, remoteHostRaw),
          remoteControlled: initialRemoteControlled === true ? true : null,
          status: payload.status === 'disconnected' ? 'disconnected' : 'connected',
          lastUpdated: now,
          lastSeen: now,
          notes: payload.notes ? String(payload.notes) : '',
          expectedProcesses,
          processStatuses,
        };
        sessions.push(session);
        saveSessions(sessions);
        await notifySessionEvent(
          'created',
          session,
          buildNotificationContext(req, { trigger: 'manual-create' })
        );
        sendJSON(res, 201, { session });
        return;
      }

      if ((method === 'POST' || method === 'GET') && pathname === '/api/sessions/auto-heartbeat') {
        let bodyPayload = {};
        if (method === 'POST') {
          try {
            bodyPayload = await collectRequestData(req);
          } catch (error) {
            sendJSON(res, 400, { error: error.message });
            return;
          }
        }

        const combinedPayload = { ...parsedUrl.query, ...bodyPayload };
        const clientIp = getClientIp(req);
        if (!clientIp) {
          sendJSON(res, 400, { error: 'Unable to determine client IP address' });
          return;
        }

        const now = new Date().toISOString();
        const hostname = combinedPayload.hostname ? String(combinedPayload.hostname) : clientIp;
        const username = combinedPayload.username ? String(combinedPayload.username) : '';
        const hasRemoteHostField = Object.prototype.hasOwnProperty.call(
          combinedPayload,
          'remoteHost'
        );
        const remoteHost = hasRemoteHostField
          ? combinedPayload.remoteHost === null || combinedPayload.remoteHost === undefined
            ? ''
            : String(combinedPayload.remoteHost)
          : '';
        const remoteHostIpKeys = [
          'remoteHostIpAddress',
          'remoteHostIp',
          'remoteIpAddress',
          'remoteIp',
          'remoteHostAddress',
          'connectionSourceIp',
          'accessHostIp',
        ];
        const remoteHostIpKey = remoteHostIpKeys.find(key =>
          Object.prototype.hasOwnProperty.call(combinedPayload, key)
        );
        const remoteHostIpInput =
          remoteHostIpKey !== undefined ? combinedPayload[remoteHostIpKey] : undefined;
        const remoteHostIpAddress = normalizeRemoteHostIp(remoteHostIpInput, remoteHost);
        const hasRemoteHostIpField =
          remoteHostIpKey !== undefined || (hasRemoteHostField && isLikelyIp(remoteHost));
        const hasRemoteUserField = Object.prototype.hasOwnProperty.call(
          combinedPayload,
          'remoteUser'
        );
        const remoteUser = hasRemoteUserField
          ? combinedPayload.remoteUser === null || combinedPayload.remoteUser === undefined
            ? ''
            : String(combinedPayload.remoteUser)
          : '';
        const notes = combinedPayload.notes ? String(combinedPayload.notes) : '';
        const expectedProcesses = normalizeStringList(combinedPayload.expectedProcesses);
        const runningProcesses = Array.from(
          new Set(
            normalizeStringList(combinedPayload.runningProcesses || combinedPayload.processes)
          )
        );
        const reportedProcessStatuses = normalizeProcessStatuses(combinedPayload.processStatuses);

        let session = sessions.find(current => current.ipAddress === clientIp);
        if (!session && combinedPayload.hostname) {
          session = sessions.find(current => current.hostname === hostname);
        }

        const hadSession = Boolean(session);
        const previousRemoteControlled = hadSession ? session.remoteControlled : undefined;
        const remoteControlDetection = detectRemoteControlled(
          { ...combinedPayload, clientIp },
          previousRemoteControlled
        );
        const previousStatus = hadSession ? session.status : null;
        const previousRemoteHost = hadSession && typeof session.remoteHost === 'string' ? session.remoteHost : '';
        const previousRemoteUser = hadSession && typeof session.remoteUser === 'string' ? session.remoteUser : '';
        const previousRemoteHostIpAddress =
          hadSession && typeof session.remoteHostIpAddress === 'string'
            ? session.remoteHostIpAddress
            : '';

        if (session) {
          session.hostname = hostname || session.hostname;
          if (username) {
            session.username = username;
          }
          if (hasRemoteHostField) {
            session.remoteHost = remoteHost;
          }
          if (hasRemoteHostIpField) {
            session.remoteHostIpAddress = remoteHostIpAddress;
          }
          if (hasRemoteUserField) {
            session.remoteUser = remoteUser;
          }
          if (notes) {
            session.notes = notes;
          }
          session.ipAddress = clientIp;
          session.status = 'connected';
          session.lastSeen = now;
          session.lastUpdated = now;
          if (
            remoteControlDetection.explicit ||
            session.remoteControlled == null
          ) {
            session.remoteControlled =
              remoteControlDetection.value === true ? true : null;
          } else if (
            remoteControlDetection.value === true &&
            session.remoteControlled !== true
          ) {
            session.remoteControlled = true;
          }
          if (!Array.isArray(session.expectedProcesses)) {
            session.expectedProcesses = [];
          }
          if (!Array.isArray(session.processStatuses)) {
            session.processStatuses = [];
          }
          if (expectedProcesses.length > 0) {
            session.expectedProcesses = expectedProcesses;
          }
          if (reportedProcessStatuses.length > 0) {
            session.processStatuses = reportedProcessStatuses.map(entry => ({
              ...entry,
              lastChecked: now,
            }));
          } else if (runningProcesses.length > 0) {
            const runningSet = new Set(runningProcesses.map(name => name.toLowerCase()));
            const trackedNames =
              session.expectedProcesses && session.expectedProcesses.length > 0
                ? session.expectedProcesses
                : runningProcesses;
            session.processStatuses = trackedNames.map(name => ({
              name,
              running: runningSet.has(name.toLowerCase()),
              lastChecked: now,
            }));
          }
        } else {
          session = {
            id: randomUUID(),
            hostname,
            ipAddress: clientIp,
            username,
            remoteUser,
            remoteHost,
            remoteHostIpAddress: hasRemoteHostIpField ? remoteHostIpAddress : '',
            remoteControlled: remoteControlDetection.value === true ? true : null,
            status: 'connected',
            lastUpdated: now,
            lastSeen: now,
            notes,
            expectedProcesses,
            processStatuses:
              reportedProcessStatuses.length > 0
                ? reportedProcessStatuses.map(entry => ({ ...entry, lastChecked: now }))
                : runningProcesses.map(name => ({ name, running: true, lastChecked: now })),
          };
          sessions.push(session);
        }

        saveSessions(sessions);
        let eventType = null;
        if (!hadSession) {
          eventType = 'created';
        } else if (previousStatus !== 'connected') {
          eventType = 'connected';
        } else if (
          (remoteHost && remoteHost !== previousRemoteHost) ||
          (remoteUser && remoteUser !== previousRemoteUser) ||
          (hasRemoteHostIpField && remoteHostIpAddress !== previousRemoteHostIpAddress)
        ) {
          eventType = 'connected';
        }
        if (eventType) {
          await notifySessionEvent(
            eventType,
            session,
            buildNotificationContext(req, { trigger: 'auto-heartbeat' })
          );
        }
        sendJSON(res, 200, { session });
        return;
      }

      if (method === 'POST' && pathname === '/api/sessions/start') {
        const payload = await collectRequestData(req);
        const timestamp = new Date().toISOString();
        const sessionId = toOptionalString(payload.sessionId ?? payload.sessionName);
        const resourceId = toOptionalString(payload.resourceId ?? payload.hostname);
        const userId = toOptionalString(payload.userId ?? payload.username);
        const channel = toOptionalString(payload.channel);
        const clientEnvironmentPayload =
          payload && typeof payload.clientEnvironment === 'object'
            ? payload.clientEnvironment
            : {};
        const clientEnvironment = {};
        const clientOs =
          toOptionalString(clientEnvironmentPayload.operatingSystem) ||
          toOptionalString(payload.clientOperatingSystem);
        const clientApp =
          toOptionalString(clientEnvironmentPayload.application) ||
          toOptionalString(payload.clientApplication);
        if (clientOs) {
          clientEnvironment.operatingSystem = clientOs;
        }
        if (clientApp) {
          clientEnvironment.application = clientApp;
        }
        const mfaResult = toOptionalString(
          payload?.authentication && typeof payload.authentication === 'object'
            ? payload.authentication.mfa
            : payload?.mfaResult
        );

        const sessions = loadSessions();
        const sessionEvents = loadSessionEvents();

        const event = {
          id: randomUUID(),
          type: 'session.start',
          timestamp,
          sessionId,
          resourceId,
          userId,
        };
        if (channel) {
          event.channel = channel;
        }
        if (Object.keys(clientEnvironment).length > 0) {
          event.clientEnvironment = clientEnvironment;
        }
        if (mfaResult) {
          event.mfaResult = mfaResult;
        }
        if (payload && typeof payload === 'object') {
          event.payload = sanitizeEventPayload(payload);
        }

        sessionEvents.push(event);

        let targetSession = findSessionForEvent(sessions, { sessionId, resourceId });
        const previousStatus = targetSession ? targetSession.status : null;
        let createdSession = false;
        if (!targetSession) {
          targetSession = {
            id: randomUUID(),
            hostname: resourceId || '',
            ipAddress: '',
            username: userId || '',
            remoteUser: '',
            remoteHost: '',
            remoteHostIpAddress: '',
            remoteControlled: null,
            status: 'connected',
            lastUpdated: timestamp,
            lastSeen: timestamp,
            startedAt: timestamp,
            endedAt: null,
            disconnectReason: '',
            notes: '',
            expectedProcesses: [],
            processStatuses: [],
          };
          sessions.push(targetSession);
          createdSession = true;
        }

        if (sessionId) {
          targetSession.externalSessionId = sessionId;
        }
        if (resourceId && !targetSession.hostname) {
          targetSession.hostname = resourceId;
        }
        if (userId && !targetSession.username) {
          targetSession.username = userId;
        }
        targetSession.status = 'connected';
        targetSession.lastUpdated = timestamp;
        targetSession.lastSeen = timestamp;
        targetSession.startedAt = timestamp;
        targetSession.endedAt = null;
        targetSession.disconnectReason = '';

        saveSessions(sessions, sessionEvents);

        let eventType = null;
        if (createdSession) {
          eventType = 'created';
        } else if (previousStatus !== 'connected') {
          eventType = 'connected';
        }
        if (eventType) {
          await notifySessionEvent(
            eventType,
            targetSession,
            buildNotificationContext(req, { trigger: 'session-start-event' })
          );
        }
        sendJSON(res, 202, { accepted: true, eventId: event.id });
        return;
      }

      if (method === 'POST' && pathname === '/api/sessions/end') {
        const payload = await collectRequestData(req);
        const timestamp = new Date().toISOString();
        const sessionId = toOptionalString(payload.sessionId ?? payload.sessionName);
        const resourceId = toOptionalString(payload.resourceId ?? payload.hostname);
        const userId = toOptionalString(payload.userId ?? payload.username);
        const disconnectReason = toOptionalString(payload.disconnectReason);
        const sessionDurationSeconds = toOptionalNumber(payload.sessionDurationSeconds);
        const secondsSinceLastHeartbeat = toOptionalNumber(
          payload.secondsSinceLastHeartbeat
        );
        const lastIdleSeconds = toOptionalNumber(payload.lastObservedIdleSeconds);
        const resourceMetrics = sanitizeResourceMetrics(payload.resourceMetrics);

        const sessions = loadSessions();
        const sessionEvents = loadSessionEvents();

        const event = {
          id: randomUUID(),
          type: 'session.end',
          timestamp,
          sessionId,
          resourceId,
          userId,
        };
        if (disconnectReason) {
          event.disconnectReason = disconnectReason;
        }
        if (sessionDurationSeconds !== null) {
          event.sessionDurationSeconds = sessionDurationSeconds;
        }
        if (secondsSinceLastHeartbeat !== null) {
          event.secondsSinceLastHeartbeat = secondsSinceLastHeartbeat;
        }
        if (lastIdleSeconds !== null) {
          event.lastObservedIdleSeconds = lastIdleSeconds;
        }
        if (resourceMetrics) {
          event.resourceMetrics = resourceMetrics;
        }
        if (payload && typeof payload === 'object') {
          event.payload = sanitizeEventPayload(payload);
        }

        sessionEvents.push(event);

        const targetSession = findSessionForEvent(sessions, { sessionId, resourceId });
        let previousRemoteControlled = null;
        if (targetSession) {
          previousRemoteControlled = targetSession.remoteControlled;
          targetSession.status = 'disconnected';
          targetSession.lastUpdated = timestamp;
          targetSession.lastSeen = timestamp;
          targetSession.endedAt = timestamp;
          targetSession.remoteControlled = null;
          if (disconnectReason) {
            targetSession.disconnectReason = disconnectReason;
          }
          if (sessionId) {
            targetSession.externalSessionId = sessionId;
          }
          if (userId && !targetSession.username) {
            targetSession.username = userId;
          }
          targetSession.lastIdleSeconds = lastIdleSeconds;
        }

        saveSessions(sessions, sessionEvents);
        if (targetSession) {
          const sessionForNotification = {
            ...targetSession,
            remoteControlled: previousRemoteControlled,
          };
          const notificationContext = buildNotificationContext(req, {
            trigger: 'session-end-event',
            disconnectReason,
            sessionDurationSeconds,
            secondsSinceLastHeartbeat,
            lastIdleSeconds,
            resourceMetrics,
          });
          await notifySessionEvent('ended', sessionForNotification, notificationContext);
        }
        sendJSON(res, 200, { accepted: true, eventId: event.id });
        return;
      }

      const sessionIdMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)(?:\/(heartbeat|announce))?$/);
      if (sessionIdMatch) {
        const sessionId = sessionIdMatch[1];
        const action = sessionIdMatch[2];
        const index = sessions.findIndex(session => session.id === sessionId);
        if (index === -1) {
          sendJSON(res, 404, { error: 'Session not found' });
          return;
        }
        const session = sessions[index];

        if (method === 'PUT' && !action) {
          if (isConcurrencyConflict(req, session)) {
            sendConcurrencyConflict(res);
            return;
          }
          const payload = await collectRequestData(req);
          const previousStatus = session.status;
          const previousRemoteHost = typeof session.remoteHost === 'string' ? session.remoteHost : '';
          const previousRemoteUser = typeof session.remoteUser === 'string' ? session.remoteUser : '';
          const previousRemoteHostIpAddress =
            typeof session.remoteHostIpAddress === 'string' ? session.remoteHostIpAddress : '';
          let updated = false;
          if (payload.hostname) {
            session.hostname = String(payload.hostname);
            updated = true;
          }
          if (payload.ipAddress) {
            session.ipAddress = String(payload.ipAddress);
            updated = true;
          }
          if (payload.username !== undefined) {
            session.username = String(payload.username);
            updated = true;
          }
          if (payload.remoteHost !== undefined) {
            session.remoteHost = String(payload.remoteHost);
            updated = true;
          }
          if (
            payload.remoteHostIpAddress !== undefined ||
            payload.remoteHostIp !== undefined ||
            payload.remoteIpAddress !== undefined ||
            payload.remoteIp !== undefined
          ) {
            const remoteHostIpInput =
              payload.remoteHostIpAddress ??
              payload.remoteHostIp ??
              payload.remoteIpAddress ??
              payload.remoteIp;
            session.remoteHostIpAddress = normalizeRemoteHostIp(remoteHostIpInput, session.remoteHost);
            updated = true;
          }
          if (payload.remoteUser !== undefined) {
            session.remoteUser = String(payload.remoteUser);
            updated = true;
          }
          if (payload.remoteControlled !== undefined) {
            const normalizedRemoteControlled = normalizeBoolean(payload.remoteControlled);
            session.remoteControlled = normalizedRemoteControlled === true ? true : null;
            updated = true;
          }
          if (payload.notes !== undefined) {
            session.notes = String(payload.notes);
            updated = true;
          }
          if (payload.expectedProcesses !== undefined) {
            session.expectedProcesses = normalizeStringList(payload.expectedProcesses);
            updated = true;
          }
          if (payload.processStatuses !== undefined) {
            const normalizedStatuses = normalizeProcessStatuses(payload.processStatuses).map(entry => ({
              ...entry,
              lastChecked: new Date().toISOString(),
            }));
            session.processStatuses = normalizedStatuses;
            updated = true;
          }
          if (payload.status) {
            const status = payload.status === 'disconnected' ? 'disconnected' : 'connected';
            if (session.status !== status) {
              session.status = status;
              session.lastUpdated = new Date().toISOString();
            }
            updated = true;
          }
          if (payload.lastSeen) {
            session.lastSeen = new Date(payload.lastSeen).toISOString();
            updated = true;
          }
          if (updated) {
            session.lastUpdated = new Date().toISOString();
            sessions[index] = session;
            saveSessions(sessions);
            let eventType = null;
            if (session.status === 'connected' && previousStatus !== 'connected') {
              eventType = 'connected';
            } else if (
              (payload.remoteHost !== undefined && session.remoteHost && session.remoteHost !== previousRemoteHost) ||
              (payload.remoteUser !== undefined && session.remoteUser && session.remoteUser !== previousRemoteUser) ||
              ((
                payload.remoteHostIpAddress !== undefined ||
                payload.remoteHostIp !== undefined ||
                payload.remoteIpAddress !== undefined ||
                payload.remoteIp !== undefined
              ) &&
                session.remoteHostIpAddress &&
                session.remoteHostIpAddress !== previousRemoteHostIpAddress)
            ) {
              eventType = 'connected';
            }
            if (eventType) {
              await notifySessionEvent(
                eventType,
                session,
                buildNotificationContext(req, { trigger: 'manual-update' })
              );
            }
          }
          sendJSON(res, 200, { session });
          return;
        }

        if (method === 'POST' && action === 'heartbeat') {
          if (isConcurrencyConflict(req, session)) {
            sendConcurrencyConflict(res);
            return;
          }
          session.lastSeen = new Date().toISOString();
          session.status = 'connected';
          session.lastUpdated = session.lastSeen;
          sessions[index] = session;
          saveSessions(sessions);
          sendJSON(res, 200, { session });
          return;
        }

        if (method === 'POST' && action === 'announce') {
          if (isConcurrencyConflict(req, session)) {
            sendConcurrencyConflict(res);
            return;
          }
          session.lastUpdated = new Date().toISOString();
          sessions[index] = session;
          saveSessions(sessions);
          await notifySessionEvent(
            'usage-intent',
            session,
            buildNotificationContext(req, { trigger: 'manual-announce' })
          );
          sendJSON(res, 200, { session, slackEnabled: Boolean(slackWebhook) });
          return;
        }

        if (method === 'DELETE' && !action) {
          if (isConcurrencyConflict(req, session)) {
            sendConcurrencyConflict(res);
            return;
          }
          sessions.splice(index, 1);
          saveSessions(sessions);
          sendJSON(res, 204, {});
          return;
        }
      }

      sendJSON(res, 404, { error: 'Not found' });
    } catch (error) {
      console.error('API error', error);
      sendJSON(res, 500, { error: 'Internal server error' });
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
