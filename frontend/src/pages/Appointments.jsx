import { useEffect, useState } from 'react';
import { api, getUser } from '../api';

export default function Appointments() {
  const user = getUser();
  const [appointments, setAppointments] = useState([]);
  const [records, setRecords] = useState({});
  const [savedRecords, setSavedRecords] = useState({});
  const [cancelReasons, setCancelReasons] = useState({});
  const [message, setMessage] = useState('');

  async function load() {
    const url = user.role === 'admin' || user.role === 'support' ? '/appointments' : '/appointments/my';
    const [appointmentRes, recordRes] = await Promise.all([
      api.get(url),
      user.role === 'support' ? Promise.resolve({ data: [] }) : api.get('/medical-records/my')
    ]);
    setAppointments(appointmentRes.data);
    setSavedRecords(Object.fromEntries(recordRes.data.map(item => [item.appointment_id, item])));
  }

  useEffect(() => { load(); }, []);

  function setRecord(id, key, value) {
    setRecords(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: value } }));
  }

  async function updateStatus(id, status) {
    try {
      const res = await api.patch(`/appointments/${id}/status`, { status });
      setMessage(res.data.message);
      load();
    } catch (err) {
      setMessage(err.response?.data?.message || 'Cập nhật thất bại');
    }
  }

  async function cancelAppointment(id) {
    const reason = (cancelReasons[id] || '').trim();
    if (reason.length < 5) {
      setMessage('Vui lòng nhập lý do hủy ít nhất 5 ký tự');
      return;
    }
    if (!confirm('Bạn có chắc muốn hủy lịch hẹn này? Lịch sẽ được chuyển vào kho lịch đã hủy.')) return;

    try {
      const res = await api.post(`/appointments/${id}/cancel`, { reason });
      setMessage(res.data.message);
      setCancelReasons(prev => ({ ...prev, [id]: '' }));
      load();
    } catch (err) {
      setMessage(err.response?.data?.message || 'Hủy lịch thất bại');
    }
  }

  async function saveRecord(appt) {
    try {
      const data = records[appt.id] || {};
      const res = await api.post('/medical-records', {
        appointment_id: appt.id,
        symptoms: data.symptoms || appt.reason || '',
        diagnosis: data.diagnosis || '',
        prescription: data.prescription || '',
        doctor_note: data.doctor_note || ''
      });
      setMessage(res.data.message);
      load();
    } catch (err) {
      setMessage(err.response?.data?.message || 'Lưu hồ sơ thất bại');
    }
  }

  return (
    <div>
      <h1>Lịch hẹn đang hoạt động</h1>
      <p className="muted">Lịch bị hủy được tách riêng tại mục Kho lịch đã hủy và không bị xóa khỏi hệ thống.</p>
      {message && <div className="alert">{message}</div>}

      <div className="cards">
        {appointments.filter(appt => appt.status !== 'cancelled').map(appt => (
          <div className="panel" key={appt.id}>
            <div className="row between">
              <h3>#{appt.id} - {appt.specialty_name}</h3>
              <span className={`badge ${appt.status}`}>{appt.status}</span>
            </div>
            <p><strong>Bệnh nhân:</strong> {appt.patient_name}</p>
            <p><strong>Bác sĩ:</strong> {appt.doctor_name}</p>
            <p><strong>Ngày giờ:</strong> {appt.appointment_date} lúc {appt.appointment_time}</p>
            <p><strong>Lý do:</strong> {appt.reason || 'Không ghi'}</p>
            {appt.created_by_ai ? <p><span className="badge ai">Đặt bởi AI Agent</span></p> : null}

            {savedRecords[appt.id] && (
              <div className="record-summary">
                <h4>Hồ sơ khám</h4>
                <p><strong>Triệu chứng:</strong> {savedRecords[appt.id].symptoms || 'Không ghi'}</p>
                <p><strong>Chẩn đoán:</strong> {savedRecords[appt.id].diagnosis || 'Không ghi'}</p>
                <p><strong>Đơn thuốc / hướng xử lý:</strong> {savedRecords[appt.id].prescription || 'Không ghi'}</p>
                {(user.role === 'doctor' || user.role === 'admin') && savedRecords[appt.id].doctor_note && (
                  <p><strong>Ghi chú bác sĩ:</strong> {savedRecords[appt.id].doctor_note}</p>
                )}
              </div>
            )}

            {appt.status !== 'completed' && (user.role === 'doctor' || user.role === 'admin' || user.role === 'support') && (
              <div className="actions">
                <button onClick={() => updateStatus(appt.id, 'confirmed')}>Xác nhận</button>
                <button onClick={() => updateStatus(appt.id, 'completed')}>Tick đã khám</button>
              </div>
            )}

            {appt.status !== 'completed' && (
              <div className="cancel-box">
                <label>Lý do hủy lịch
                  <textarea
                    minLength="5"
                    maxLength="1000"
                    value={cancelReasons[appt.id] || ''}
                    onChange={e => setCancelReasons(prev => ({ ...prev, [appt.id]: e.target.value }))}
                    placeholder="Nhập lý do trước khi hủy"
                  />
                </label>
                <button className="danger-button" onClick={() => cancelAppointment(appt.id)}>Hủy lịch</button>
              </div>
            )}

            {user.role === 'doctor' && appt.status !== 'completed' && (
              <div className="record-form">
                <h4>Ghi chú hồ sơ khám</h4>
                <textarea placeholder="Triệu chứng" onChange={e => setRecord(appt.id, 'symptoms', e.target.value)} />
                <textarea placeholder="Chẩn đoán" onChange={e => setRecord(appt.id, 'diagnosis', e.target.value)} />
                <textarea placeholder="Đơn thuốc / hướng xử lý" onChange={e => setRecord(appt.id, 'prescription', e.target.value)} />
                <textarea placeholder="Ghi chú riêng của bác sĩ" onChange={e => setRecord(appt.id, 'doctor_note', e.target.value)} />
                <button onClick={() => saveRecord(appt)}>Lưu hồ sơ + tick đã khám</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {appointments.filter(appt => appt.status !== 'cancelled').length === 0 && <div className="panel muted">Chưa có lịch hẹn đang hoạt động.</div>}
    </div>
  );
}
