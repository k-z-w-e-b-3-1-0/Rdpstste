const API_BASE = '';

const tableBody = document.querySelector('#session-table tbody');
const totalCountEl = document.getElementById('total-count');
const connectedCountEl = document.getElementById('connected-count');
const disconnectedCountEl = document.getElementById('disconnected-count');
const refreshButton = document.getElementById('refresh-button');
const createForm = document.getElementById('create-form');

const announceEffect = window.p5
  ? new window.p5(p => {
      let particles = [];

      const effectFactories = [
        (x, y) => {
          const particleCount = 24;
          const hueShift = p.random(-20, 20);
          for (let i = 0; i < particleCount; i += 1) {
            const angle = (p.TWO_PI * i) / particleCount + p.random(-0.15, 0.15);
            const speed = p.random(2.5, 6.5);
            particles.push({
              effectType: 'burst',
              x,
              y,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              friction: 0.94,
              life: 1,
              decay: 0.028,
              size: p.random(14, 26),
              color: [74 + hueShift, 144 + hueShift * 0.5, 226],
            });
          }
        },
        (x, y) => {
          const ringCount = 3;
          for (let i = 0; i < ringCount; i += 1) {
            particles.push({
              effectType: 'ring',
              x,
              y,
              radius: 0,
              growth: p.random(3, 5) + i,
              life: 1,
              decay: 0.022,
              strokeWeight: p.random(2, 4),
              color: [120, 200, 255],
            });
          }
        },
        (x, y) => {
          const palette = [
            [244, 132, 92],
            [255, 200, 87],
            [147, 197, 253],
            [112, 206, 140],
          ];
          const count = 18;
          for (let i = 0; i < count; i += 1) {
            const color = palette[Math.floor(p.random(palette.length))];
            particles.push({
              effectType: 'confetti',
              x,
              y,
              vx: p.random(-2.5, 2.5),
              vy: p.random(-1.5, -0.5),
              rotation: p.random(p.TWO_PI),
              rotationSpeed: p.random(-0.2, 0.2),
              size: p.random(6, 12),
              life: 1,
              decay: 0.025,
              gravity: 0.18,
              color,
            });
          }
        },
        (x, y) => {
          const sparkleCount = 14;
          for (let i = 0; i < sparkleCount; i += 1) {
            particles.push({
              effectType: 'sparkle',
              x: x + p.random(-8, 8),
              y: y + p.random(-8, 8),
              jitter: p.random(0.3, 1.2),
              pulseSpeed: p.random(0.08, 0.16),
              pulseOffset: p.random(p.TWO_PI),
              size: p.random(4, 9),
              life: 1,
              decay: 0.035,
              color: [255, 255, 210],
            });
          }
        },
        (x, y) => {
          const rayCount = 12;
          for (let i = 0; i < rayCount; i += 1) {
            const angle = (p.TWO_PI * i) / rayCount + p.random(-0.15, 0.15);
            particles.push({
              effectType: 'ray',
              x,
              y,
              angle,
              wobble: p.random(-0.02, 0.02),
              length: p.random(16, 28),
              maxLength: p.random(70, 100),
              life: 1,
              decay: 0.03,
              strokeWeight: p.random(1.5, 2.8),
              color: [255, 214, 150],
            });
          }
        },
      ];

      const updateParticle = particle => {
        switch (particle.effectType) {
          case 'burst':
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.vx *= particle.friction;
            particle.vy *= particle.friction;
            break;
          case 'ring':
            particle.radius += particle.growth;
            particle.growth *= 0.97;
            break;
          case 'confetti':
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.vy += particle.gravity;
            particle.rotation += particle.rotationSpeed;
            break;
          case 'sparkle':
            particle.pulseOffset += particle.pulseSpeed;
            particle.x += Math.cos(particle.pulseOffset) * particle.jitter;
            particle.y += Math.sin(particle.pulseOffset) * particle.jitter;
            break;
          case 'ray':
            particle.length += (particle.maxLength - particle.length) * 0.12;
            particle.angle += particle.wobble;
            break;
          default:
            break;
        }

        particle.life -= particle.decay ?? 0.03;
        return particle.life > 0;
      };

      const drawParticle = particle => {
        const alpha = p.constrain(particle.life, 0, 1);

        switch (particle.effectType) {
          case 'burst': {
            const color = particle.color;
            const size = particle.size * alpha;
            p.noStroke();
            p.fill(color[0], color[1], color[2], alpha * 200);
            p.circle(particle.x, particle.y, size);
            break;
          }
          case 'ring': {
            const color = particle.color;
            p.noFill();
            p.stroke(color[0], color[1], color[2], alpha * 180);
            p.strokeWeight(Math.max(0.5, particle.strokeWeight * alpha));
            p.circle(particle.x, particle.y, particle.radius * 2);
            break;
          }
          case 'confetti': {
            const color = particle.color;
            p.noStroke();
            p.fill(color[0], color[1], color[2], alpha * 255);
            p.translate(particle.x, particle.y);
            p.rotate(particle.rotation);
            p.rectMode(p.CENTER);
            p.rect(0, 0, particle.size, particle.size * 0.6);
            break;
          }
          case 'sparkle': {
            const color = particle.color;
            const pulse = 0.5 + 0.5 * Math.sin(particle.pulseOffset * 2);
            const size = particle.size * (0.6 + pulse * 0.8);
            p.noStroke();
            p.fill(color[0], color[1], color[2], alpha * 230);
            p.circle(particle.x, particle.y, size);
            p.fill(color[0], color[1], color[2], alpha * 160);
            p.circle(particle.x, particle.y, size * 0.4);
            break;
          }
          case 'ray': {
            const color = particle.color;
            const endX = particle.x + Math.cos(particle.angle) * particle.length;
            const endY = particle.y + Math.sin(particle.angle) * particle.length;
            p.stroke(color[0], color[1], color[2], alpha * 200);
            p.strokeWeight(Math.max(0.5, particle.strokeWeight * alpha));
            p.line(particle.x, particle.y, endX, endY);
            break;
          }
          default:
            break;
        }
      };

      p.setup = () => {
        const canvas = p.createCanvas(window.innerWidth, window.innerHeight);
        canvas.addClass('announce-effect');
        canvas.position(0, 0);
        canvas.style('pointer-events', 'none');
        canvas.style('z-index', '20');
        p.clear();
      };

      p.windowResized = () => {
        p.resizeCanvas(window.innerWidth, window.innerHeight);
      };

      p.draw = () => {
        if (particles.length === 0) {
          p.clear();
          return;
        }

        p.clear();
        for (let i = particles.length - 1; i >= 0; i -= 1) {
          const particle = particles[i];
          if (!updateParticle(particle)) {
            particles.splice(i, 1);
            continue;
          }

          p.push();
          if (particle.effectType === 'confetti') {
            p.blendMode(p.BLEND);
          } else {
            p.blendMode(p.ADD);
          }
          drawParticle(particle);
          p.pop();
        }
      };

      p.triggerBurst = (x, y) => {
        const createEffect = p.random(effectFactories);
        if (typeof createEffect === 'function') {
          createEffect(x, y);
        }
      };
    })
  : null;

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

function buildConcurrencyHeaders(session) {
  if (session && session.lastUpdated) {
    return { 'If-Match': session.lastUpdated };
  }
  return {};
}

async function request(url, options = {}) {
  const defaultHeaders = { 'Content-Type': 'application/json' };
  const mergedHeaders = { ...defaultHeaders, ...(options.headers || {}) };
  const fetchOptions = { ...options, headers: mergedHeaders };
  const response = await fetch(url, fetchOptions);
  if (!response.ok) {
    let message = response.statusText || `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body.error) {
        message = body.error;
      }
    } catch (_) {
      // ignore
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
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
        if (announceEffect && typeof announceEffect.triggerBurst === 'function') {
          const rect = announceButton.getBoundingClientRect();
          announceEffect.triggerBurst(rect.left + rect.width / 2, rect.top + rect.height / 2);
        }
        announceButton.disabled = true;
        try {
          const result = await request(`${API_BASE}/api/sessions/${session.id}/announce`, {
            method: 'POST',
            headers: buildConcurrencyHeaders(session),
          });
          const slackEnabled = Boolean(result && result.slackEnabled);
          await loadSessions();
          alert(
            slackEnabled
              ? 'Slack に利用予定を通知しました。'
              : 'Slack Webhook が設定されていないため通知は送信されませんでした。'
          );
        } catch (error) {
          if (error.status === 409) {
            await loadSessions();
          }
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
          await request(`${API_BASE}/api/sessions/${session.id}/heartbeat`, {
            method: 'POST',
            headers: buildConcurrencyHeaders(session),
          });
          await loadSessions();
        } catch (error) {
          if (error.status === 409) {
            await loadSessions();
          }
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
            headers: buildConcurrencyHeaders(session),
            body: JSON.stringify({ status: newStatus }),
          });
          await loadSessions();
        } catch (error) {
          if (error.status === 409) {
            await loadSessions();
          }
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
          await request(`${API_BASE}/api/sessions/${session.id}`, {
            method: 'DELETE',
            headers: buildConcurrencyHeaders(session),
          });
          await loadSessions();
        } catch (error) {
          if (error.status === 409) {
            await loadSessions();
          }
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
