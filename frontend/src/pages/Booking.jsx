import { useEffect, useState } from 'react';
import { api } from '../api';

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function Booking() {
  const [specialties, setSpecialties] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [form, setForm] = useState({ specialty_id: '', doctor_id: '', date: todayPlus(1), time: '', reason: '' });
  const [availability, setAvailability] = useState(null);
  const [message, setMessage] = useState('');
  const [doctorsLoaded, setDoctorsLoaded] = useState(false);

  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  useEffect(() => {
    api.get('/specialties').then(res => setSpecialties(res.data));
  }, []);

  useEffect(() => {
    let active = true;
    setDoctorsLoaded(false);
    const params = new URLSearchParams({ date: form.date });
    if (form.specialty_id) params.set('specialty_id', form.specialty_id);

    api.get(`/doctors?${params.toString()}`)
      .then(res => {
        if (!active) return;
        setDoctors(res.data);
        setDoctorsLoaded(true);
        setForm(prev => {
          const selected = res.data.find(doctor => String(doctor.id) === String(prev.doctor_id));
          return selected?.available_for_booking ? prev : { ...prev, doctor_id: '', time: '' };
        });
      })
      .catch(err => {
        if (!active) return;
        setDoctors([]);
        setDoctorsLoaded(true);
        setMessage(err.response?.data?.message || 'Không tải được danh sách bác sĩ');
      });

    return () => { active = false; };
  }, [form.specialty_id, form.date]);

  useEffect(() => {
    setAvailability(null);
    if (!form.doctor_id || !form.date) return;
    api.get(`/availability?doctor_id=${form.doctor_id}&date=${form.date}`)
      .then(res => setAvailability(res.data))
      .catch(err => setMessage(err.response?.data?.message || 'Không tải được lịch trống'));
  }, [form.doctor_id, form.date]);

  const availableDoctors = doctors.filter(doctor => doctor.available_for_booking);
  const noDoctorForSpecialty = doctorsLoaded
    && Boolean(form.specialty_id)
    && availableDoctors.length === 0;

  async function book(e) {
    e.preventDefault();
    setMessage('');
    try {
      const res = await api.post('/appointments', {
        doctor_id: form.doctor_id,
        appointment_date: form.date,
        appointment_time: form.time,
        reason: form.reason
      });
      setMessage(res.data.message);
      const fresh = await api.get(`/availability?doctor_id=${form.doctor_id}&date=${form.date}`);
      setAvailability(fresh.data);
      set('time', '');
    } catch (err) {
      const data = err.response?.data;
      setMessage(`${data?.message || 'Đặt lịch thất bại'}${data?.availableSlots?.length ? ` Giờ còn trống: ${data.availableSlots.join(', ')}` : ''}`);
    }
  }

  return (
    <div>
      <h1>Đặt lịch khám</h1>
      <p className="muted">Chọn chuyên khoa, bác sĩ, ngày tháng năm và giờ khám. Hệ thống sẽ báo nếu trùng lịch hoặc bác sĩ nghỉ.</p>

      <form className="panel form-grid" onSubmit={book}>
        <label>Chuyên khoa
          <select value={form.specialty_id} onChange={e => {
            setForm(prev => ({ ...prev, specialty_id: e.target.value, doctor_id: '', time: '' }));
            setAvailability(null);
          }}>
            <option value="">Tất cả chuyên khoa</option>
            {specialties.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <label>Bác sĩ
          <select value={form.doctor_id} onChange={e => set('doctor_id', e.target.value)} required>
            <option value="">Chọn bác sĩ</option>
            {availableDoctors.map(d => (
              <option key={d.id} value={d.id}>
                {d.full_name} - {d.specialty_name} ({d.available_slots.length} giờ trống)
              </option>
            ))}
          </select>
        </label>

        <label>Ngày khám
          <input type="date" min={todayPlus(0)} value={form.date} onChange={e => {
            setForm(prev => ({ ...prev, date: e.target.value, doctor_id: '', time: '' }));
            setAvailability(null);
          }} required />
        </label>

        <label>Giờ khám
          <select value={form.time} onChange={e => set('time', e.target.value)} required>
            <option value="">Chọn giờ còn trống</option>
            {availability?.availableSlots?.map(slot => <option key={slot} value={slot}>{slot}</option>)}
          </select>
        </label>

        <label className="wide">Lý do khám
          <textarea value={form.reason} onChange={e => set('reason', e.target.value)} maxLength="1000" placeholder="Ví dụ: đau họng, ho 3 ngày..." />
        </label>

        <button disabled={!form.doctor_id || !form.time}>Đặt lịch</button>
      </form>

      {noDoctorForSpecialty && (
        <div className="alert danger">
          Không có bác sĩ thuộc chuyên khoa này làm việc hoặc còn giờ trống trong ngày đã chọn. Vui lòng chọn ngày khác.
        </div>
      )}

      {availability?.doctorOff && (
        <div className="alert danger">Bác sĩ nghỉ ngày này: {availability.reason}. Vui lòng chọn bác sĩ khác.</div>
      )}

      {availability && !availability.doctorOff && (
        <div className="panel">
          <h2>Tình trạng lịch</h2>
          <p><strong>Giờ còn trống:</strong> {availability.availableSlots.length ? availability.availableSlots.join(', ') : 'Không còn giờ trống'}</p>
          <p><strong>Giờ đã bận:</strong> {availability.busySlots.length ? availability.busySlots.join(', ') : 'Chưa có'}</p>
        </div>
      )}

      {message && <div className="alert">{message}</div>}
    </div>
  );
}