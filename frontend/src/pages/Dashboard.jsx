import { useEffect, useState } from 'react';
import { api, getUser } from '../api';

export default function Dashboard() {
  const user = getUser();
  const [notifications, setNotifications] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/notifications').then(res => setNotifications(res.data)).catch(() => {});
    if (user?.role === 'admin' || user?.role === 'support') {
      api.get('/admin/summary').then(res => setSummary(res.data)).catch(err => setError(err.response?.data?.message || 'Không tải được thống kê'));
    }
  }, []);

  return (
    <div>
      <h1>Tổng quan</h1>
      <p className="muted">Xin chào {user?.full_name}. Vai trò hiện tại: <strong>{user?.role}</strong></p>

      {summary && (
        <div className="grid four">
          <div className="stat"><strong>{summary.patients}</strong><span>Bệnh nhân</span></div>
          <div className="stat"><strong>{summary.doctors}</strong><span>Bác sĩ</span></div>
          <div className="stat"><strong>{summary.appointments}</strong><span>Lịch hẹn</span></div>
          <div className="stat"><strong>{summary.open_complaints}</strong><span>Khiếu nại mở</span></div>
          <div className="stat"><strong>{summary.pending_leave_requests}</strong><span>Đơn nghỉ chờ duyệt</span></div>
          <div className="stat"><strong>{summary.cancelled_appointments}</strong><span>Lịch đã hủy</span></div>
        </div>
      )}

      {error && <div className="alert danger">{error}</div>}

      <section className="panel">
        <h2>Thông báo</h2>
        {notifications.length === 0 && <p className="muted">Chưa có thông báo.</p>}
        <div className="list">
          {notifications.map(item => (
            <div className="list-item" key={item.id}>
              <strong>{item.title}</strong>
              <p>{item.message}</p>
              <small>{new Date(item.created_at).toLocaleString('vi-VN')}</small>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
