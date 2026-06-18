/**
 * Get the raw ID from a field that may be populated (object) or just a string ID.
 * Backend populates folderId as { _id, name, color } but frontend often compares
 * against string IDs — this helper normalises both cases.
 */
export function getFolderId(folderId) {
  if (!folderId) return null;
  if (typeof folderId === "object" && folderId._id) return folderId._id;
  return String(folderId);
}

/**
 * Check if a note belongs to a given folder, handling both populated and raw IDs.
 */
export function noteInFolder(note, folderId) {
  return getFolderId(note.folderId) === String(folderId);
}

/**
 * Get the team ID from a field that may be populated or just a string ID.
 */
export function getTeamId(teamId) {
  if (!teamId) return null;
  if (typeof teamId === "object" && teamId._id) return teamId._id;
  return String(teamId);
}

/**
 * Relative time formatter
 */
export function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/**
 * Get tag color
 */
const TAG_COLORS = [
  { bg: "#EEF3FF", text: "#3730A3", darkBg: "#1e1b4b", darkText: "#a5b4fc" },
  { bg: "#F0FDF4", text: "#166534", darkBg: "#14532d", darkText: "#86efac" },
  { bg: "#FFF7ED", text: "#9A3412", darkBg: "#431407", darkText: "#fdba74" },
  { bg: "#FDF4FF", text: "#6B21A8", darkBg: "#3b0764", darkText: "#d8b4fe" },
  { bg: "#FFF1F2", text: "#9F1239", darkBg: "#4c0519", darkText: "#fda4af" },
  { bg: "#F0FDFA", text: "#134E4A", darkBg: "#042f2e", darkText: "#5eead4" },
];

export function getTagColor(tag, dark) {
  const i = Math.abs([...tag].reduce((a, c) => a + c.charCodeAt(0), 0)) % TAG_COLORS.length;
  const c = TAG_COLORS[i];
  return dark
    ? { background: c.darkBg, color: c.darkText }
    : { background: c.bg, color: c.text };
}

/**
 * Debounce function
 */
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
