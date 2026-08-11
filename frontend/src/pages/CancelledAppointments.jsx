import { useEffect, useState } from 'react';
import { api } from '../api';

const ACTOR = {
  patient: 'Bệnh nhân',
  doctor: 'Bác sĩ',
  admin: 'Admin',
  support: 'CSKH',
  system: 'Hệ thống'
};

export default function CancelledAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get('/appointments/cancelled')
      .then(res => setAppointments(res.data))
      .catch(err => setMessage(err.response?.data?.message || 'Không tải được kho lịch đã hủy'));
  }, []);

  return (
    <div>
      <h1>Kho lịch đã hủy</h1>
      <p className="muted">Lưu đầy đủ lịch do bệnh nhân, bác sĩ, admin hoặc hệ thống hủy để tra cứu sau này.</p>
      {message && <div className="alert danger">{message}</div>}

      <div className="cards">
        {appointments.map(item => (
          <article className="panel cancelled-card" key={item.id}>
            <div className="row between">
              <h3>#{item.id} - {item.specialty_name}</h3>
              <span className="badge cancelled">Đã hủy</span>
            </div>
            <p><strong>Bệnh nhân:</strong> {item.patient_name}</p>
            <p><strong>Bác sĩ:</strong> {item.doctor_name}</p>
            <p><strong>Lịch khám cũ:</strong> {item.appointment_date} lúc {item.appointment_time}</p>
            <p><strong>Người hủy:</strong> {item.cancelled_by_name || ACTOR[item.cancelled_by_role] || 'Dữ liệu cũ'} ({ACTOR[item.cancelled_by_role] || 'Không rõ'})</p>
            <p><strong>Lý do hủy:</strong> {item.cancellation_reason || 'Lịch cũ chưa ghi lý do'}</p>
            <p><strong>Thời điểm hủy:</strong> {item.cancelled_at ? new Date(item.cancelled_at).toLocaleString('vi-VN') : 'Không có dữ liệu'}</p>
          </article>
        ))}
      </div>

      {!appointments.length && <div className="panel muted">Chưa có lịch hẹn nào bị hủy.</div>}
    </div>
  );
}
