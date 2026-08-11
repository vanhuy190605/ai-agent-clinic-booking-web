import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

const CONTEXT_KEY = 'clinic_ai_booking_context_v2';

const SPECIALTIES = [
  'Nội tổng quát',
  'Tai Mũi Họng',
  'Da liễu',
  'Tiêu hóa',
  'Tim mạch',
  'Phụ khoa'
];

function normalizeText(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasPhrase(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=[^a-z0-9]|$)`).test(text);
}

function parseSpecialty(message = '') {
  const text = normalizeText(message);

  for (const specialty of SPECIALTIES) {
    if (text.includes(normalizeText(specialty))) {
      return specialty;
    }
  }

if (
  [
    'hong',
    'kham hong',
    'dau hong',
    'viem hong',
    'nuot dau',
    'kho nuot',
    'khan tieng',
    'ho',
    'so mui',
    'nghet mui',
    'dau tai'
  ].some(phrase =>
    hasPhrase(text, phrase)
  )
) {
  return 'Tai Mũi Họng';
} 

  if (['mun', 'ngua', 'di ung', 'me day', 'noi man', 'da lieu', 'Da liễu', 'noi hot', 'mun nuoc'].some(phrase => hasPhrase(text, phrase))) {
    return 'Da liễu';
  }

  if (['dau bung', 'tieu chay', 'buon non', 'da day', 'tieu hoa', 'Tiêu hóa', 'kho tieu', 'trao nguoc', 'that ruot', 'ruot', 'bung'].some(phrase => hasPhrase(text, phrase))) {
    return 'Tiêu hóa';
  }

  if (['dau nguc', 'huyet ap', 'hoi hop', 'tim mach', 'Tim mạch', 'tuc nguc', 'nhoi tim'].some(phrase => hasPhrase(text, phrase))) {
    return 'Tim mạch';
  }

  if (['phu khoa', 'kinh nguyet'].some(phrase => hasPhrase(text, phrase))) {
    return 'Phụ khoa';
  }

  if (['sot', 'met moi', 'dau dau', 'noi tong quat', 'Nội tổng quát', 'thận', 'hậu môn'].some(phrase => hasPhrase(text, phrase))) {
    return 'Nội tổng quát';
  }

  return null;
}

function parseDateText(message = '') {
  const raw = String(message);
  const text = normalizeText(message);

  if (text.includes('hom nay')) return 'hôm nay';
  if (text.includes('ngay mai') || /\bmai\b/.test(text)) return 'ngày mai';
  if (text.includes('ngay kia') || text.includes('ngay mot') || text.includes('mốt')) return 'ngày kia';

  let match = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;

  match = raw.match(/(?:ngày|ngay)?\s*(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{4}))?/i);
  if (match) {
    return match[3] ? `${match[1]}/${match[2]}/${match[3]}` : `${match[1]}/${match[2]}`;
  }

  match = raw.match(/(?:ngày|ngay)?\s*(\d{1,2})\s*(?:tháng|thang)\s*(\d{1,2})(?:\s*(?:năm|nam)\s*(\d{4}))?/i);
  if (match) {
    return match[3]
      ? `ngày ${match[1]} tháng ${match[2]} năm ${match[3]}`
      : `ngày ${match[1]} tháng ${match[2]}`;
  }

  return null;
}

function parseTime(message = '') {
  const raw = String(message).toLowerCase();
  const text = normalizeText(message);

  let match = raw.match(/\b(\d{1,2})\s*:\s*(\d{1,2})\b/);

  if (!match) {
    match = text.match(/(?:luc|vao|chon|lay|doi sang|dat luc|vao luc)\s*(\d{1,2})(?:\s*(?:h|gio)\s*(\d{1,2}))?/);
  }

  if (!match) {
    match = text.match(/\b(\d{1,2})\s*h\s*(\d{1,2})?\b/);
  }

  if (!match) {
    match = text.match(/\b(\d{1,2})\s*gio(?:\s*(\d{1,2}))?\b/);
  }

  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);

  // Không dùng text.includes('toi') vì "tôi" cũng thành "toi"
  const isEvening =
    raw.includes('tối') ||
    raw.includes('buổi tối') ||
    /\bpm\b/i.test(raw);

  const isAfternoon =
    raw.includes('chiều') ||
    raw.includes('buổi chiều') ||
    text.includes('chieu');

  if ((isEvening || isAfternoon) && hour >= 1 && hour <= 11) {
    hour += 12;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseReason(message = '') {
  const raw = String(message).trim();
  const rules = [
    ['dau hong', 'Đau họng'],
    ['so mui', 'Sổ mũi'],
    ['nghet mui', 'Nghẹt mũi'],
    ['dau tai', 'Đau tai'],
    ['ho', 'Ho'],
    ['sot', 'Sốt'],
    ['met moi', 'Mệt mỏi'],
    ['dau dau', 'Đau đầu'],
    ['dau bung', 'Đau bụng'],
    ['tieu chay', 'Tiêu chảy'],
    ['buon non', 'Buồn nôn'],
    ['dau nguc', 'Đau ngực'],
    ['hoi hop', 'Hồi hộp'],
    ['mun', 'Mụn'],
    ['ngua', 'Ngứa'],
    ['di ung', 'Dị ứng'],
    ['me day', 'Mề đay']
  ];

  const detect = value => {
    const normalized = normalizeText(value);
    return rules
      .filter(([phrase]) => hasPhrase(normalized, phrase))
      .map(([, label]) => label)
      .join(', ');
  };

  const match = raw.match(/(?:vì|vi|do)\s+(.+)/i);
  if (match?.[1]) return detect(match[1]) || match[1].trim().slice(0, 250);

  return detect(raw) || null;
}

function isBookingSentence(message = '') {
  const text = normalizeText(message);

  return (
    text.includes('dat lich') ||
    text.includes('dat kham') ||
    text.includes('hen kham') ||
    text.includes('book lich') ||
    text.includes('booking') ||
    text.includes('muon kham') ||
    text.includes('can kham') ||
    text.includes('xin kham')
  );
}

function isFollowUpSentence(message = '') {
  const text = normalizeText(message);

  return (
    parseTime(message) ||
    parseDateText(message) ||
    text.includes('vay') ||
    text.includes('chon') ||
    text.includes('lay') ||
    text.includes('doi') ||
    text.includes('sang') ||
    text.includes('ok') ||
    text.includes('oke') ||
    text.includes('duoc')
  );
}

function getStoredContext() {
  try {
    const raw = localStorage.getItem(CONTEXT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredContext(context) {
  localStorage.setItem(CONTEXT_KEY, JSON.stringify(context));
}

function clearStoredContext() {
  localStorage.removeItem(CONTEXT_KEY);
}

function buildMessageForBackend(originalMessage) {
  const oldContext = getStoredContext();

  const foundSpecialty = parseSpecialty(originalMessage);
  const foundDateText = parseDateText(originalMessage);
  const foundTime = parseTime(originalMessage);
  const foundReason = parseReason(originalMessage);

  const isBooking = isBookingSentence(originalMessage);
  const isFollowUp = Object.keys(oldContext).length > 0 && isFollowUpSentence(originalMessage);

  const nextContext = {
    specialty: foundSpecialty || oldContext.specialty || null,
    dateText: foundDateText || oldContext.dateText || null,
    time: foundTime || oldContext.time || null,
    reason: foundReason || oldContext.reason || null
  };

  if (isBooking || isFollowUp || foundReason || foundSpecialty) {
    saveStoredContext(nextContext);
  }

  if (isFollowUp && nextContext.specialty && nextContext.dateText && nextContext.time) {
    return {
      messageForBackend: `Đặt lịch khám ${nextContext.specialty} ${nextContext.dateText} lúc ${nextContext.time} vì ${nextContext.reason || 'tôi cần khám bệnh'}`,
      context: nextContext
    };
  }

  if (isBooking && nextContext.specialty && nextContext.dateText && nextContext.time) {
    return {
      messageForBackend: `Đặt lịch khám ${nextContext.specialty} ${nextContext.dateText} lúc ${nextContext.time} vì ${nextContext.reason || 'tôi cần khám bệnh'}`,
      context: nextContext
    };
  }

  return {
    messageForBackend: originalMessage,
    context: nextContext
  };
}

export default function AiChat() {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const chatEndRef = useRef(null);

  async function loadHistory() {
    try {
      const res = await api.get('/ai/history');

      const history = [];

      [...res.data].reverse().forEach((item) => {
        history.push({
          role: 'user',
          text: item.message
        });

        history.push({
          role: 'ai',
          text: item.reply,
          action: item.action
        });
      });

      setMessages(history);
    } catch {
      setMessages([]);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(e) {
    e.preventDefault();

    const originalMessage = text.trim();
    if (!originalMessage) return;

    const { messageForBackend, context } = buildMessageForBackend(originalMessage);

    setText('');

    setMessages((prev) => [
      ...prev,
      {
        role: 'user',
        text: originalMessage
      }
    ]);

    try {
      const res = await api.post('/ai/chat', {
        message: messageForBackend,
        display_message: originalMessage,
        booking_reason: context.reason || ''
      });

      if (res.data?.action === 'booking_created') {
        clearStoredContext();
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          text: res.data.reply,
          action: res.data.action
        }
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          text: err.response?.data?.message || 'AI lỗi, vui lòng thử lại',
          action: 'error'
        }
      ]);
    }
  }

  return (
    <div>
      <h1>Chat AI Agent đặt lịch</h1>
      <p className="muted">
        Bệnh nhân có thể bảo AI đặt lịch. Nếu giờ bị bận, bạn chỉ cần nhắn nhanh như “vậy 9h”, “chọn 09:30”.
      </p>

      <section className="panel">
        <div className="chat-box">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`bubble ${msg.role === 'user' ? 'user' : 'bot'}`}
            >
              <div>{msg.text}</div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <form className="chat-input" onSubmit={send}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Nhập yêu cầu: Đặt lịch khám Tai Mũi Họng ngày mai lúc 08:30...'
          />
          <button>Gửi</button>
        </form>
      </section>
    </div>
  );
}