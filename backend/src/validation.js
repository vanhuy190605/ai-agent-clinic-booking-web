const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function cleanText(value, maxLength = 255) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  return cleanText(value, 150).toLowerCase();
}

function isEmail(value) {
  return EMAIL_RE.test(normalizeEmail(value));
}

function isStrongEnoughPassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 72;
}

function isValidDate(value) {
  if (!DATE_RE.test(String(value))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isPastDate(value) {
  return isValidDate(value) && value < localDateString();
}

function normalizeTime(value) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return '';
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function isValidTime(value) {
  return TIME_RE.test(normalizeTime(value));
}

function positiveId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

module.exports = {
  cleanText,
  normalizeEmail,
  isEmail,
  isStrongEnoughPassword,
  isValidDate,
  isPastDate,
  isValidTime,
  normalizeTime,
  positiveId,
  localDateString
};
