// Builds a safe Telegram HTML welcome message and inserts configured custom emojis.
// Admins can put {1}, {2}, {3}... in the welcome text and provide matching custom emoji IDs.
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseEmojiIds(raw) {
  return String(raw || '').split(/[,\\n ]+/).map(s => s.trim()).filter(Boolean).slice(0, 50);
}

function buildWelcomeHtml(text, rawIds) {
  const ids = parseEmojiIds(rawIds);
  let html = escapeHtml(text);
  ids.forEach((id, i) => {
    const n = i + 1;
    // The inner emoji is a normal fallback character; Telegram replaces it with the custom emoji entity.
    const tag = `<tg-emoji emoji-id="${id}">⭐</tg-emoji>`;
    html = html.split(`{${n}}`).join(tag);
  });
  return html;
}

module.exports = { buildWelcomeHtml, parseEmojiIds };
