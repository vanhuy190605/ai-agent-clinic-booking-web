import { useState } from 'react';
import { api, setSession } from '../api';
import { navigate } from '../router.jsx';

export default function Login({ initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({
    full_name: '',
    email: 'patient@gmail.com',
    password: '123456789',
    phone: '',
    code: '',
    new_password: ''
  });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      if (mode === 'login') {
        const res = await api.post('/auth/login', { email: form.email, password: form.password });
        setSession(res.data.token, res.data.user);
        navigate('/dashboard');
      }
      if (mode === 'register') {
        const res = await api.post('/auth/register', {
          full_name: form.full_name,
          email: form.email,
          password: form.password,
          phone: form.phone
        });
        setSession(res.data.token, res.data.user);
        navigate('/dashboard');
      }
      if (mode === 'forgot') {
        const res = await api.post('/auth/forgot-password', { email: form.email });
        setMessage(`${res.data.message}${res.data.demo_code ? ` Mã demo: ${res.data.demo_code}` : ''}`);
        setMode('reset');
      }
      if (mode === 'reset') {
        const res = await api.post('/auth/reset-password', {
          email: form.email,
          code: form.code,
          new_password: form.new_password
        });
        setMessage(res.data.message);
        setMode('login');
      }
    } catch (err) {
      setMessage(err.response?.data?.message || 'Có lỗi xảy ra');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>Clinic AI Agent</h1>
        <p className="muted">Đặt lịch khám trực tuyến, chat AI và chat bác sĩ.</p>

        {mode === 'register' && (
          <label>Họ tên
            <input value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="Nguyễn Văn A" maxLength="120" required />
          </label>
        )}

        <label>Email
          <input type="email" autoComplete="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="email@gmail.com" maxLength="150" required />
        </label>

        {(mode === 'login' || mode === 'register') && (
          <label>Mật khẩu
            <input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength="8" maxLength="72" value={form.password} onChange={e => set('password', e.target.value)} required />
          </label>
        )}

        {mode === 'register' && (
          <label>Số điện thoại
            <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} maxLength="30" />
          </label>
        )}

        {mode === 'reset' && (
          <>
            <label>Mã xác nhận
              <input inputMode="numeric" pattern="[0-9]{6}" value={form.code} onChange={e => set('code', e.target.value)} placeholder="6 chữ số" required />
            </label>
            <label>Mật khẩu mới
              <input type="password" autoComplete="new-password" minLength="8" maxLength="72" value={form.new_password} onChange={e => set('new_password', e.target.value)} required />
            </label>
          </>
        )}

        <button disabled={loading}>{loading ? 'Đang xử lý...' : mode === 'login' ? 'Đăng nhập' : mode === 'register' ? 'Đăng ký bệnh nhân' : mode === 'forgot' ? 'Gửi mã Gmail' : 'Đổi mật khẩu'}</button>
        {message && <div className="alert">{message}</div>}

        <div className="switcher">
          <button type="button" onClick={() => setMode('login')}>Đăng nhập</button>
          <button type="button" onClick={() => setMode('register')}>Đăng ký</button>
          <button type="button" onClick={() => setMode('forgot')}>Quên mật khẩu</button>
        </div>

        <div className="demo-box">
          <strong>Tài khoản mẫu</strong>
          <span>Admin: admin@gmail.com / 123456789</span>
          <span>Bệnh nhân: patient@gmail.com / 123456789</span>
          <span>Bác sĩ: taimuihong@gmail.com / 123456789</span>
          <span>CSKH: support@gmail.com / 123456789</span>
        </div>
      </form>
    </div>
  );
}
