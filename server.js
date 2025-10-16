const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { randomUUID } = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_PATH = path.join(DATA_DIR, 'sessions.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

let slackWebhook = null;
if (process.env.SLACK_WEBHOOK_URL) {
  try {
    slackWebhook = new URL(process.env.SLACK_WEBHOOK_URL);
  } catch (error) {
    console.error('Invalid Slack webhook URL provided; disabling Slack notifications.', error.message);
  }
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
  }

  const lines = [
    headline,
    `端末: ${session.hostname || '(名称未設定)'} (${session.ipAddress || 'IP不明'})`,
    session.username ? `ローカルユーザー: ${session.username}` : '',
    session.remoteUser ? `リモートユーザー: ${session.remoteUser}` : '',
    session.remoteHost ? `接続元ホスト: ${session.remoteHost}` : '',
    session.notes ? `備考: ${session.notes}` : '',
    ...extraLines,
    context.trigger ? `トリガー: ${context.trigger}` : '',
  ].filter(Boolean);

  try {
    await postSlackMessage({ text: lines.join('\n') });
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
    fs.writeFileSync(DATA_PATH, JSON.stringify({ sessions: [] }, null, 2));
  }
}

function loadSessions() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data.sessions)) {
      return data.sessions.map(session => {
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
        if (typeof normalized.remoteHost !== 'string') {
          normalized.remoteHost = normalized.remoteHost ? String(normalized.remoteHost) : '';
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
        return normalized;
      });
    }
  } catch (error) {
    console.error('Failed to parse session data, resetting file', error);
  }
  return [];
}

function saveSessions(sessions) {
  ensureDataFile();
  fs.writeFileSync(DATA_PATH, JSON.stringify({ sessions }, null, 2));
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
        const session = {
          id: randomUUID(),
          hostname: String(payload.hostname),
          ipAddress: String(payload.ipAddress),
          username: payload.username ? String(payload.username) : '',
          remoteUser: payload.remoteUser ? String(payload.remoteUser) : '',
          remoteHost: payload.remoteHost ? String(payload.remoteHost) : '',
          status: payload.status === 'disconnected' ? 'disconnected' : 'connected',
          lastUpdated: now,
          lastSeen: now,
          notes: payload.notes ? String(payload.notes) : '',
          expectedProcesses,
          processStatuses,
        };
        sessions.push(session);
        saveSessions(sessions);
        await notifySessionEvent('created', session, { trigger: 'manual-create' });
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
        const remoteHost = combinedPayload.remoteHost ? String(combinedPayload.remoteHost) : '';
        const remoteUser = combinedPayload.remoteUser ? String(combinedPayload.remoteUser) : '';
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
        const previousStatus = hadSession ? session.status : null;
        const previousRemoteHost = hadSession && typeof session.remoteHost === 'string' ? session.remoteHost : '';
        const previousRemoteUser = hadSession && typeof session.remoteUser === 'string' ? session.remoteUser : '';

        if (session) {
          session.hostname = hostname || session.hostname;
          if (username) {
            session.username = username;
          }
          if (remoteHost) {
            session.remoteHost = remoteHost;
          }
          if (remoteUser) {
            session.remoteUser = remoteUser;
          } else if (typeof session.remoteUser !== 'string') {
            session.remoteUser = '';
          }
          if (notes) {
            session.notes = notes;
          }
          session.ipAddress = clientIp;
          session.status = 'connected';
          session.lastSeen = now;
          session.lastUpdated = now;
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
          (remoteUser && remoteUser !== previousRemoteUser)
        ) {
          eventType = 'connected';
        }
        if (eventType) {
          await notifySessionEvent(eventType, session, { trigger: 'auto-heartbeat' });
        }
        sendJSON(res, 200, { session });
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
          const payload = await collectRequestData(req);
          const previousStatus = session.status;
          const previousRemoteHost = typeof session.remoteHost === 'string' ? session.remoteHost : '';
          const previousRemoteUser = typeof session.remoteUser === 'string' ? session.remoteUser : '';
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
          if (payload.remoteUser !== undefined) {
            session.remoteUser = String(payload.remoteUser);
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
              (payload.remoteUser !== undefined && session.remoteUser && session.remoteUser !== previousRemoteUser)
            ) {
              eventType = 'connected';
            }
            if (eventType) {
              await notifySessionEvent(eventType, session, { trigger: 'manual-update' });
            }
          }
          sendJSON(res, 200, { session });
          return;
        }

        if (method === 'POST' && action === 'heartbeat') {
          session.lastSeen = new Date().toISOString();
          session.status = 'connected';
          session.lastUpdated = session.lastSeen;
          sessions[index] = session;
          saveSessions(sessions);
          sendJSON(res, 200, { session });
          return;
        }

        if (method === 'POST' && action === 'announce') {
          session.lastUpdated = new Date().toISOString();
          sessions[index] = session;
          saveSessions(sessions);
          await notifySessionEvent('usage-intent', session, { trigger: 'manual-announce' });
          sendJSON(res, 200, { session, slackEnabled: Boolean(slackWebhook) });
          return;
        }

        if (method === 'DELETE' && !action) {
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
