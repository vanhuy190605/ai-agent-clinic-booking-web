import { clearSession } from '../api';
import { Link, navigate, usePathname } from '../router.jsx';

export default function Layout({ user, children }) {
  const pathname = usePathname();

  const logout = () => {
    clearSession();
    navigate('/login');
  };

  const navLink = (to, label) => (
    <Link to={to} className={pathname === to ? 'active' : ''}>{label}</Link>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Clinic AI</div>
        <div className="user-card">
          <strong>{user?.full_name}</strong>
          <span>{user?.role}</span>
        </div>

        <nav>
          {navLink('/dashboard', 'Tổng quan')}
          {user?.role === 'patient' && navLink('/booking', 'Đặt lịch')}
          {user?.role === 'patient' && navLink('/ai-chat', 'Chat AI đặt lịch')}
          {navLink('/appointments', 'Lịch hẹn')}
          {navLink('/cancelled-appointments', 'Kho lịch đã hủy')}
          {(user?.role === 'patient' || user?.role === 'doctor') && navLink('/online-chat', 'Chat bác sĩ/bệnh nhân')}
          {user?.role === 'patient' && navLink('/complaints', 'Khiếu nại CSKH')}
          {(user?.role === 'admin' || user?.role === 'support') && navLink('/complaints-admin', 'Xử lý khiếu nại')}
          {(user?.role === 'admin' || user?.role === 'support') && navLink('/schedules', 'Điều phối bác sĩ')}
          {user?.role === 'doctor' && navLink('/doctor', 'Chấm công & xin nghỉ')}
          {user?.role === 'admin' && navLink('/admin', 'Admin')}
        </nav>

        <button className="ghost" onClick={logout}>Đăng xuất</button>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
