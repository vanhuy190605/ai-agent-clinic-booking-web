import { useEffect, useState } from 'react';
import { api } from '../api';

export default function AdminPanel() {
  const [role, setRole] = useState('patient');
  const [users, setUsers] = useState([]);
  const [specialties, setSpecialties] = useState([]);
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    full_name: '', email: '', password: '123456789', phone: '', role: 'patient', specialty_id: '', degree: '', experience: '', room: '', bio: ''
  });

  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  async function load() {
    const [userRes, specRes] = await Promise.all([api.get(`/admin/users?role=${role}`), api.get('/specialties')]);
    setUsers(userRes.data);
    setSpecialties(specRes.data);
  }

  useEffect(() => { load(); }, [role]);

  function resetForm() {
    setEditingId(null);
    setForm({ full_name: '', email: '', password: '123456789', phone: '', role: 'patient', specialty_id: '', degree: '', experience: '', room: '', bio: '' });
  }

  function startEdit(user) {
    setEditingId(user.id);
    setForm({
      full_name: user.full_name || '',
      email: user.email || '',
      password: '',
      phone: user.phone || '',
      role: user.role,
      specialty_id: user.specialty_id || '',
      degree: user.degree || '',
      experience: user.experience || '',
      room: user.room || '',
      bio: user.bio || ''
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveUser(e) {
    e.preventDefault();
    setNotice('');
    try {
      const res = editingId
        ? await api.put(`/admin/users/${editingId}`, form)
        : await api.post('/admin/users', form);
      setNotice(res.data.message);
      resetForm();
      load();
    } catch (err) {
      setNotice(err.response?.data?.message || 'Lưu tài khoản thất bại');
    }
  }

async function toggleUserStatus(user) {
  const nextStatus = user.is_active ? 0 : 1;
  const actionText = user.is_active ? 'khóa' : 'mở khóa';

  if (!confirm(`Bạn có chắc muốn ${actionText} tài khoản này không?`)) return;

  try {
    const res = await api.put(`/admin/users/${user.id}`, {
      is_active: nextStatus
    });

    setNotice(user.is_active ? 'Đã khóa tài khoản' : 'Đã mở khóa tài khoản');
    load();
  } catch (err) {
    setNotice(err.response?.data?.message || `${actionText} tài khoản thất bại`);
  }
}

  return (
    <div>
      <h1>Admin quản lý tài khoản</h1>
      <p className="muted">Admin có quyền thêm, sửa, xóa/khóa tài khoản bệnh nhân và bác sĩ.</p>
      {notice && <div className="alert">{notice}</div>}

      <form className="panel form-grid" onSubmit={saveUser}>
        <h2 className="wide">{editingId ? `Sửa tài khoản #${editingId}` : 'Tạo tài khoản mới'}</h2>
        <label>Loại tài khoản
          <select value={form.role} onChange={e => set('role', e.target.value)} disabled={Boolean(editingId)}>
            <option value="patient">Bệnh nhân</option>
            <option value="doctor">Bác sĩ</option>
            <option value="admin">Admin</option>
            <option value="support">CSKH</option>
          </select>
        </label>
        <label>Họ tên
          <input value={form.full_name} onChange={e => set('full_name', e.target.value)} required />
        </label>
        <label>Email
          <input type="email" value={form.email} onChange={e => set('email', e.target.value)} maxLength="150" required />
        </label>
        <label>Mật khẩu
          <input type="password" minLength={form.password ? 8 : undefined} maxLength="72" value={form.password} onChange={e => set('password', e.target.value)} required={!editingId} placeholder={editingId ? 'Để trống nếu không đổi' : ''} />
        </label>
        <label>SĐT
          <input value={form.phone} onChange={e => set('phone', e.target.value)} />
        </label>

        {form.role === 'doctor' && (
          <>
            <label>Chuyên khoa
              <select value={form.specialty_id} onChange={e => set('specialty_id', e.target.value)} required>
                <option value="">Chọn chuyên khoa</option>
                {specialties.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>Học vị
              <input value={form.degree} onChange={e => set('degree', e.target.value)} />
            </label>
            <label>Kinh nghiệm
              <input value={form.experience} onChange={e => set('experience', e.target.value)} />
            </label>
            <label>Phòng khám
              <input value={form.room} onChange={e => set('room', e.target.value)} />
            </label>
            <label className="wide">Mô tả bác sĩ
              <textarea value={form.bio} onChange={e => set('bio', e.target.value)} />
            </label>
          </>
        )}
        <div className="actions">
          <button>{editingId ? 'Lưu thay đổi' : 'Tạo tài khoản'}</button>
          {editingId && <button type="button" className="ghost" onClick={resetForm}>Hủy sửa</button>}
        </div>
      </form>

      <section className="panel">
        <div className="row between">
          <h2>Danh sách tài khoản</h2>
          <select value={role} onChange={e => setRole(e.target.value)}>
            <option value="patient">Bệnh nhân</option>
            <option value="doctor">Bác sĩ</option>
            <option value="admin">Admin</option>
            <option value="support">CSKH</option>
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Họ tên</th><th>Email</th><th>Role</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>{u.id}</td>
                  <td>{u.full_name}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.is_active ? 'Hoạt động' : 'Đã khóa'}</td>
                  <td><div className="actions">
                    <button onClick={() => startEdit(u)}>Sửa</button>
                    <button className="ghost" onClick={() => toggleUserStatus(u)}>
                      {u.is_active ? 'Khóa' : 'Mở khóa'}
                    </button>
                  </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
