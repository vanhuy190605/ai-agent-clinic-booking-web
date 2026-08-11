import { useEffect, useState } from 'react';
import { api } from '../api';

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

export default function DoctorPanel() {
  const [calendar, setCalendar] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [policy, setPolicy] = useState({
    planned_notice_days: 3
  });
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    start_date: localDate(3),
    end_date: localDate(3),
    leave_type: 'planned',
    reason: ''
  });

  const setLeave = (key, value) => setLeaveForm(prev => ({ ...prev, [key]: value }));

  async function load() {
    const [calendarRes, leaveRes] = await Promise.all([
      api.get(`/doctor/calendar?from=${localDate()}&to=${localDate(29)}`),
      api.get('/doctor/leave-requests')
    ]);
    setCalendar(calendarRes.data);
    setLeaveRequests(leaveRes.data.items);
    setPolicy(leaveRes.data.policy);
  }

  useEffect(() => {
    load().catch(err => setNotice(err.response?.data?.message || 'Không tải được dữ liệu bác sĩ'));
  }, []);

  async function checkIn() {
    setLoading(true);
    setNotice('');
    try {
      const res = await api.post('/doctor/attendance', { work_date: localDate() });
      setNotice(res.data.message);
      await load();
    } catch (err) {
      setNotice(err.response?.data?.message || 'Điểm danh thất bại');
    } finally {
      setLoading(false);
    }
  }

  async function submitLeave(e) {
    e.preventDefault();
    setLoading(true);
    setNotice('');
    try {
      const res = await api.post('/doctor/leave-requests', leaveForm);
      setNotice(res.data.message);
      setLeaveForm({
        start_date: localDate(policy.planned_notice_days),
        end_date: localDate(policy.planned_notice_days),
        leave_type: 'planned',
        reason: ''
      });
      await load();
    } catch (err) {
      setNotice(err.response?.data?.message || 'Gửi đơn xin nghỉ thất bại');
    } finally {
      setLoading(false);
    }
  }

  async function withdraw(item) {
    const warning = item.leave_type === 'emergency'
      ? 'Rút báo nghỉ khẩn cấp sẽ mở lại các khung giờ chưa đặt. Bạn có chắc không?'
      : 'Bạn có chắc muốn rút đơn xin nghỉ này?';
    if (!confirm(warning)) return;
    try {
      const res = await api.patch(`/doctor/leave-requests/${item.id}/withdraw`);
      setNotice(res.data.message);
      await load();
    } catch (err) {
      setNotice(err.response?.data?.message || 'Không rút được đơn');
    }
  }

  return (
    <div>
      <h1>Chấm công và xin nghỉ</h1>
      <p className="muted">Xem lịch làm việc, điểm danh hôm nay và theo dõi kết quả duyệt nghỉ.</p>
      {notice && <div className="alert">{notice}</div>}

      <section className="panel">
        <div className="row between">
          <div>
            <h2>Điểm danh hôm nay</h2>
            <p className="muted">Chỉ điểm danh được khi hôm nay có ca và không phải ngày nghỉ đã duyệt.</p>
          </div>
          <button disabled={loading} onClick={checkIn}>Điểm danh đi làm</button>
        </div>
      </section>

      <section className="panel">
        <h2>Lịch làm việc 30 ngày</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Ngày</th><th>Ca làm</th><th>Lịch khám</th><th>Trạng thái</th><th>Giờ điểm danh</th></tr>
            </thead>
            <tbody>
              {calendar.map(day => (
                <tr key={day.work_date}>
                  <td>{day.work_date}</td>
                  <td>{day.shifts.length ? day.shifts.map(s => `${s.start_time}–${s.end_time}`).join(', ') : '—'}</td>
                  <td>{day.appointment_count}</td>
                  <td><span className={`badge ${day.day_status}`}>{DAY_STATUS[day.day_status]}</span></td>
                  <td>{day.check_in_at || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <form className="panel form-grid" onSubmit={submitLeave}>
        <h2 className="wide">Gửi đơn xin nghỉ</h2>
        <label>Loại nghỉ
          <select value={leaveForm.leave_type} onChange={e => {
            const leaveType = e.target.value;
            setLeaveForm(prev => leaveType === 'emergency'
              ? {
                ...prev,
                leave_type: leaveType,
                start_date: localDate(),
                end_date: prev.end_date < localDate() ? localDate() : prev.end_date
              }
              : {
                ...prev,
                leave_type: leaveType,
                start_date: localDate(policy.planned_notice_days),
                end_date: localDate(policy.planned_notice_days)
              });
          }}>
            <option value="planned">Nghỉ có kế hoạch</option>
            <option value="emergency">Nghỉ khẩn cấp</option>
          </select>
        </label>
        <label>Từ ngày
          <input
            type="date"
            min={localDate()}
            max={leaveForm.leave_type === 'emergency' ? localDate() : undefined}
            disabled={leaveForm.leave_type === 'emergency'}
            value={leaveForm.start_date}
            onChange={e => {
              setLeave('start_date', e.target.value);
              if (leaveForm.end_date < e.target.value) setLeave('end_date', e.target.value);
            }}
            required
          />
        </label>
        <label>Đến ngày
          <input type="date" min={leaveForm.start_date} value={leaveForm.end_date} onChange={e => setLeave('end_date', e.target.value)} required />
        </label>
        <label className="wide">Lý do nghỉ
          <textarea
            minLength="10"
            maxLength="2000"
            value={leaveForm.reason}
            onChange={e => setLeave('reason', e.target.value)}
            placeholder="Trình bày lý do ít nhất 10 ký tự"
            required
          />
        </label>
        <p className="wide muted">
          {leaveForm.leave_type === 'planned'
            ? `Nghỉ có kế hoạch phải gửi trước ít nhất ${policy.planned_notice_days} ngày và chỉ khóa lịch sau khi Admin duyệt.`
            : 'Nghỉ khẩn cấp phải bắt đầu từ hôm nay, khóa lịch mới ngay và được Admin hậu kiểm.'}
          {' '}Mỗi đơn tối đa 30 ngày.
        </p>
        <button disabled={loading}>
          {leaveForm.leave_type === 'emergency'
            ? 'Báo nghỉ khẩn cấp và khóa lịch ngay'
            : 'Gửi đơn chờ duyệt'}
        </button>
      </form>

      <section className="panel">
        <h2>Lịch sử đơn xin nghỉ</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Mã</th><th>Khoảng ngày</th><th>Loại</th><th>Trạng thái</th><th>Lịch ảnh hưởng</th><th>Xử lý</th><th>Thao tác</th></tr>
            </thead>
            <tbody>
              {leaveRequests.map(item => (
                <tr key={item.id}>
                  <td>#{item.id}</td>
                  <td>{item.start_date} → {item.end_date}</td>
                  <td>{item.leave_type === 'emergency' ? 'Khẩn cấp' : 'Kế hoạch'}</td>
                  <td>
                    <span className={`badge ${leaveStatusClass(item)}`}>{leaveStatusLabel(item)}</span>
                  </td>
                  <td>{item.impacted_appointments}</td>
                  <td>
                    {item.resolution_action === 'replace' && `Thay bằng ${item.replacement_doctor_name}`}
                    {item.resolution_action === 'cancel' && 'Hủy lịch bị ảnh hưởng'}
                    {item.resolution_action === 'none' && 'Không có lịch ảnh hưởng'}
                    {!item.resolution_action && (item.review_note || 'Chưa xử lý')}
                  </td>
                  <td>
                    <div className="actions">
                      {item.status === 'pending' ? <button type="button" className="danger-button" onClick={() => withdraw(item)}>Rút đơn</button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!leaveRequests.length && <p className="muted">Chưa có đơn xin nghỉ.</p>}
      </section>
    </div>
  );
}