const API_BASE = '';

const tableBody = document.querySelector('#session-table tbody');
const totalCountEl = document.getElementById('total-count');
const connectedCountEl = document.getElementById('connected-count');
const disconnectedCountEl = document.getElementById('disconnected-count');
const refreshButton = document.getElementById('refresh-button');
const createForm = document.getElementById('create-form');

function escapeHtml(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateTime(isoString) {
  if (!isoString) return '-';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function formatRelative(isoString) {
  if (!isoString) return '-';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (Number.isNaN(diffMs)) return '-';
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return '1分未満前';
  if (diffMinutes < 60) return `${diffMinutes}分前`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}時間前`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}日前`;
}

function renderRemoteControlState(value) {
  if (value === true) {
    return '<span class="badge remote">遠隔操作中</span>';
  }
  return '<span class="badge unknown">未判定</span>';
}

function renderRemoteHostCell(session) {
  const ip = session.remoteHostIpAddress ? escapeHtml(session.remoteHostIpAddress) : '';
  const host = session.remoteHost ? escapeHtml(session.remoteHost) : '';
  if (ip && host && ip !== host) {
    return `<div class="remote-host-cell"><span class="ip">${ip}</span><small class="muted">${host}</small></div>`;
  }
  if (ip) {
    return ip;
  }
  if (host) {
    return `<span class="muted">${host}</span>`;
  }
  return '<span class="muted">-</span>';
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body.error) {
        message += `: ${body.error}`;
      }
    } catch (_) {
      // ignore
    }
    throw new Error(message);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

function renderSessions(sessions) {
  tableBody.innerHTML = '';
  sessions
    .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
    .forEach(session => {
      const tr = document.createElement('tr');
      tr.classList.add(`status-${session.status}`);
      const processCellHtml = renderProcessCell(session);
      const remoteControlHtml = renderRemoteControlState(session.remoteControlled);
      const remoteHostHtml = renderRemoteHostCell(session);
      const statusBadgeHtml = `<span class="badge ${session.status}">${
        session.status === 'connected' ? '接続中' : '切断'
      }</span>`;
      tr.innerHTML = `
        <td>
          <div class="hostname-cell">
            <span class="hostname">${escapeHtml(session.hostname ?? '')}</span>
            ${statusBadgeHtml}
          </div>
        </td>
        <td>${escapeHtml(session.ipAddress ?? '')}</td>
        <td>${escapeHtml(session.username ?? '')}</td>
        <td>${remoteHostHtml}</td>
        <td>${remoteControlHtml}</td>
        <td>
          <div>${formatRelative(session.lastSeen)}</div>
          <small class="muted">${formatDateTime(session.lastSeen)}</small>
        </td>
        <td>${formatDateTime(session.lastUpdated)}</td>
        <td class="process-cell">${processCellHtml}</td>
        <td class="actions"></td>
      `;

      const actionsCell = tr.querySelector('.actions');

      const announceButton = document.createElement('button');
      announceButton.textContent = '利用予定を通知';
      announceButton.addEventListener('click', async () => {
        announceButton.disabled = true;
        try {
          const result = await request(`${API_BASE}/api/sessions/${session.id}/announce`, {
            method: 'POST',
          });
          const slackEnabled = Boolean(result && result.slackEnabled);
          await loadSessions();
          alert(
            slackEnabled
              ? 'Slack に利用予定を通知しました。'
              : 'Slack Webhook が設定されていないため通知は送信されませんでした。'
          );
        } catch (error) {
          alert(`利用予定の通知に失敗しました: ${error.message}`);
        } finally {
          announceButton.disabled = false;
        }
      });

      const heartbeatButton = document.createElement('button');
      heartbeatButton.textContent = 'ハートビート';
      heartbeatButton.classList.add('secondary');
      heartbeatButton.addEventListener('click', async () => {
        heartbeatButton.disabled = true;
        try {
          await request(`${API_BASE}/api/sessions/${session.id}/heartbeat`, { method: 'POST' });
          await loadSessions();
        } catch (error) {
          alert(`ハートビート送信に失敗しました: ${error.message}`);
        } finally {
          heartbeatButton.disabled = false;
        }
      });

      const toggleButton = document.createElement('button');
      toggleButton.textContent = session.status === 'connected' ? '切断に変更' : '接続中に変更';
      toggleButton.classList.add('secondary');
      toggleButton.addEventListener('click', async () => {
        toggleButton.disabled = true;
        try {
          const newStatus = session.status === 'connected' ? 'disconnected' : 'connected';
          await request(`${API_BASE}/api/sessions/${session.id}`, {
            method: 'PUT',
            body: JSON.stringify({ status: newStatus }),
          });
          await loadSessions();
        } catch (error) {
          alert(`状態変更に失敗しました: ${error.message}`);
        } finally {
          toggleButton.disabled = false;
        }
      });

      const deleteButton = document.createElement('button');
      deleteButton.textContent = '削除';
      deleteButton.addEventListener('click', async () => {
        if (!confirm(`端末 ${session.hostname} を削除しますか？`)) {
          return;
        }
        deleteButton.disabled = true;
        try {
          await request(`${API_BASE}/api/sessions/${session.id}`, { method: 'DELETE' });
          await loadSessions();
        } catch (error) {
          alert(`削除に失敗しました: ${error.message}`);
        } finally {
          deleteButton.disabled = false;
        }
      });

      actionsCell.append(announceButton, heartbeatButton, toggleButton, deleteButton);
      tableBody.appendChild(tr);
    });

  totalCountEl.textContent = sessions.length;
  const connectedCount = sessions.filter(session => session.status === 'connected').length;
  const disconnectedCount = sessions.length - connectedCount;
  connectedCountEl.textContent = connectedCount;
  disconnectedCountEl.textContent = disconnectedCount;
}

function normalizeProcessNamesInput(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  const unique = new Set();
  String(value)
    .split(',')
    .map(name => name.trim())
    .filter(name => name.length > 0)
    .forEach(name => unique.add(name));
  return Array.from(unique);
}

function normalizeBooleanInput(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return undefined;
  if (['true', '1', 'yes', 'y', 'on', 'remote', 'rdp'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off', 'local', 'console'].includes(normalized)) return null;
  if (['null', 'unknown', 'unset'].includes(normalized)) return null;
  return undefined;
}

function renderProcessCell(session) {
  const statuses = Array.isArray(session.processStatuses) ? session.processStatuses : [];
  const expected = Array.isArray(session.expectedProcesses) ? session.expectedProcesses : [];
  if (statuses.length === 0) {
    if (expected.length === 0) {
      return '<span class="muted">-</span>';
    }
    return `
      <div class="muted">未報告</div>
      <small class="muted">監視対象: ${escapeHtml(expected.join(', '))}</small>
    `;
  }
  const rows = statuses
    .map(status => {
      const isRunning = Boolean(status.running);
      const name = escapeHtml(status.name ?? '');
      const label = isRunning ? '起動中' : '停止';
      return `
        <div class="process-row ${isRunning ? 'running' : 'stopped'}">
          <span class="indicator"></span>
          <span class="name">${name}</span>
          <span class="state">${label}</span>
        </div>
      `;
    })
    .join('');
  let lastCheckedText = '';
  const timestamps = statuses
    .map(status => {
      if (!status.lastChecked) return null;
      const parsed = new Date(status.lastChecked);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed.toISOString();
    })
    .filter(Boolean)
    .sort()
    .reverse();
  if (timestamps.length > 0) {
    lastCheckedText = `<small class="muted">${formatDateTime(timestamps[0])} 更新</small>`;
  }
  const expectedText = expected.length
    ? `<small class="muted">監視対象: ${escapeHtml(expected.join(', '))}</small>`
    : '';
  return `
    <div class="process-status-list">${rows}</div>
    ${lastCheckedText}
    ${expectedText}
  `;
}

async function loadSessions() {
  refreshButton.disabled = true;
  try {
    const data = await request(`${API_BASE}/api/sessions`, { method: 'GET' });
    renderSessions(data.sessions ?? []);
  } catch (error) {
    alert(`一覧の取得に失敗しました: ${error.message}`);
  } finally {
    refreshButton.disabled = false;
  }
}

createForm.addEventListener('submit', async event => {
  event.preventDefault();
  const formData = new FormData(createForm);
  const payload = Object.fromEntries(formData.entries());
  if (payload.expectedProcesses) {
    payload.expectedProcesses = normalizeProcessNamesInput(payload.expectedProcesses);
  }
  if (payload.remoteControlled !== undefined) {
    const normalizedRemote = normalizeBooleanInput(payload.remoteControlled);
    if (normalizedRemote === undefined) {
      delete payload.remoteControlled;
    } else {
      payload.remoteControlled = normalizedRemote;
    }
  }
  refreshButton.disabled = true;
  try {
    await request(`${API_BASE}/api/sessions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    createForm.reset();
    await loadSessions();
  } catch (error) {
    alert(`登録に失敗しました: ${error.message}`);
  } finally {
    refreshButton.disabled = false;
  }
});

refreshButton.addEventListener('click', loadSessions);

setInterval(loadSessions, 30000);

loadSessions();
