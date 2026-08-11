import { useEffect, useState } from 'react';
import { api, getUser } from '../api';
import { Link } from '../router.jsx';

const fallbackSpecialties = [
  {
    id: 'noi-tong-quat',
    name: 'Nội tổng quát',
    description: 'Khám sức khỏe, sốt, đau đầu và tư vấn ban đầu.',
    icon: '🩺'
  },
  {
    id: 'tim-mach',
    name: 'Tim mạch',
    description: 'Khám huyết áp, đau ngực và các bệnh tim mạch.',
    icon: '♥'
  },
  {
    id: 'tai-mui-hong',
    name: 'Tai Mũi Họng',
    description: 'Chẩn đoán và điều trị bệnh tai, mũi và họng.',
    icon: '✚'
  },
  {
    id: 'nhi-khoa',
    name: 'Nhi khoa',
    description: 'Theo dõi và chăm sóc sức khỏe trẻ em.',
    icon: '♟'
  },
  {
    id: 'da-lieu',
    name: 'Da liễu',
    description: 'Khám và điều trị các vấn đề về da.',
    icon: '✦'
  },
  {
    id: 'rang-ham-mat',
    name: 'Răng Hàm Mặt',
    description: 'Chăm sóc răng miệng và tư vấn điều trị.',
    icon: '◆'
  }
];

const fallbackDoctors = [
  {
    id: 'doctor-1',
    full_name: 'BS. Phạm Anh Tuấn',
    specialty_name: 'Nội tổng quát',
    degree: 'Bác sĩ CKI',
    experience: '5 năm',
    room: 'P101'
  },
  {
    id: 'doctor-2',
    full_name: 'BS. Nguyễn Minh An',
    specialty_name: 'Tai Mũi Họng',
    degree: 'Thạc sĩ - Bác sĩ',
    experience: '8 năm',
    room: 'P102'
  },
  {
    id: 'doctor-3',
    full_name: 'BS. Võ Hoàng Nam',
    specialty_name: 'Tim mạch',
    degree: 'Thạc sĩ - Bác sĩ',
    experience: '9 năm',
    room: 'P105'
  }
];

function initials(name = '') {
  return name
    .replace(/^BS\.\s*/i, '')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map(word => word[0])
    .join('')
    .toUpperCase();
}

export default function HomePage() {
  const user = getUser();

  const [specialties, setSpecialties] = useState([]);
  const [doctors, setDoctors] = useState([]);

  const bookingPath =
    user?.role === 'patient'
      ? '/booking'
      : user
        ? '/dashboard'
        : '/login';

  useEffect(() => {
    let active = true;

    Promise.allSettled([
      api.get('/specialties'),
      api.get('/doctors')
    ]).then(([specialtyResult, doctorResult]) => {
      if (!active) return;

      if (specialtyResult.status === 'fulfilled') {
        setSpecialties(specialtyResult.value.data);
      }

      if (doctorResult.status === 'fulfilled') {
        setDoctors(doctorResult.value.data);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  const shownSpecialties = specialties.length
    ? specialties.slice(0, 6)
    : fallbackSpecialties;

  const shownDoctors = doctors.length
    ? doctors
    : fallbackDoctors;

  return (
    <div className="clinic-page">
      <div className="clinic-topbar">
        <div className="clinic-container clinic-topbar-inner">
          <span>Thứ Hai - Chủ Nhật: 07:00 - 21:00</span>

          <a href="tel:19001234">
            Hotline tư vấn: <strong>1900 1234</strong>
          </a>
        </div>
      </div>

      <header className="clinic-header">
        <div className="clinic-container clinic-header-inner">
          <a
            className="clinic-logo"
            href="#top"
            aria-label="Clinic AI - Trang chủ"
          >
            <span className="clinic-logo-mark">+</span>

            <span>
              CLINIC <b>AI</b>
            </span>
          </a>

          <nav
            className="clinic-nav"
            aria-label="Điều hướng chính"
          >
            <a href="#about">Giới thiệu</a>
            <a href="#specialties">Chuyên khoa</a>
            <a href="#doctors">Bác sĩ</a>
            <a href="#contact">Liên hệ</a>
          </nav>

          <div className="clinic-auth">
            {user ? (
              <Link
                className="clinic-btn clinic-btn-primary clinic-btn-small"
                to="/dashboard"
              >
                Vào hệ thống
              </Link>
            ) : (
              <>
                <Link
                  className="clinic-btn clinic-btn-ghost clinic-btn-small"
                  to="/login"
                >
                  Sign in
                </Link>

                <Link
                  className="clinic-btn clinic-btn-primary clinic-btn-small"
                  to="/register"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="top">
        <section
          className="clinic-hero"
          id="about"
        >
          <div className="clinic-container clinic-hero-grid">
            <div className="clinic-hero-content">
              <span className="clinic-eyebrow">
                Chăm sóc sức khỏe toàn diện
              </span>

              <h1>Sức khỏe của bạn là ưu tiên của chúng tôi</h1>

              <p>
                Xem thông tin bác sĩ, lựa chọn chuyên khoa và đặt lịch
                khám trực tuyến nhanh chóng, thuận tiện.
              </p>

              <div className="clinic-hero-actions">
                <Link
                  className="clinic-btn clinic-btn-primary"
                  to={bookingPath}
                >
                  Đặt lịch khám
                </Link>

                <a
                  className="clinic-btn clinic-btn-ghost"
                  href="#doctors"
                >
                  Xem đội ngũ bác sĩ
                </a>
              </div>

              <div className="clinic-trust-row">
                <div>
                  <strong>20+</strong>
                  <span>Bác sĩ</span>
                </div>

                <div>
                  <strong>10+</strong>
                  <span>Chuyên khoa</span>
                </div>

                <div>
                  <strong>5.000+</strong>
                  <span>Lượt khám</span>
                </div>
              </div>
            </div>

            <div className="clinic-hero-media">
              <img
                src="https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=1000&q=85"
                alt="Bác sĩ tại Clinic AI"
              />

              <div className="clinic-floating-card clinic-floating-card-top">
                <span className="clinic-floating-icon">✓</span>

                <div>
                  <strong>Đặt lịch dễ dàng</strong>
                  <small>Chỉ trong vài phút</small>
                </div>
              </div>

              <div className="clinic-floating-card clinic-floating-card-bottom">
                <span className="clinic-floating-icon">24</span>

                <div>
                  <strong>Hỗ trợ tận tâm</strong>
                  <small>Tư vấn mỗi ngày</small>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          className="clinic-section"
          id="specialties"
        >
          <div className="clinic-container">
            <div className="clinic-section-heading">
              <div>
                <span className="clinic-eyebrow">
                  Dịch vụ y tế
                </span>

                <h2>Chuyên khoa nổi bật</h2>
              </div>

              <p>
                Lựa chọn đúng chuyên khoa để được thăm khám và tư vấn
                phù hợp.
              </p>
            </div>

            <div className="clinic-specialty-grid">
              {shownSpecialties.map((specialty, index) => (
                <article
                  className="clinic-specialty-card"
                  key={specialty.id}
                >
                  <span className="clinic-specialty-icon">
                    {specialty.icon ||
                      fallbackSpecialties[index]?.icon ||
                      '+'}
                  </span>

                  <h3>{specialty.name}</h3>

                  <p>
                    {specialty.description ||
                      'Tư vấn và thăm khám bởi đội ngũ bác sĩ chuyên môn.'}
                  </p>

                  <Link to={bookingPath}>
                    Đặt lịch <span>→</span>
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className="clinic-section clinic-doctor-section"
          id="doctors"
        >
          <div className="clinic-container">
            <div className="clinic-section-heading clinic-heading-center">
              <div>
                <span className="clinic-eyebrow">
                  Đội ngũ chuyên môn
                </span>

                <h2>Bác sĩ giàu kinh nghiệm</h2>
              </div>

              <p>
                Thông tin được lấy trực tiếp từ cơ sở dữ liệu của hệ thống.
              </p>
            </div>

            <div className="clinic-doctor-grid">
              {shownDoctors.map((doctor, index) => (
                <article
                  className="clinic-doctor-card"
                  key={doctor.id}
                >
                  <div
                    className={`clinic-doctor-avatar clinic-avatar-${(index % 3) + 1}`}
                  >
                    {initials(doctor.full_name)}
                  </div>

                  <span className="clinic-doctor-specialty">
                    {doctor.specialty_name}
                  </span>

                  <h3>{doctor.full_name}</h3>

                  <p>{doctor.degree || 'Bác sĩ chuyên khoa'}</p>

                  <div className="clinic-doctor-meta">
                    <span>
                      Kinh nghiệm:
                      <strong>
                        {doctor.experience || 'Đang cập nhật'}
                      </strong>
                    </span>

                    <span>
                      Phòng khám:
                      <strong>
                        {doctor.room || 'Đang cập nhật'}
                      </strong>
                    </span>
                  </div>

                  <Link
                    className="clinic-btn clinic-btn-light"
                    to={bookingPath}
                  >
                    Đặt lịch với bác sĩ
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className="clinic-contact"
          id="contact"
        >
          <div className="clinic-container clinic-contact-card">
            <div>
              <span className="clinic-eyebrow clinic-eyebrow-light">
                Cần được hỗ trợ?
              </span>

              <h2>Liên hệ Clinic AI để được tư vấn</h2>

              <p>
                Đội ngũ chăm sóc khách hàng hỗ trợ từ 07:00 đến 21:00
                mỗi ngày.
              </p>
            </div>

            <div className="clinic-contact-actions">
              <a
                className="clinic-btn clinic-btn-white"
                href="tel:19001234"
              >
                Gọi 1900 1234
              </a>

              <Link
                className="clinic-btn clinic-btn-outline-white"
                to={bookingPath}
              >
                Đặt lịch ngay
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="clinic-footer">
        <div className="clinic-container clinic-footer-grid">
          <div>
            <div className="clinic-logo clinic-logo-footer">
              <span className="clinic-logo-mark">+</span>

              <span>
                CLINIC <b>AI</b>
              </span>
            </div>

            <p>
              Nền tảng đặt lịch khám và hỗ trợ chăm sóc sức khỏe
              trực tuyến.
            </p>
          </div>

          <div>
            <strong>Liên hệ</strong>
            <span>Hotline: 1900 1234</span>
            <span>Email: support@clinicai.vn</span>
          </div>

          <div>
            <strong>Giờ làm việc</strong>
            <span>Thứ Hai - Chủ Nhật</span>
            <span>07:00 - 21:00</span>
          </div>
        </div>

        <div className="clinic-container clinic-copyright">
          © 2026 Clinic AI. Đồ án hỗ trợ đặt lịch khám.
        </div>
      </footer>
    </div>
  );
}