// background.js

// Key để lưu trong storage
const STORAGE_KEYS = {
  CURRENT_SESSION: 'currentSession',
  SESSIONS: 'sessions',
  NOTES: 'notes' // notes[sessionId] = markdown string
};

let currentSession = null;
let pageOrder = 0;

// Helper: load từ storage
async function loadStorage(keys) {
  return await chrome.storage.local.get(keys);
}

// Helper: save vào storage
async function saveStorage(obj) {
  return await chrome.storage.local.set(obj);
}

// Khởi tạo state khi service worker wake up
(async () => {
  const data = await loadStorage([
    STORAGE_KEYS.CURRENT_SESSION,
    STORAGE_KEYS.SESSIONS
  ]);

  currentSession = data[STORAGE_KEYS.CURRENT_SESSION] || null;
  if (currentSession) {
    pageOrder = currentSession.pages?.length || 0;
  }
})();

// --------- Session control ----------

async function startSession(topicName) {
  const startedAt = Date.now();
  currentSession = {
    id: crypto.randomUUID(),
    topicName,
    startedAt,
    endedAt: null,
    pages: []
  };
  pageOrder = 0;

  await saveStorage({ [STORAGE_KEYS.CURRENT_SESSION]: currentSession });
}

async function stopSession() {
  if (!currentSession) return null;

  currentSession.endedAt = Date.now();

  const data = await loadStorage([STORAGE_KEYS.SESSIONS]);
  const sessions = data[STORAGE_KEYS.SESSIONS] || [];

  sessions.push(currentSession);

  await saveStorage({
    [STORAGE_KEYS.SESSIONS]: sessions,
    [STORAGE_KEYS.CURRENT_SESSION]: null
  });

  const finished = currentSession;
  currentSession = null;
  pageOrder = 0;

  return finished;
}

// Log mỗi lần điều hướng top-level
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (!currentSession) return;
  if (details.frameId !== 0) return; // chỉ trang chính

  pageOrder += 1;

  const pageEntry = {
    order: pageOrder,
    url: details.url,
    title: details.title || '',
    openedAt: Date.now(),
    tabId: details.tabId,
    windowId: details.windowId,
    openerTabId: details.openerTabId
  };

  currentSession.pages.push(pageEntry);
  // update storage
  await saveStorage({ [STORAGE_KEYS.CURRENT_SESSION]: currentSession });
});

// --------- Export Markdown ----------

function formatTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleString(); // có thể custom theo ý
}

function sessionToMarkdown(session, notesForSession = '') {
  let md = '';

  md += `# Research session: ${session.topicName}\n\n`;
  md += `- **Session ID**: ${session.id}\n`;
  md += `- **Started**: ${formatTimestamp(session.startedAt)}\n`;
  if (session.endedAt) {
    md += `- **Ended**: ${formatTimestamp(session.endedAt)}\n`;
  }
  md += `- **Total pages**: ${session.pages.length}\n\n`;

  if (notesForSession && notesForSession.trim()) {
    md += `## Notes\n\n`;
    md += notesForSession.trim() + '\n\n';
  }

  md += `## Pages\n\n`;
  for (const page of session.pages) {
    md += `${page.order}. [${page.title || page.url}](${page.url}) — ${formatTimestamp(page.openedAt)}\n`;
  }

  return md;
}

async function getSessionMarkdown(sessionId) {
  const data = await loadStorage([
    STORAGE_KEYS.SESSIONS,
    STORAGE_KEYS.NOTES
  ]);
  const sessions = data[STORAGE_KEYS.SESSIONS] || [];
  const notesAll = data[STORAGE_KEYS.NOTES] || {};

  const session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  const notesForSession = notesAll[sessionId] || '';
  const md = sessionToMarkdown(session, notesForSession);
  return md;
}
async function exportSessionMarkdown(sessionId) {
  const data = await loadStorage([
    STORAGE_KEYS.SESSIONS,
    STORAGE_KEYS.NOTES
  ]);
  const sessions = data[STORAGE_KEYS.SESSIONS] || [];
  const notesAll = data[STORAGE_KEYS.NOTES] || {};

  const session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  const notesForSession = notesAll[sessionId] || '';

  const md = sessionToMarkdown(session, notesForSession);
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);

  await chrome.downloads.download({
    url,
    filename: `research_session_${session.topicName || 'untitled'}_${session.id}.md`,
    saveAs: true
  });

  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// --------- Notes storage ----------

async function saveNotes(sessionId, content) {
  const data = await loadStorage([STORAGE_KEYS.NOTES]);
  const notes = data[STORAGE_KEYS.NOTES] || {};
  notes[sessionId] = content;

  await saveStorage({ [STORAGE_KEYS.NOTES]: notes });
}

async function loadNotes(sessionId) {
  const data = await loadStorage([STORAGE_KEYS.NOTES]);
  const notes = data[STORAGE_KEYS.NOTES] || {};
  return notes[sessionId] || '';
}

// --------- Message handling (popup & sidepanel) ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'getSessionMarkdown': {
          const md = await getSessionMarkdown(message.sessionId);
          sendResponse({ ok: true, markdown: md });
          break;
        }
        case 'startSession':
          await startSession(message.topicName || 'Untitled topic');
          sendResponse({ ok: true, currentSession });
          break;
        case 'stopSession': {
          const finished = await stopSession();
          sendResponse({ ok: true, finished });
          break;
        }
        case 'getCurrentSession': {
          // refresh from storage in case background reload
          const data = await loadStorage([STORAGE_KEYS.CURRENT_SESSION]);
          currentSession = data[STORAGE_KEYS.CURRENT_SESSION] || null;
          sendResponse({ ok: true, currentSession });
          break;
        }
        case 'getAllSessions': {
          const data = await loadStorage([STORAGE_KEYS.SESSIONS]);
          sendResponse({ ok: true, sessions: data[STORAGE_KEYS.SESSIONS] || [] });
          break;
        }
        case 'exportSession':
          await exportSessionMarkdown(message.sessionId);
          sendResponse({ ok: true });
          break;
        case 'saveNotes':
          await saveNotes(message.sessionId, message.content || '');
          sendResponse({ ok: true });
          break;
        case 'loadNotes': {
          const notes = await loadNotes(message.sessionId);
          sendResponse({ ok: true, content: notes });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (err) {
      console.error('Error handling message', message, err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  // Return true để dùng async sendResponse
  return true;
});
