import { getUser } from './api';
import { navigate, usePathname } from './router.jsx';

import Layout from './components/Layout.jsx';

import HomePage from './pages/HomePage.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Booking from './pages/Booking.jsx';
import AIChat from './pages/AIChat.jsx';
import Appointments from './pages/Appointments.jsx';
import CancelledAppointments from './pages/CancelledAppointments.jsx';
import OnlineChat from './pages/OnlineChat.jsx';
import Complaints from './pages/Complaints.jsx';
import ComplaintsAdmin from './pages/ComplaintsAdmin.jsx';
import DoctorPanel from './pages/DoctorPanel.jsx';
import AdminPanel from './pages/AdminPanel.jsx';
import ScheduleManagement from './pages/ScheduleManagement.jsx';

export default function App() {
  const path = usePathname();
  const user = getUser();

  // Trang chủ công khai
  if (path === '/') {
    return <HomePage />;
  }

  // Trang đăng nhập và đăng ký
  if (path === '/login' || path === '/register') {
    if (user) {
      queueMicrotask(() => {
        navigate('/dashboard', { replace: true });
      });

      return null;
    }

    return (
      <Login
        key={path}
        initialMode={path === '/register' ? 'register' : 'login'}
      />
    );
  }

  // Các trang bên dưới yêu cầu đăng nhập
  if (!user) {
    queueMicrotask(() => {
      navigate('/login', { replace: true });
    });

    return null;
  }

  const routes = {
    '/dashboard': {
      element: <Dashboard />
    },

    '/booking': {
      roles: ['patient'],
      element: <Booking />
    },

    '/ai-chat': {
      roles: ['patient'],
      element: <AIChat />
    },

    '/appointments': {
      roles: ['patient', 'doctor', 'admin', 'support'],
      element: <Appointments />
    },

    '/cancelled-appointments': {
      roles: ['patient', 'doctor', 'admin', 'support'],
      element: <CancelledAppointments />
    },

    '/online-chat': {
      roles: ['patient', 'doctor'],
      element: <OnlineChat />
    },

    '/complaints': {
      roles: ['patient'],
      element: <Complaints />
    },

    '/complaints-admin': {
      roles: ['admin', 'support'],
      element: <ComplaintsAdmin />
    },

    '/doctor': {
      roles: ['doctor'],
      element: <DoctorPanel />
    },

    '/admin': {
      roles: ['admin'],
      element: <AdminPanel />
    },

    '/schedules': {
      roles: ['admin', 'support'],
      element: <ScheduleManagement />
    }
  };

  const route = routes[path];

  // Đường dẫn không tồn tại
  if (!route) {
    queueMicrotask(() => {
      navigate('/dashboard', { replace: true });
    });

    return null;
  }

  // Tài khoản không có quyền truy cập
  if (route.roles && !route.roles.includes(user.role)) {
    queueMicrotask(() => {
      navigate('/dashboard', { replace: true });
    });

    return null;
  }

  return <Layout user={user}>{route.element}</Layout>;
}