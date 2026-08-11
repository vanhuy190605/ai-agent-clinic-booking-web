import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, API_URL, getUser } from '../api';

export default function OnlineChat() {
  const user = getUser();

  const [doctors, setDoctors] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');

  const activeRef = useRef(null);
  const chatBoxRef = useRef(null);

  const socket = useMemo(() => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    return io(API_URL, {
      auth: { token },
      transports: ['websocket', 'polling']
    });
  }, []);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Tự cuộn xuống tin nhắn mới nhất
  useEffect(() => {
    const chatBox = chatBoxRef.current;
    if (!chatBox) return;

    setTimeout(() => {
      chatBox.scrollTop = chatBox.scrollHeight;
    }, 50);
  }, [messages, active?.id]);

  async function loadConversations() {
    const res = await api.get('/conversations');
    setConversations(res.data);

    if (!activeRef.current && res.data[0]) {
      setActive(res.data[0]);
    }
  }

  async function loadMessages(conversationId) {
    const res = await api.get(`/conversations/${conversationId}/messages`);
    setMessages(res.data);
  }

  useEffect(() => {
    if (user.role === 'patient') {
      api.get('/doctors').then((res) => setDoctors(res.data));
    }

    loadConversations().catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket) return;

    function handleNewMessage(msg) {
      const currentActive = activeRef.current;

      if (currentActive && Number(msg.conversation_id) === Number(currentActive.id)) {
        setMessages((prev) => {
          const existed = prev.some((m) => Number(m.id) === Number(msg.id));
          if (existed) return prev;
          return [...prev, msg];
        });
      }

      loadConversations().catch(() => {});
    }

    socket.on('message:new', handleNewMessage);

    return () => {
      socket.off('message:new', handleNewMessage);
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    if (!active) return;

    let isMounted = true;

    async function refreshMessages() {
      try {
        const res = await api.get(`/conversations/${active.id}/messages`);

        if (!isMounted) return;

        setMessages((prev) => {
          const oldIds = prev.map((m) => m.id).join(',');
          const newIds = res.data.map((m) => m.id).join(',');

          if (oldIds === newIds) return prev;

          return res.data;
        });
      } catch (err) {
        console.log('Không tải được tin nhắn:', err);
      }
    }

    refreshMessages();

    const interval = setInterval(refreshMessages, 1000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [active?.id]);

  async function startConversation(doctorId) {
    try {
      const res = await api.post('/conversations', { doctor_id: doctorId });
      setActive(res.data);
      await loadConversations();
    } catch (err) {
      setNotice(err.response?.data?.message || 'Không tạo được hội thoại');
    }
  }

  async function send(e) {
    e.preventDefault();

    if (!text.trim() || !active) return;

    const content = text.trim();
    setText('');

    try {
      const res = await api.post(`/conversations/${active.id}/messages`, {
        message: content
      });

      if (res.data?.id) {
        setMessages((prev) => {
          const existed = prev.some((m) => Number(m.id) === Number(res.data.id));
          if (existed) return prev;
          return [...prev, res.data];
        });
      }

      loadConversations().catch(() => {});
    } catch (err) {
      setNotice(err.response?.data?.message || 'Gửi tin nhắn thất bại');
      setText(content);
    }
  }

  return (
    <div>
      <h1>Chat trực tuyến bác sĩ - bệnh nhân</h1>
      <p className="muted">Bệnh nhân và bác sĩ có thể nhắn tin trực tuyến qua Socket.IO.</p>

      {notice && <div className="alert">{notice}</div>}

      {user.role === 'patient' && (
        <section className="panel">
          <h2>Bắt đầu chat với bác sĩ</h2>
          <div className="doctor-row">
            {doctors.map((d) => (
              <button key={d.id} onClick={() => startConversation(d.id)}>
                {d.full_name} - {d.specialty_name}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="chat-layout">
        <aside className="conversation-list">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              className={Number(active?.id) === Number(conv.id) ? 'active' : ''}
              onClick={() => setActive(conv)}
            >
              {user.role === 'patient' ? conv.doctor_name : conv.patient_name}
            </button>
          ))}
        </aside>

        <section className="panel chat-panel">
          {!active ? (
            <p className="muted">Chọn hội thoại để bắt đầu.</p>
          ) : (
            <>
              <h2>{user.role === 'patient' ? active.doctor_name : active.patient_name}</h2>

              <div className="chat-box compact" ref={chatBoxRef}>
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`bubble ${Number(msg.sender_id) === Number(user.id) ? 'user' : 'bot'}`}
                  >
                    <strong>{msg.sender_name}: </strong>
                    {msg.message}
                  </div>
                ))}
              </div>

              <form className="chat-input" onSubmit={send}>
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Nhập tin nhắn..."
                />
                <button>Gửi</button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}