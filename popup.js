// popup.js

const topicInput = document.getElementById('topicInput');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const sessionsListEl = document.getElementById('sessionsList');
const openSidePanelBtn = document.getElementById('openSidePanelBtn');

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
      setStatus(`Session "${session.topicName}" is running (pages: ${session.pages.length})`);
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
    title.textContent = s.topicName || 'Untitled';

    const meta = document.createElement('div');
    const start = new Date(s.startedAt).toLocaleString();
    const end = s.endedAt ? new Date(s.endedAt).toLocaleString() : 'N/A';
    meta.textContent = `Pages: ${s.pages.length} | ${start} → ${end}`;

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export Markdown';
    exportBtn.style.marginTop = '4px';
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
      } catch (e) {
        console.error('downloads.download error', e);
        alert('Download failed: ' + e);
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    };


    div.appendChild(title);
    div.appendChild(meta);
    div.appendChild(exportBtn);
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

openSidePanelBtn.addEventListener('click', async () => {
  try {
    await chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id });
  } catch (e) {
    console.error(e);
    setStatus('Could not open side panel');
  }
});

// init
refreshState();
