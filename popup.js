// popup.js

// popup.js

const topicInput = document.getElementById('topicInput');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const sessionsListEl = document.getElementById('sessionsList');
const openSidePanelBtn = document.getElementById('openSidePanelBtn');
const deleteAllBtn = document.getElementById('deleteAllBtn');

function setStatus(text) {
  statusEl.textContent = text;
}

function updateBadge(isRunning) {
  const dot = document.getElementById('popupStatusDot');
  const text = document.getElementById('popupStatusText');
  const subtitle = document.getElementById('subtitle');

  if (!dot || !text || !subtitle) return;

  if (isRunning) {
    dot.classList.remove('offline');
    text.textContent = 'Recording';
    subtitle.textContent = 'Tracking all pages you open in this topic.';
  } else {
    dot.classList.add('offline');
    text.textContent = 'Idle';
    subtitle.textContent = 'Start a topic to track all pages you open.';
  }
}

async function refreshState() {
  const res = await chrome.runtime.sendMessage({ type: 'getCurrentSession' });
  if (res.ok) {
    const session = res.currentSession;
    if (session) {
      updateBadge(true);
      startBtn.disabled = true;
      stopBtn.disabled = true; // mặc định disable, click Start sẽ enable
      stopBtn.disabled = false;
      topicInput.value = session.topicName || '';
      const loadingCount = session.pages.filter(p => p.status === 'loading').length;
      const statusText = `Session "${session.topicName}" is running (pages: ${session.pages.length})`;
      setStatus(loadingCount > 0 ? `${statusText} - ${loadingCount} generating...` : statusText);
    } else {
      updateBadge(false);
      startBtn.disabled = false;
      stopBtn.disabled = true;
      setStatus('No active session.');
    }
  }

  const allRes = await chrome.runtime.sendMessage({ type: 'getAllSessions' });
  if (allRes.ok) {
    renderSessions(allRes.sessions);
  }
}

function renderSessions(sessions) {
  sessionsListEl.innerHTML = '';
  if (!sessions.length) {
    sessionsListEl.textContent = 'No sessions yet.';
    return;
  }

  for (const s of sessions.slice().reverse()) { // mới nhất lên trên
    const div = document.createElement('div');
    div.className = 'session-item';

    const title = document.createElement('div');
    title.className = 'session-title';
    let titleText = s.topicName || 'Untitled';

    // Check if any page in this session is loading
    const loadingCount = s.pages.filter(p => p.status === 'loading').length;
    if (loadingCount > 0) {
      titleText += ` (Generating ${loadingCount} titles...) ⏳`;
    }

    title.textContent = titleText;

    const meta = document.createElement('div');
    const start = new Date(s.startedAt).toLocaleString();
    const end = s.endedAt ? new Date(s.endedAt).toLocaleString() : 'N/A';
    meta.textContent = `Pages: ${s.pages.length} | ${start} → ${end}`;

    const actionsDiv = document.createElement('div');
    actionsDiv.style.display = 'flex';
    actionsDiv.style.gap = '6px';
    actionsDiv.style.marginTop = '4px';

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export Markdown';
    exportBtn.className = 'session-export-btn';
    exportBtn.style.flex = '1';
    exportBtn.onclick = async () => {
      const res = await chrome.runtime.sendMessage({
        type: 'getSessionMarkdown',
        sessionId: s.id
      });

      if (!res.ok) {
        console.error(res.error);
        alert('Failed to build markdown: ' + (res.error || 'Unknown error'));
        return;
      }

      const md = res.markdown || '';

      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);

      try {
        await chrome.downloads.download({
          url,
          filename: `research_session_${s.topicName || 'untitled'}_${s.id}.md`,
          saveAs: true
        });
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑️';
    deleteBtn.className = 'session-export-btn';
    deleteBtn.style.width = '30px';
    deleteBtn.style.justifyContent = 'center';
    deleteBtn.title = 'Delete Session';
    deleteBtn.onclick = async () => {
      if (confirm(`Delete session "${s.topicName}"?`)) {
        await chrome.runtime.sendMessage({ type: 'deleteSession', sessionId: s.id });
        refreshState();
      }
    };

    actionsDiv.appendChild(exportBtn);
    actionsDiv.appendChild(deleteBtn);

    div.appendChild(title);
    div.appendChild(meta);
    div.appendChild(actionsDiv);
    sessionsListEl.appendChild(div);
  }
}

startBtn.addEventListener('click', async () => {
  const topicName = topicInput.value.trim() || 'Untitled topic';
  const res = await chrome.runtime.sendMessage({ type: 'startSession', topicName });
  if (res.ok) {
    setStatus(`Session "${topicName}" started.`);
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    setStatus('Failed to start session.');
  }
});

stopBtn.addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'stopSession' });
  if (res.ok) {
    setStatus('Session stopped.');
    startBtn.disabled = false;
    stopBtn.disabled = true;
    refreshState();
  } else {
    setStatus('Failed to stop session.');
  }
});

if (deleteAllBtn) {
  deleteAllBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete ALL sessions? This cannot be undone.')) {
      await chrome.runtime.sendMessage({ type: 'deleteAllSessions' });
      refreshState();
    }
  });
}

openSidePanelBtn.addEventListener('click', () => {
  // Chrome sidePanel API
  // Note: open() requires user gesture, which click provides.
  // But sidePanel.open might only be available in newer Chrome versions or specific context.
  // Alternatively, we can just instruct user.
  // For now let's try to open it if possible, or just show a message.

  // Actually, chrome.sidePanel.open needs a windowId.
  chrome.windows.getCurrent({ populate: false }, (window) => {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      chrome.sidePanel.open({ windowId: window.id });
    } else {
      alert('Please click the Side Panel icon in Chrome toolbar to open notes.');
    }
  });
});

// init
refreshState();
