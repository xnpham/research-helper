// sidepanel.js

const notesEl = document.getElementById('notes');
const previewEl = document.getElementById('preview');
const statusEl = document.getElementById('status');
const sessionInfoEl = document.getElementById('sessionInfo');
const copyBtn = document.getElementById('copyBtn');
const exportBtn = document.getElementById('exportBtn');
const previewBtn = document.getElementById('previewBtn');
const wordsCountEl = document.getElementById('wordsCount');
const autosaveStatusEl = document.getElementById('autosaveStatus');
const sessionStatusBadge = document.getElementById('sessionStatusBadge');
const sessionStatusText = document.getElementById('sessionStatusText');

let currentSession = null;
let saveTimeout = null;
let isPreviewMode = false;

function setStatus(msg) {
  statusEl.textContent = msg;
}

/**
 * Simple word counter for status badge
 */
function updateWordCount() {
  const text = notesEl.value || '';
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const count = words.length;
  wordsCountEl.textContent = `${count} word${count === 1 ? '' : 's'}`;
}

async function loadCurrentSession() {
  const res = await chrome.runtime.sendMessage({ type: 'getCurrentSession' });
  if (res.ok) {
    currentSession = res.currentSession;
    if (currentSession) {
      sessionInfoEl.textContent = `Session: ${currentSession.topicName} (${currentSession.id.slice(
        0,
        8
      )}…)`;

      // Active session style
      const dot = sessionStatusBadge.querySelector('.status-dot');
      dot.classList.remove('offline');
      sessionStatusText.textContent = 'Active session';

      // load notes cho session
      const noteRes = await chrome.runtime.sendMessage({
        type: 'loadNotes',
        sessionId: currentSession.id
      });
      if (noteRes.ok) {
        notesEl.value = noteRes.content || '';
        updateWordCount();
      }
    } else {
      sessionInfoEl.textContent =
        'No active session. Notes are not tied to a session.';

      // Inactive session style
      const dot = sessionStatusBadge.querySelector('.status-dot');
      dot.classList.add('offline');
      sessionStatusText.textContent = 'No session';
    }
  } else {
    sessionInfoEl.textContent = 'Failed to load session.';
    const dot = sessionStatusBadge.querySelector('.status-dot');
    dot.classList.add('offline');
    sessionStatusText.textContent = 'Error';
  }

  autosaveStatusEl.textContent = 'Idle';
}

function scheduleSave() {
  updateWordCount();

  if (!currentSession) {
    autosaveStatusEl.textContent = 'No session';
    return;
  }

  autosaveStatusEl.textContent = 'Typing…';

  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    autosaveStatusEl.textContent = 'Saving…';

    await chrome.runtime.sendMessage({
      type: 'saveNotes',
      sessionId: currentSession.id,
      content: notesEl.value
    });

    autosaveStatusEl.textContent = 'Saved';
    setStatus('Notes saved');
  }, 600);
}

// Simple Markdown Renderer
function renderMarkdown(text) {
  if (!text) return '';

  let html = text
    // Escape HTML
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Bold **text**
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic *text* or _text_
    .replace(/(\*|_)(.*?)\1/g, '<em>$2</em>')
    // Links [text](url)
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" style="color: var(--accent);">$1</a>')
    // Headers ###
    .replace(/^### (.*$)/gm, '<h3 style="margin: 8px 0 4px; font-size: 1.1em;">$1</h3>')
    .replace(/^## (.*$)/gm, '<h2 style="margin: 10px 0 6px; font-size: 1.2em;">$1</h2>')
    .replace(/^# (.*$)/gm, '<h1 style="margin: 12px 0 8px; font-size: 1.4em;">$1</h1>')
    // Lists - item
    .replace(/^\s*-\s+(.*$)/gm, '• $1<br>')
    // Newlines to <br> (except after headers)
    .replace(/\n/g, '<br>');

  return html;
}

notesEl.addEventListener('input', scheduleSave);

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(notesEl.value);
    setStatus('Copied to clipboard');
  } catch (e) {
    console.error(e);
    setStatus('Failed to copy');
  }
});

exportBtn.addEventListener('click', async () => {
  const content = notesEl.value;
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url,
      filename: 'research_notes.md',
      saveAs: true
    });
    setStatus('Exported notes');
  } catch (e) {
    console.error('Download failed', e);
    setStatus('Download failed');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
});

previewBtn.addEventListener('click', () => {
  isPreviewMode = !isPreviewMode;

  if (isPreviewMode) {
    // Switch to Preview
    previewEl.innerHTML = renderMarkdown(notesEl.value);
    notesEl.style.display = 'none';
    previewEl.style.display = 'block';
    previewBtn.textContent = '✏️ Edit';
    previewBtn.style.color = 'var(--accent)';
  } else {
    // Switch to Edit
    notesEl.style.display = 'block';
    previewEl.style.display = 'none';
    previewBtn.textContent = '👁️ Preview';
    previewBtn.style.color = 'var(--text-secondary)';
    notesEl.focus();
  }
});

// init
loadCurrentSession();
updateWordCount();
setStatus('Ready.');
