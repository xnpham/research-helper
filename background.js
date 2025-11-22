// background.js
import { GEMINI_API_KEY } from './env.js';

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

async function deleteSession(sessionId) {
  const data = await loadStorage([STORAGE_KEYS.SESSIONS, STORAGE_KEYS.NOTES]);
  let sessions = data[STORAGE_KEYS.SESSIONS] || [];
  let notes = data[STORAGE_KEYS.NOTES] || {};

  sessions = sessions.filter(s => s.id !== sessionId);
  delete notes[sessionId];

  await saveStorage({
    [STORAGE_KEYS.SESSIONS]: sessions,
    [STORAGE_KEYS.NOTES]: notes
  });
}

async function deleteAllSessions() {
  await saveStorage({
    [STORAGE_KEYS.SESSIONS]: [],
    [STORAGE_KEYS.NOTES]: {}
  });
}

// Log mỗi lần điều hướng top-level
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (!currentSession) return;
  if (details.frameId !== 0) return; // chỉ trang chính

  // Duplicate check: if same URL as last page, ignore
  const lastPage = currentSession.pages[currentSession.pages.length - 1];
  if (lastPage && lastPage.url === details.url) {
    console.log('Ignoring duplicate URL:', details.url);
    return;
  }

  pageOrder += 1;

  const pageEntry = {
    order: pageOrder,
    url: details.url,
    title: details.title || '',
    openedAt: Date.now(),
    tabId: details.tabId,
    windowId: details.windowId,
    openerTabId: details.openerTabId,
    status: 'loading' // 'loading' | 'complete'
  };

  currentSession.pages.push(pageEntry);
  // update storage
  await saveStorage({ [STORAGE_KEYS.CURRENT_SESSION]: currentSession });
});

// Update title when page finishes loading (using Gemini) OR when title changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!currentSession) return;

  // Find the most recent entry with this URL
  const pageIndex = currentSession.pages.findLastIndex(p => p.url === tab.url);
  if (pageIndex === -1) return;

  const page = currentSession.pages[pageIndex];

  // Helper to update title in storage
  const updateTitle = async (newTitle, isFinal = false) => {
    let changed = false;
    if (newTitle && newTitle !== page.title) {
      currentSession.pages[pageIndex].title = newTitle;
      changed = true;
    }
    if (isFinal) {
      currentSession.pages[pageIndex].status = 'complete';
      changed = true;
    }

    if (changed) {
      await saveStorage({ [STORAGE_KEYS.CURRENT_SESSION]: currentSession });
      console.log(`Title updated to: ${newTitle} (Final: ${isFinal})`);
    }
  };

  // 1. Progressive Update: If browser reports a title change (even if loading)
  if (changeInfo.title) {
    console.log('Browser reported title change:', changeInfo.title);
    await updateTitle(changeInfo.title, false);
  }

  // 2. AI Generation: Only when loading is complete
  if (changeInfo.status === 'complete') {
    console.log('Page load complete. Generating AI title for:', tab.url);

    try {
      const aiTitle = await generateTitleForTab(tabId);
      if (aiTitle) {
        await updateTitle(aiTitle, true);
      } else {
        console.log('AI returned null, falling back to tab title');
        // Ensure we have the latest tab title if AI fails
        await updateTitle(tab.title, true);
      }
    } catch (e) {
      console.error('AI Title generation failed (unexpected):', e);
      // Fallback to tab title if AI fails
      await updateTitle(tab.title, true);
    }
  }
});

// --------- Export Markdown ----------

function formatTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString(); // Just time for the table
}

function formatDate(ts) {
  return new Date(ts).toLocaleString();
}

function sessionToMarkdown(session, notesForSession = '') {
  let md = '';

  md += `# Research session: ${session.topicName}\n\n`;
  md += `- **Session ID**: ${session.id}\n`;
  md += `- **Started**: ${formatDate(session.startedAt)}\n`;
  if (session.endedAt) {
    md += `- **Ended**: ${formatDate(session.endedAt)}\n`;
    const durationMs = session.endedAt - session.startedAt;
    const durationMin = Math.floor(durationMs / 60000);
    const durationSec = Math.floor((durationMs % 60000) / 1000);
    md += `- **Duration**: ${durationMin}m ${durationSec}s\n`;
  }
  md += `- **Total pages**: ${session.pages.length}\n\n`;

  if (notesForSession && notesForSession.trim()) {
    md += `## Notes\n\n`;
    md += notesForSession.trim() + '\n\n';
  }

  md += `## Pages\n\n`;
  // Table Header - REMOVED SUMMARY COLUMN
  md += `| Order | Time | Title | URL |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;

  for (const page of session.pages) {
    const title = (page.title || 'No Title').replace(/\|/g, '\\|'); // Escape pipes
    const url = page.url;
    const time = formatTimestamp(page.openedAt);

    md += `| ${page.order} | ${time} | ${title} | ${url} |\n`;
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
        case 'deleteSession':
          await deleteSession(message.sessionId);
          sendResponse({ ok: true });
          break;
        case 'deleteAllSessions':
          await deleteAllSessions();
          sendResponse({ ok: true });
          break;
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

// --------- Gemini API Integration (Titles Only) ----------

async function getPageContent(tabId) {
  const tab = await chrome.tabs.get(tabId);

  if (tab.url.toLowerCase().endsWith('.pdf')) {
    return {
      isPdf: true,
      url: tab.url,
      title: tab.title
    };
  }

  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return document.body.innerText.substring(0, 3000); // Limit to 3000 chars for title gen
      }
    });

    return {
      content: result[0].result,
      url: tab.url,
      title: tab.title
    };
  } catch (e) {
    console.warn('Script injection failed (likely restricted page or PDF):', e);
    return {
      content: '',
      url: tab.url,
      title: tab.title,
      error: e
    };
  }
}

async function callGeminiForTitle(text) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_API_KEY_HERE') {
    throw new Error('Please set your Gemini API Key in env.js');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  const prompt = `
    Analyze the following text from a webpage and provide ONLY a concise, descriptive title (max 10 words).
    Do not include "Title:" prefix. Just the title text.

    Text:
    ${text}
  `;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Gemini API Error Details:', JSON.stringify(err, null, 2));
      throw new Error(err.error?.message || 'Gemini API request failed');
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
      console.warn('Gemini response contained no text:', JSON.stringify(data, null, 2));
      throw new Error('No content generated');
    }

    return generatedText.trim();
  } catch (e) {
    console.error('Call Gemini failed:', e);
    throw e;
  }

}

async function generateTitleForTab(tabId) {
  try {
    const pageData = await getPageContent(tabId);

    if (pageData.isPdf) {
      // Extract filename
      const filename = pageData.url.split('/').pop().split('?')[0] || 'PDF Document';
      try {
        return decodeURIComponent(filename);
      } catch {
        return filename;
      }
    }

    if (!pageData.content || pageData.content.trim().length === 0) {
      return null;
    }

    const title = await callGeminiForTitle(pageData.content);
    return title;
  } catch (error) {
    console.error('Gemini Title Error:', error);
    return null;
  }
}
