import { useEffect, useState } from 'react';
import { api } from '../api';

export default function ComplaintsAdmin() {
  const [items, setItems] = useState([]);
  const [reply, setReply] = useState({});
  const [notice, setNotice] = useState('');

  async function load() {
    const res = await api.get('/complaints');
    setItems(res.data);
  }

  useEffect(() => { load(); }, []);

  async function update(id, status) {
    try {
      const res = await api.patch(`/complaints/${id}`, { status, admin_reply: reply[id] || '' });
      setNotice(res.data.message);
      load();
    } catch (err) {
      setNotice(err.response?.data?.message || 'Cập nhật thất bại');
    }
  }

  return (
    <div>
      <h1>Xử lý khiếu nại CSKH</h1>
      {notice && <div className="alert">{notice}</div>}
      {items.map(item => (
        <div className="panel" key={item.id}>
          <div className="row between">
            <h3>{item.subject}</h3>
            <span className="badge">{item.status}</span>
          </div>
          <p><strong>Bệnh nhân:</strong> {item.patient_name}</p>
          <p><strong>Đối tượng:</strong> {item.target_type} {item.doctor_name ? `- ${item.doctor_name}` : ''}</p>
          <p>{item.message}</p>
          <textarea placeholder="Phản hồi cho bệnh nhân" value={reply[item.id] || item.admin_reply || ''} onChange={e => setReply(prev => ({ ...prev, [item.id]: e.target.value }))} />
          <div className="actions">
            <button onClick={() => update(item.id, 'processing')}>Đang xử lý</button>
            <button onClick={() => update(item.id, 'resolved')}>Đã giải quyết</button>
            <button className="ghost" onClick={() => update(item.id, 'rejected')}>Từ chối</button>
          </div>
        </div>
      ))}
    </div>
  );
}
