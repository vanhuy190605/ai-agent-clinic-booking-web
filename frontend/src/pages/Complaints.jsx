import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Complaints() {
  const [doctors, setDoctors] = useState([]);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ target_type: 'website', doctor_id: '', subject: '', message: '' });
  const [notice, setNotice] = useState('');

  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  async function load() {
    const [doctorRes, complaintRes] = await Promise.all([api.get('/doctors'), api.get('/complaints/my')]);
    setDoctors(doctorRes.data);
    setItems(complaintRes.data);
  }

  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    setNotice('');
    try {
      const res = await api.post('/complaints', {
        ...form,
        doctor_id: form.target_type === 'doctor' ? form.doctor_id : null
      });
      setNotice(res.data.message);
      setForm({ target_type: 'website', doctor_id: '', subject: '', message: '' });
      load();
    } catch (err) {
      setNotice(err.response?.data?.message || 'Gửi khiếu nại thất bại');
    }
  }

  return (
    <div>
      <h1>Khiếu nại / Chăm sóc khách hàng</h1>
      <p className="muted">Bệnh nhân có thể khiếu nại về bác sĩ hoặc website.</p>

      <form className="panel form-grid" onSubmit={submit}>
        <label>Đối tượng
          <select value={form.target_type} onChange={e => set('target_type', e.target.value)}>
            <option value="website">Website / hệ thống</option>
            <option value="doctor">Bác sĩ</option>
          </select>
        </label>
        {form.target_type === 'doctor' && (
          <label>Bác sĩ
            <select value={form.doctor_id} onChange={e => set('doctor_id', e.target.value)} required>
              <option value="">Chọn bác sĩ</option>
              {doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          </label>
        )}
        <label>Tiêu đề
          <input value={form.subject} onChange={e => set('subject', e.target.value)} required />
        </label>
        <label className="wide">Nội dung
          <textarea value={form.message} onChange={e => set('message', e.target.value)} required />
        </label>
        <button>Gửi khiếu nại</button>
      </form>
      {notice && <div className="alert">{notice}</div>}

      <section className="panel">
        <h2>Khiếu nại đã gửi</h2>
        {items.map(item => (
          <div className="list-item" key={item.id}>
            <strong>{item.subject}</strong> <span className="badge">{item.status}</span>
            <p>{item.message}</p>
            {item.admin_reply && <p><strong>Phản hồi CSKH:</strong> {item.admin_reply}</p>}
          </div>
        ))}
      </section>
    </div>
  );
}
