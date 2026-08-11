import { useEffect, useState } from 'react';
import { api, getUser } from '../api';

function localDate(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const DAY_STATUS = {
  scheduled: 'Có ca / chưa điểm danh',
  checked_in: 'Đã điểm danh',
  approved_leave: 'Nghỉ đã duyệt',
  pending_leave: 'Đang xin nghỉ',
  emergency_leave: 'Nghỉ khẩn cấp - chờ xác nhận',
  unexcused_leave: 'Nghỉ khẩn cấp không phép',
  not_scheduled: 'Không có ca'
};

function leaveStatusLabel(item) {
  if (item.leave_type === 'emergency') {
    if (item.status === 'pending') return 'Đang nghỉ khẩn cấp - chờ xác nhận';
    if (item.status === 'approved') return 'Đã xác nhận khẩn cấp';
    if (item.status === 'rejected') return 'Không xác nhận - nghỉ không phép';
  }
  return {
    pending: 'Chờ duyệt',
    approved: 'Đã duyệt',
    rejected: 'Từ chối',
    withdrawn: 'Đã rút'
  }[item.status] || item.status;
}

function leaveStatusClass(item) {
  if (item.leave_type === 'emergency' && item.status === 'pending') return 'emergency_pending';
  if (item.leave_type === 'emergency' && item.status === 'rejected') return 'unexcused_leave';
  return item.status;
}

export default function ScheduleManagement() {
  const user = getUser();
  const [selectedDate, setSelectedDate] = useState(localDate());
  const [doctors, setDoctors] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [notice, setNotice] = useState('');
  const [reviewing, setReviewing] = useState(null);
  const [coverage, setCoverage] = useState({ appointments: [], candidates: [] });
  const [reviewForm, setReviewForm] = useState({ review_note: '', replacement_doctor_id: '' });
  const [form, setForm] = useState({
    doctor_id: '',
    work_date: localDate(),
    start_time: '08:00',
    end_time: '11:00'
  });

  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  async function load() {
    const [doctorRes, attendanceRes, leaveRes] = await Promise.all([
      api.get('/doctors'),
      api.get(`/attendance?date=${selectedDate}`),
      api.get('/admin/leave-requests?status=all')
    ]);
    setDoctors(doctorRes.data);
    setAttendance(attendanceRes.data);
    setLeaveRequests(leaveRes.data);
  }

  useEffect(() => {
    setForm(prev => ({ ...prev, work_date: selectedDate }));
    load().catch(err => setNotice(err.response?.data?.message || 'Không tải được lịch làm việc'));
  }, [selectedDate]);

  async function submitSchedule(e) {
    e.preventDefault();
    setNotice('');
    try {
      const res = await api.post('/admin/schedules', form);
      setNotice(res.data.message);
      await load();
    } catch (err) {
      setNotice(err.response?.data?.message || 'Không thêm được lịch làm việc');
    }
  }

  async function openReview(item) {
    setNotice('');
    try {
      const res = await api.get(`/admin/leave-requests/${item.id}/coverage`);
      setReviewing(item);
      setCoverage(res.data);
      setReviewForm({ review_note: '', replacement_doctor_id: res.data.candidates[0]?.id || '' });
    } catch (err) {
      setNotice(err.response?.data?.message || 'Không tải được dữ liệu điều phối');
    }
  }

  async function review(decision, resolutionAction = 'none') {
    if (!reviewing) return;
    const actionText = decision === 'rejected' && resolutionAction === 'replace'
      ? 'không xác nhận lý do nghỉ và chuyển lịch sang bác sĩ thay thế'
      : decision === 'rejected' && resolutionAction === 'cancel'
        ? 'không xác nhận lý do nghỉ và hủy các lịch bị ảnh hưởng'
        : decision === 'rejected'
          ? 'từ chối đơn này'
      : resolutionAction === 'replace'
        ? 'duyệt và chuyển các lịch sang bác sĩ thay thế'
        : resolutionAction === 'cancel'
          ? 'duyệt và hủy các lịch bị ảnh hưởng'
          : 'duyệt đơn này';
    if (!confirm(`Bạn có chắc muốn ${actionText}?`)) return;

    try {
      const res = await api.patch(`/admin/leave-requests/${reviewing.id}/review`, {
        decision,
        resolution_action: resolutionAction,
        replacement_doctor_id: reviewForm.replacement_doctor_id || null,
        review_note: reviewForm.review_note
      });
      setNotice(res.data.message);
      setReviewing(null);
      await load();
    } catch (err) {
      setNotice(err.response?.data?.message || 'Duyệt đơn thất bại');
    }
  }

  return (
    <div>
      <h1>Điều phối lịch bác sĩ</h1>
      <p className="muted">Xem ai làm, ai nghỉ, trạng thái điểm danh và xử lý đơn xin nghỉ.</p>
      {notice && <div className="alert">{notice}</div>}

      <section className="panel">
        <div className="row between wrap">
          <div>
            <h2>Trạng thái theo ngày</h2>
            <p className="muted">Chọn nhanh hôm nay hoặc ngày mai để theo dõi.</p>
          </div>
          <div className="actions">
            <button className={selectedDate === localDate() ? '' : 'ghost'} onClick={() => setSelectedDate(localDate())}>Hôm nay</button>
            <button className={selectedDate === localDate(1) ? '' : 'ghost'} onClick={() => setSelectedDate(localDate(1))}>Ngày mai</button>
            <input className="date-compact" type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Bác sĩ</th><th>Chuyên khoa</th><th>Ca làm</th><th>Lịch khám</th><th>Trạng thái</th><th>Điểm danh</th></tr>
            </thead>
            <tbody>
              {attendance.map(item => (
                <tr key={item.doctor_id}>
                  <td>{item.doctor_name}</td>
                  <td>{item.specialty_name}</td>
                  <td>{item.shifts || '—'}</td>
                  <td>{item.appointment_count}</td>
                  <td>
                    <span className={`badge ${item.day_status}`}>{DAY_STATUS[item.day_status]}</span>
                    {item.leave_reason ? <div className="small-note">{item.leave_reason}</div> : null}
                  </td>
                  <td>{item.check_in_at || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <form className="panel form-grid" onSubmit={submitSchedule}>
        <h2 className="wide">Thêm ca làm việc</h2>
        <label>Bác sĩ
          <select value={form.doctor_id} onChange={e => set('doctor_id', e.target.value)} required>
            <option value="">Chọn bác sĩ</option>
            {doctors.map(d => <option key={d.id} value={d.id}>{d.full_name} - {d.specialty_name}</option>)}
          </select>
        </label>
        <label>Ngày làm
          <input type="date" min={localDate()} value={form.work_date} onChange={e => {
            set('work_date', e.target.value);
            setSelectedDate(e.target.value);
          }} required />
        </label>
        <label>Bắt đầu
          <input type="time" step="1800" value={form.start_time} onChange={e => set('start_time', e.target.value)} required />
        </label>
        <label>Kết thúc
          <input type="time" step="1800" value={form.end_time} onChange={e => set('end_time', e.target.value)} required />
        </label>
        <button>Thêm ca làm việc</button>
      </form>

      <section className="panel">
        <h2>Đơn xin nghỉ</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Mã</th><th>Bác sĩ</th><th>Ngày nghỉ</th><th>Loại</th><th>Lý do</th><th>Lịch ảnh hưởng</th><th>Trạng thái</th><th>Thao tác</th></tr>
            </thead>
            <tbody>
              {leaveRequests.map(item => (
                <tr key={item.id}>
                  <td>#{item.id}</td>
                  <td>{item.doctor_name}<div className="small-note">{item.specialty_name}</div></td>
                  <td>{item.start_date} → {item.end_date}</td>
                  <td>{item.leave_type === 'emergency' ? 'Khẩn cấp' : 'Kế hoạch'}</td>
                  <td>{item.reason}</td>
                  <td>{item.impacted_appointments}</td>
                  <td>
                    <span className={`badge ${leaveStatusClass(item)}`}>{leaveStatusLabel(item)}</span>
                    {item.replacement_doctor_name ? <div className="small-note">Thay: {item.replacement_doctor_name}</div> : null}
                  </td>
                  <td>
                    <div className="actions">
                      {item.status === 'pending' && user.role === 'admin' ? <button onClick={() => openReview(item)}>Xử lý</button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!leaveRequests.length && <p className="muted">Chưa có đơn xin nghỉ.</p>}
      </section>

      {reviewing && (
        <section className="panel review-panel">
          <div className="row between">
            <div>
              <h2>Xử lý đơn #{reviewing.id}</h2>
              <p>{reviewing.doctor_name}: {reviewing.start_date} → {reviewing.end_date}</p>
              {reviewing.leave_type === 'emergency' ? (
                <p className="small-note">
                  Đây là báo nghỉ khẩn cấp: lịch mới đã bị khóa ngay. Admin đang hậu kiểm lý do và phải xử lý các lịch bệnh nhân hiện có.
                </p>
              ) : null}
            </div>
            <button className="ghost" onClick={() => setReviewing(null)}>Đóng</button>
          </div>

          <label>Ghi chú duyệt / lý do từ chối
            <textarea value={reviewForm.review_note} onChange={e => setReviewForm(prev => ({ ...prev, review_note: e.target.value }))} />
          </label>

          <h3>Lịch khám bị ảnh hưởng: {coverage.appointments.length}</h3>
          {coverage.appointments.length > 0 ? (
            <div className="list compact-list">
              {coverage.appointments.map(item => (
                <div className="list-item" key={item.id}>
                  #{item.id} · {item.patient_name} · {item.appointment_date} lúc {item.appointment_time}
                </div>
              ))}
            </div>
          ) : <p className="muted">Không có bệnh nhân bị ảnh hưởng.</p>}

          {coverage.appointments.length > 0 && (
            <label>Bác sĩ cùng chuyên khoa có thể thay toàn bộ lịch
              <select
                value={reviewForm.replacement_doctor_id}
                onChange={e => setReviewForm(prev => ({ ...prev, replacement_doctor_id: e.target.value }))}
              >
                <option value="">Chọn bác sĩ thay thế</option>
                {coverage.candidates.map(item => <option key={item.id} value={item.id}>{item.full_name}</option>)}
              </select>
            </label>
          )}

          <div className="actions">
            {coverage.appointments.length === 0 ? <button onClick={() => review('approved', 'none')}>Duyệt đơn</button> : null}
            {coverage.appointments.length > 0 ? (
              <button disabled={!reviewForm.replacement_doctor_id} onClick={() => review('approved', 'replace')}>
                Duyệt + thay bác sĩ
              </button>
            ) : null}
            {coverage.appointments.length > 0 ? (
              <button className="danger-button" onClick={() => review('approved', 'cancel')}>
                Duyệt + hủy lịch
              </button>
            ) : null}
            {reviewing.leave_type === 'emergency' && coverage.appointments.length > 0 ? (
              <button
                className="ghost"
                disabled={!reviewForm.replacement_doctor_id}
                onClick={() => review('rejected', 'replace')}
              >
                Không xác nhận + thay bác sĩ
              </button>
            ) : null}
            {reviewing.leave_type === 'emergency' && coverage.appointments.length > 0 ? (
              <button className="danger-button" onClick={() => review('rejected', 'cancel')}>
                Không xác nhận + hủy lịch
              </button>
            ) : null}
            {reviewing.leave_type !== 'emergency' || coverage.appointments.length === 0 ? (
              <button className="ghost" onClick={() => review('rejected', 'none')}>
                {reviewing.leave_type === 'emergency' ? 'Không xác nhận (nghỉ không phép)' : 'Từ chối'}
              </button>
            ) : null}
          </div>
          {coverage.appointments.length > 0 && !coverage.candidates.length ? (
            <p className="alert danger">Không có bác sĩ cùng chuyên khoa đủ ca trống. Admin cần từ chối đơn hoặc duyệt và hủy lịch.</p>
          ) : null}
        </section>
      )}
    </div>
  );
}