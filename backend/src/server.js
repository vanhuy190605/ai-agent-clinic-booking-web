require('dotenv').config();

const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const {
  initDb,
  get,
  all,
  run,
  createUser,
  createNotification,
  withTransaction
} = require('./db');

const {
  getAvailableSlots,
  createAppointment
} = require('./appointmentService');

const {
  enumerateDates,
  validateLeaveRequestInput
} = require('./leavePolicy');

const {
  extractBookingReason,
  processAiMessage
} = require('./aiAgent');

const { sendResetCode } = require('./mailer');

const {
  cleanText,
  normalizeEmail,
  isEmail,
  isPastDate,
  isStrongEnoughPassword,
  isValidDate,
  isValidTime,
  positiveId,
  localDateString
} = require('./validation');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (
    process.env.NODE_ENV === 'production'
      ? ''
      : 'development-only-change-me'
  );

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  'http://localhost:5173';

const configuredLeaveNoticeDays = Number(
  process.env.PLANNED_LEAVE_NOTICE_DAYS || 3
);

const PLANNED_LEAVE_NOTICE_DAYS =
  Number.isInteger(configuredLeaveNoticeDays) &&
  configuredLeaveNoticeDays >= 0
    ? configuredLeaveNoticeDays
    : 3;

if (JWT_SECRET.length < 24) {
  throw new Error(
    'JWT_SECRET phải có ít nhất 24 ký tự'
  );
}

app.disable('x-powered-by');

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true
  })
);

app.use(
  express.json({
    limit: '2mb'
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    message:
      'Bạn thao tác quá nhiều lần. Vui lòng thử lại sau.'
  }
});

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

function signUser(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      full_name: user.full_name
    },
    JWT_SECRET,
    {
      expiresIn: '7d'
    }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    is_active: user.is_active
  };
}

async function auth(req, res, next) {
  try {
    const header =
      req.headers.authorization || '';

    const token = header.startsWith('Bearer ')
      ? header.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        message: 'Chưa đăng nhập'
      });
    }

    const payload = jwt.verify(
      token,
      JWT_SECRET
    );

    const user = await get(
      `SELECT *
       FROM users
       WHERE id = ?
         AND is_active = 1`,
      [payload.id]
    );

    if (!user) {
      return res.status(401).json({
        message:
          'Tài khoản không tồn tại hoặc đã bị khóa'
      });
    }

    req.user = publicUser(user);
    next();
  } catch {
    return res.status(401).json({
      message:
        'Token không hợp lệ hoặc đã hết hạn'
    });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message:
          'Bạn không có quyền thực hiện chức năng này'
      });
    }

    next();
  };
}

function asyncHandler(fn) {
  return (req, res, next) =>
    Promise.resolve(
      fn(req, res, next)
    ).catch(next);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function generateCode() {
  return String(
    crypto.randomInt(100000, 1000000)
  );
}

async function getDoctorByUserId(userId) {
  return get(
    `SELECT
      doctors.*,
      users.full_name,
      users.email
     FROM doctors
     JOIN users
       ON doctors.user_id = users.id
     WHERE doctors.user_id = ?`,
    [userId]
  );
}

async function createTxNotification(
  tx,
  userId,
  title,
  message
) {
  await tx.run(
    `INSERT INTO notifications(
      user_id,
      title,
      message
    ) VALUES (?, ?, ?)`,
    [userId, title, message]
  );
}

async function loadImpactedAppointments(
  leaveRequest,
  database = { all }
) {
  return database.all(
    `SELECT
      appointments.*,
      TIME_FORMAT(
        appointments.appointment_time,
        '%H:%i'
      ) AS time_text,
      DATE_FORMAT(
        appointments.appointment_date,
        '%Y-%m-%d'
      ) AS date_text,
      patients.full_name AS patient_name
     FROM appointments
     JOIN users AS patients
       ON appointments.patient_id = patients.id
     WHERE appointments.doctor_id = ?
       AND appointments.appointment_date
         BETWEEN ? AND ?
       AND appointments.status
         IN ('pending', 'confirmed')
     ORDER BY
       appointments.appointment_date,
       appointments.appointment_time`,
    [
      leaveRequest.doctor_id,
      leaveRequest.start_date,
      leaveRequest.end_date
    ]
  );
}

async function doctorCanCoverAppointments(
  doctorId,
  appointments,
  database = { get }
) {
  for (const appointment of appointments) {
    const date =
      appointment.date_text ||
      String(
        appointment.appointment_date
      ).slice(0, 10);

    const time =
      appointment.time_text ||
      String(
        appointment.appointment_time
      ).slice(0, 5);

    const schedule = await database.get(
      `SELECT id
       FROM doctor_schedules
       WHERE doctor_id = ?
         AND work_date = ?
         AND status = 'active'
         AND start_time <= ?
         AND end_time > ?
       LIMIT 1`,
      [
        doctorId,
        date,
        `${time}:00`,
        `${time}:00`
      ]
    );

    if (!schedule) {
      return false;
    }

    const unavailable = await database.get(
      `SELECT
        (
          SELECT id
          FROM doctor_attendance
          WHERE doctor_id = ?
            AND work_date = ?
            AND status = 'off'
          LIMIT 1
        ) AS attendance_off,
        (
          SELECT id
          FROM doctor_leave_requests
          WHERE doctor_id = ?
            AND (
              status = 'approved'
              OR (
                leave_type = 'emergency'
                AND status IN (
                  'pending',
                  'rejected'
                )
              )
            )
            AND ? BETWEEN start_date AND end_date
          LIMIT 1
        ) AS operational_leave,
        (
          SELECT id
          FROM appointments
          WHERE doctor_id = ?
            AND appointment_date = ?
            AND appointment_time = ?
            AND status != 'cancelled'
          LIMIT 1
        ) AS booked`,
      [
        doctorId,
        date,
        doctorId,
        date,
        doctorId,
        date,
        `${time}:00`
      ]
    );

    if (
      unavailable?.attendance_off ||
      unavailable?.operational_leave ||
      unavailable?.booked
    ) {
      return false;
    }
  }

  return true;
}

async function getReplacementCandidates(
  leaveRequest,
  appointments,
  database = { all, get }
) {
  const doctors = await database.all(
    `SELECT
      doctors.id,
      doctors.user_id,
      users.full_name,
      specialties.name AS specialty_name
     FROM doctors
     JOIN users
       ON doctors.user_id = users.id
     JOIN specialties
       ON doctors.specialty_id = specialties.id
     WHERE doctors.specialty_id = ?
       AND doctors.id != ?
       AND users.is_active = 1
     ORDER BY users.full_name`,
    [
      leaveRequest.specialty_id,
      leaveRequest.doctor_id
    ]
  );

  const candidates = [];

  for (const doctor of doctors) {
    const canCover =
      await doctorCanCoverAppointments(
        doctor.id,
        appointments,
        database
      );

    if (canCover) {
      candidates.push(doctor);
    }
  }

  return candidates;
}

app.get('/', (req, res) => {
  res.json({
    message:
      'Clinic AI Agent Booking Backend is running',
    docs:
      'Open /api/specialties or use README.md for API list'
  });
});

// AUTH
app.post(
  '/api/auth/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(
      req.body.email
    );

    const { password } = req.body;

    if (!isEmail(email) || !password) {
      return res.status(400).json({
        message:
          'Vui lòng nhập email và mật khẩu'
      });
    }

    const user = await get(
      `SELECT *
       FROM users
       WHERE email = ?
         AND is_active = 1`,
      [email]
    );

    if (!user) {
      return res.status(400).json({
        message:
          'Email không tồn tại hoặc tài khoản đã bị khóa'
      });
    }

    const ok = await bcrypt.compare(
      password,
      user.password
    );

    if (!ok) {
      return res.status(400).json({
        message: 'Mật khẩu không đúng'
      });
    }

    res.json({
      token: signUser(user),
      user: publicUser(user)
    });
  })
);

app.post(
  '/api/auth/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const fullName = cleanText(
      req.body.full_name,
      120
    );

    const email = normalizeEmail(
      req.body.email
    );

    const password = req.body.password;

    const phone = cleanText(
      req.body.phone,
      30
    );

    if (
      !fullName ||
      !isEmail(email) ||
      !isStrongEnoughPassword(password)
    ) {
      return res.status(400).json({
        message:
          'Họ tên, email hoặc mật khẩu không hợp lệ (mật khẩu cần từ 8 ký tự)'
      });
    }

    const exists = await get(
      `SELECT id
       FROM users
       WHERE email = ?`,
      [email]
    );

    if (exists) {
      return res.status(409).json({
        message: 'Email đã tồn tại'
      });
    }

    const id = await createUser({
      full_name: fullName,
      email,
      password,
      phone,
      role: 'patient'
    });

    const user = await get(
      `SELECT *
       FROM users
       WHERE id = ?`,
      [id]
    );

    res.status(201).json({
      token: signUser(user),
      user: publicUser(user)
    });
  })
);

app.get(
  '/api/auth/me',
  auth,
  (req, res) => {
    res.json(req.user);
  }
);

app.post(
  '/api/auth/forgot-password',
  authLimiter,
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(
      req.body.email
    );

    if (!isEmail(email)) {
      return res.status(400).json({
        message: 'Email không hợp lệ'
      });
    }

    const user = await get(
      `SELECT *
       FROM users
       WHERE email = ?
         AND is_active = 1`,
      [email]
    );

    if (!user) {
      return res.json({
        message:
          'Nếu email tồn tại, mã khôi phục sẽ được gửi trong ít phút.'
      });
    }

    const code = generateCode();

    await run(
      `INSERT INTO password_resets(
        user_id,
        code,
        expires_at
      )
       VALUES (
        ?,
        ?,
        DATE_ADD(NOW(), INTERVAL 10 MINUTE)
       )`,
      [user.id, code]
    );

    const mailResult =
      await sendResetCode(email, code);

    res.json({
      message: mailResult.dryRun
        ? 'Chế độ demo: mã khôi phục đã được tạo. Khi cấu hình Gmail SMTP, mã sẽ được gửi qua email.'
        : 'Mã khôi phục đã được gửi về Gmail của bạn.',
      demo_code: mailResult.dryRun
        ? code
        : undefined
    });
  })
);

app.post(
  '/api/auth/reset-password',
  authLimiter,
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(
      req.body.email
    );

    const code = cleanText(
      req.body.code,
      6
    );

    const { new_password: newPassword } =
      req.body;

    if (
      !isEmail(email) ||
      !/^\d{6}$/.test(code) ||
      !isStrongEnoughPassword(newPassword)
    ) {
      return res.status(400).json({
        message:
          'Email, mã xác nhận hoặc mật khẩu mới không hợp lệ'
      });
    }

    const user = await get(
      `SELECT *
       FROM users
       WHERE email = ?
         AND is_active = 1`,
      [email]
    );

    if (!user) {
      return res.status(404).json({
        message: 'Không tìm thấy tài khoản'
      });
    }

    const reset = await get(
      `SELECT *
       FROM password_resets
       WHERE user_id = ?
         AND code = ?
         AND used_at IS NULL
         AND expires_at > NOW()
       ORDER BY id DESC
       LIMIT 1`,
      [user.id, code]
    );

    if (!reset) {
      return res.status(400).json({
        message:
          'Mã không hợp lệ hoặc đã hết hạn'
      });
    }

    const hashed = await bcrypt.hash(
      newPassword,
      10
    );

    await run(
      `UPDATE users
       SET password = ?
       WHERE id = ?`,
      [hashed, user.id]
    );

    await run(
      `UPDATE password_resets
       SET used_at = NOW()
       WHERE id = ?`,
      [reset.id]
    );

    res.json({
      message:
        'Đổi mật khẩu thành công. Bạn có thể đăng nhập lại.'
    });
  })
);

// NOTIFICATIONS
app.get(
  '/api/notifications',
  auth,
  asyncHandler(async (req, res) => {
    const data = await all(
      `SELECT *
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    res.json(data);
  })
);

app.patch(
  '/api/notifications/:id/read',
  auth,
  asyncHandler(async (req, res) => {
    await run(
      `UPDATE notifications
       SET is_read = 1
       WHERE id = ?
         AND user_id = ?`,
      [
        req.params.id,
        req.user.id
      ]
    );

    res.json({
      message: 'Đã đọc thông báo'
    });
  })
);

// SPECIALTIES
app.get(
  '/api/specialties',
  asyncHandler(async (req, res) => {
    const data = await all(
      `SELECT *
       FROM specialties
       ORDER BY id`
    );

    res.json(data);
  })
);

app.post(
  '/api/specialties',
  auth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const name = cleanText(
      req.body.name,
      120
    );

    const description = cleanText(
      req.body.description,
      2000
    );

    if (!name) {
      return res.status(400).json({
        message:
          'Tên chuyên khoa không được để trống'
      });
    }

    await run(
      `INSERT INTO specialties(
        name,
        description
      ) VALUES (?, ?)`,
      [
        name,
        description || ''
      ]
    );

    res.status(201).json({
      message:
        'Thêm chuyên khoa thành công'
    });
  })
);

app.put(
  '/api/specialties/:id',
  auth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const specialtyId = positiveId(
      req.params.id
    );

    const name = cleanText(
      req.body.name,
      120
    );

    const description = cleanText(
      req.body.description,
      2000
    );

    if (!specialtyId || !name) {
      return res.status(400).json({
        message:
          'Dữ liệu chuyên khoa không hợp lệ'
      });
    }

    await run(
      `UPDATE specialties
       SET name = ?,
           description = ?
       WHERE id = ?`,
      [
        name,
        description || '',
        specialtyId
      ]
    );

    res.json({
      message:
        'Cập nhật chuyên khoa thành công'
    });
  })
);

app.delete(
  '/api/specialties/:id',
  auth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const specialtyId = positiveId(
      req.params.id
    );

    if (!specialtyId) {
      return res.status(400).json({
        message:
          'Mã chuyên khoa không hợp lệ'
      });
    }

    await run(
      `DELETE FROM specialties
       WHERE id = ?`,
      [specialtyId]
    );

    res.json({
      message:
        'Xóa chuyên khoa thành công'
    });
  })
);

// DOCTORS
app.get(
  '/api/doctors',
  asyncHandler(async (req, res) => {
    const {
      specialty_id: specialtyId,
      date
    } = req.query;

    if (
      specialtyId &&
      !positiveId(specialtyId)
    ) {
      return res.status(400).json({
        message:
          'Chuyên khoa không hợp lệ'
      });
    }

    if (
      date &&
      (
        !isValidDate(date) ||
        isPastDate(date)
      )
    ) {
      return res.status(400).json({
        message:
          'Ngày khám không hợp lệ'
      });
    }

    const params = [];

    let sql = `
      SELECT
        doctors.id,
        doctors.user_id,
        users.full_name,
        users.email,
        users.phone,
        users.is_active,
        doctors.degree,
        doctors.experience,
        doctors.room,
        doctors.bio,
        specialties.id AS specialty_id,
        specialties.name AS specialty_name
      FROM doctors
      JOIN users
        ON doctors.user_id = users.id
      JOIN specialties
        ON doctors.specialty_id = specialties.id
      WHERE users.is_active = 1
    `;

    if (specialtyId) {
      sql +=
        ` AND doctors.specialty_id = ?`;

      params.push(
        positiveId(specialtyId)
      );
    }

    sql += ` ORDER BY doctors.id`;

    const data = await all(
      sql,
      params
    );

    if (date) {
      const availability =
        await Promise.all(
          data.map(doctor =>
            getAvailableSlots(
              doctor.id,
              date
            )
          )
        );

      return res.json(
        data.map((doctor, index) => ({
          ...doctor,

          available_for_booking:
            !availability[index].doctorOff &&
            availability[index]
              .availableSlots.length > 0,

          available_slots:
            availability[index]
              .availableSlots,

          unavailable_reason:
            availability[index].doctorOff
              ? availability[index].reason
              : availability[index]
                  .availableSlots.length
                ? ''
                : 'Không còn khung giờ trống trong ngày này'
        }))
      );
    }

    res.json(data);
  })
);

app.get(
  '/api/availability',
  asyncHandler(async (req, res) => {
    const {
      doctor_id: doctorId,
      date
    } = req.query;

    if (
      !positiveId(doctorId) ||
      !isValidDate(date) ||
      isPastDate(date)
    ) {
      return res.status(400).json({
        message:
          'Bác sĩ hoặc ngày khám không hợp lệ'
      });
    }

    const data = await getAvailableSlots(
      doctorId,
      date
    );

    res.json(data);
  })
);

// APPOINTMENTS
app.post(
  '/api/appointments',
  auth,
  requireRole(
    'patient',
    'support',
    'admin'
  ),
  asyncHandler(async (req, res) => {
    const {
      patient_id: patientId,
      doctor_id: doctorId,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      reason
    } = req.body;

    const targetPatientId =
      req.user.role === 'patient'
        ? req.user.id
        : patientId;

    const appointment =
      await createAppointment({
        patient_id: targetPatientId,
        doctor_id: doctorId,
        appointment_date:
          appointmentDate,
        appointment_time:
          appointmentTime,
        reason,
        created_by_ai: 0
      });

    res.status(201).json({
      message: 'Đặt lịch thành công',
      appointment
    });
  })
);

app.get(
  '/api/appointments/my',
  auth,
  asyncHandler(async (req, res) => {
    let params = [];
    let where = '';

    if (req.user.role === 'patient') {
      where =
        `WHERE appointments.patient_id = ?`;

      params = [req.user.id];
    } else if (
      req.user.role === 'doctor'
    ) {
      const doctor =
        await getDoctorByUserId(
          req.user.id
        );

      if (!doctor) {
        return res.json([]);
      }

      where =
        `WHERE appointments.doctor_id = ?`;

      params = [doctor.id];
    }

    const data = await all(
      `SELECT
        appointments.id,
        appointments.patient_id,
        appointments.doctor_id,
        DATE_FORMAT(
          appointments.appointment_date,
          '%Y-%m-%d'
        ) AS appointment_date,
        TIME_FORMAT(
          appointments.appointment_time,
          '%H:%i'
        ) AS appointment_time,
        appointments.reason,
        appointments.status,
        appointments.created_by_ai,
        appointments.created_at,
        appointment_cancellations.reason
          AS cancellation_reason,
        appointment_cancellations.cancelled_by_role,
        appointment_cancellations.cancelled_at,
        patient.full_name
          AS patient_name,
        doctor_user.full_name
          AS doctor_name,
        specialties.name
          AS specialty_name
       FROM appointments
       JOIN users AS patient
         ON appointments.patient_id =
            patient.id
       JOIN doctors
         ON appointments.doctor_id =
            doctors.id
       JOIN users AS doctor_user
         ON doctors.user_id =
            doctor_user.id
       JOIN specialties
         ON doctors.specialty_id =
            specialties.id
       LEFT JOIN appointment_cancellations
         ON appointments.id =
            appointment_cancellations.appointment_id
       ${where}
       ORDER BY
         appointments.appointment_date DESC,
         appointments.appointment_time DESC`,
      params
    );

    res.json(data);
  })
);

app.get(
  '/api/appointments',
  auth,
  requireRole('admin', 'support'),
  asyncHandler(async (req, res) => {
    const data = await all(
      `SELECT
        appointments.id,
        appointments.patient_id,
        appointments.doctor_id,
        DATE_FORMAT(
          appointments.appointment_date,
          '%Y-%m-%d'
        ) AS appointment_date,
        TIME_FORMAT(
          appointments.appointment_time,
          '%H:%i'
        ) AS appointment_time,
        appointments.reason,
        appointments.status,
        appointments.created_by_ai,
        appointments.created_at,
        appointment_cancellations.reason
          AS cancellation_reason,
        appointment_cancellations.cancelled_by_role,
        appointment_cancellations.cancelled_at,
        patient.full_name
          AS patient_name,
        doctor_user.full_name
          AS doctor_name,
        specialties.name
          AS specialty_name
       FROM appointments
       JOIN users AS patient
         ON appointments.patient_id =
            patient.id
       JOIN doctors
         ON appointments.doctor_id =
            doctors.id
       JOIN users AS doctor_user
         ON doctors.user_id =
            doctor_user.id
       JOIN specialties
         ON doctors.specialty_id =
            specialties.id
       LEFT JOIN appointment_cancellations
         ON appointments.id =
            appointment_cancellations.appointment_id
       ORDER BY
         appointments.appointment_date DESC,
         appointments.appointment_time DESC`
    );

    res.json(data);
  })
);

app.get(
  '/api/appointments/cancelled',
  auth,
  asyncHandler(async (req, res) => {
    let where =
      `WHERE appointments.status = 'cancelled'`;

    const params = [];

    if (req.user.role === 'patient') {
      where +=
        ` AND appointments.patient_id = ?`;

      params.push(req.user.id);
    } else if (
      req.user.role === 'doctor'
    ) {
      const doctor =
        await getDoctorByUserId(
          req.user.id
        );

      if (!doctor) {
        return res.json([]);
      }

      where +=
        ` AND appointments.doctor_id = ?`;

      params.push(doctor.id);
    } else if (
      !['admin', 'support'].includes(
        req.user.role
      )
    ) {
      return res.status(403).json({
        message:
          'Bạn không có quyền xem kho lịch đã hủy'
      });
    }

    const data = await all(
      `SELECT
        appointments.id,
        DATE_FORMAT(
          appointments.appointment_date,
          '%Y-%m-%d'
        ) AS appointment_date,
        TIME_FORMAT(
          appointments.appointment_time,
          '%H:%i'
        ) AS appointment_time,
        appointments.reason
          AS booking_reason,
        appointments.status,
        patients.full_name
          AS patient_name,
        doctor_users.full_name
          AS doctor_name,
        specialties.name
          AS specialty_name,
        appointment_cancellations.reason
          AS cancellation_reason,
        appointment_cancellations.cancelled_by_role,
        appointment_cancellations.previous_status,
        appointment_cancellations.cancelled_at,
        cancelled_users.full_name
          AS cancelled_by_name
       FROM appointments
       JOIN users AS patients
         ON appointments.patient_id =
            patients.id
       JOIN doctors
         ON appointments.doctor_id =
            doctors.id
       JOIN users AS doctor_users
         ON doctors.user_id =
            doctor_users.id
       JOIN specialties
         ON doctors.specialty_id =
            specialties.id
       LEFT JOIN appointment_cancellations
         ON appointments.id =
            appointment_cancellations.appointment_id
       LEFT JOIN users AS cancelled_users
         ON appointment_cancellations.cancelled_by =
            cancelled_users.id
       ${where}
       ORDER BY
         appointment_cancellations.cancelled_at DESC,
         appointments.id DESC`,
      params
    );

    res.json(data);
  })
);

app.patch(
  '/api/appointments/:id/status',
  auth,
  requireRole(
    'doctor',
    'admin',
    'support'
  ),
  asyncHandler(async (req, res) => {
    const appointmentId = positiveId(
      req.params.id
    );

    const { status } = req.body;

    if (
      !appointmentId ||
      ![
        'confirmed',
        'completed'
      ].includes(status)
    ) {
      return res.status(400).json({
        message:
          'Trạng thái không hợp lệ'
      });
    }

    const appointment = await get(
      `SELECT *
       FROM appointments
       WHERE id = ?`,
      [appointmentId]
    );

    if (!appointment) {
      return res.status(404).json({
        message:
          'Không tìm thấy lịch hẹn'
      });
    }

    if (req.user.role === 'doctor') {
      const doctor =
        await getDoctorByUserId(
          req.user.id
        );

      if (
        !doctor ||
        Number(
          appointment.doctor_id
        ) !== Number(doctor.id)
      ) {
        return res.status(403).json({
          message:
            'Bạn chỉ được cập nhật lịch hẹn của mình'
        });
      }
    }

    if (
      [
        'cancelled',
        'completed'
      ].includes(appointment.status)
    ) {
      return res.status(409).json({
        message:
          'Lịch hẹn đã kết thúc nên không thể cập nhật'
      });
    }

    if (appointment.status === status) {
      return res.json({
        message:
          'Lịch hẹn đã ở trạng thái này'
      });
    }

    await withTransaction(async tx => {
      await tx.run(
        `UPDATE appointments
         SET status = ?
         WHERE id = ?`,
        [
          status,
          appointmentId
        ]
      );

      await tx.run(
        `INSERT INTO appointment_history(
          appointment_id,
          action_type,
          old_status,
          new_status,
          actor_user_id,
          actor_role,
          reason
        ) VALUES (
          ?,
          'status_change',
          ?,
          ?,
          ?,
          ?,
          ?
        )`,
        [
          appointmentId,
          appointment.status,
          status,
          req.user.id,
          req.user.role,
          status === 'completed'
            ? 'Đã hoàn tất khám'
            : 'Đã xác nhận lịch'
        ]
      );

      await createTxNotification(
        tx,
        appointment.patient_id,
        'Cập nhật lịch khám',
        `Lịch khám #${appointment.id} đã chuyển sang trạng thái ${
          status === 'completed'
            ? 'đã khám'
            : 'đã xác nhận'
        }.`
      );
    });

    res.json({
      message:
        'Cập nhật trạng thái thành công'
    });
  })
);

app.post(
  '/api/appointments/:id/cancel',
  auth,
  asyncHandler(async (req, res) => {
    const appointmentId = positiveId(
      req.params.id
    );

    const reason = cleanText(
      req.body.reason,
      1000
    );

    if (
      !appointmentId ||
      reason.length < 5
    ) {
      return res.status(400).json({
        message:
          'Vui lòng nhập lý do hủy ít nhất 5 ký tự'
      });
    }

    if (
      ![
        'patient',
        'doctor',
        'admin',
        'support'
      ].includes(req.user.role)
    ) {
      return res.status(403).json({
        message:
          'Bạn không có quyền hủy lịch hẹn'
      });
    }

    await withTransaction(async tx => {
      const appointment = await tx.get(
        `SELECT *
         FROM appointments
         WHERE id = ?
         FOR UPDATE`,
        [appointmentId]
      );

      if (!appointment) {
        throw httpError(
          404,
          'Không tìm thấy lịch hẹn'
        );
      }

      if (
        appointment.status === 'cancelled'
      ) {
        throw httpError(
          409,
          'Lịch hẹn đã được hủy trước đó'
        );
      }

      if (
        appointment.status === 'completed'
      ) {
        throw httpError(
          409,
          'Không thể hủy lịch đã khám'
        );
      }

      if (
        req.user.role === 'patient' &&
        Number(
          appointment.patient_id
        ) !== Number(req.user.id)
      ) {
        throw httpError(
          403,
          'Bạn chỉ được hủy lịch hẹn của mình'
        );
      }

      if (req.user.role === 'doctor') {
        const doctor = await tx.get(
          `SELECT id
           FROM doctors
           WHERE user_id = ?`,
          [req.user.id]
        );

        if (
          !doctor ||
          Number(
            appointment.doctor_id
          ) !== Number(doctor.id)
        ) {
          throw httpError(
            403,
            'Bạn chỉ được hủy lịch hẹn do mình phụ trách'
          );
        }
      }

      await tx.run(
        `INSERT INTO appointment_cancellations(
          appointment_id,
          cancelled_by,
          cancelled_by_role,
          reason,
          previous_status
        ) VALUES (?, ?, ?, ?, ?)`,
        [
          appointmentId,
          req.user.id,
          req.user.role,
          reason,
          appointment.status
        ]
      );

      await tx.run(
        `UPDATE appointments
         SET status = 'cancelled'
         WHERE id = ?`,
        [appointmentId]
      );

      await tx.run(
        `INSERT INTO appointment_history(
          appointment_id,
          action_type,
          old_status,
          new_status,
          previous_doctor_id,
          new_doctor_id,
          actor_user_id,
          actor_role,
          reason
        ) VALUES (
          ?,
          'cancel',
          ?,
          'cancelled',
          ?,
          ?,
          ?,
          ?,
          ?
        )`,
        [
          appointmentId,
          appointment.status,
          appointment.doctor_id,
          appointment.doctor_id,
          req.user.id,
          req.user.role,
          reason
        ]
      );

      await createTxNotification(
        tx,
        appointment.patient_id,
        'Lịch khám đã hủy',
        `Lịch khám #${appointmentId} đã được hủy. Lý do: ${reason}`
      );

      const doctor = await tx.get(
        `SELECT user_id
         FROM doctors
         WHERE id = ?`,
        [appointment.doctor_id]
      );

      if (
        doctor &&
        Number(doctor.user_id) !==
          Number(req.user.id)
      ) {
        await createTxNotification(
          tx,
          doctor.user_id,
          'Lịch khám đã hủy',
          `Lịch khám #${appointmentId} đã được hủy. Lý do: ${reason}`
        );
      }

      if (req.user.role === 'doctor') {
        const admins = await tx.all(
          `SELECT id
           FROM users
           WHERE role IN (
             'admin',
             'support'
           )
             AND is_active = 1`
        );

        for (const admin of admins) {
          await createTxNotification(
            tx,
            admin.id,
            'Bác sĩ hủy lịch khám',
            `${req.user.full_name} đã hủy lịch #${appointmentId}. Lý do: ${reason}`
          );
        }
      }
    });

    res.json({
      message:
        'Đã hủy và lưu lịch vào kho lịch đã hủy'
    });
  })
);

// MEDICAL RECORDS
app.post(
  '/api/medical-records',
  auth,
  requireRole('doctor', 'admin'),
  asyncHandler(async (req, res) => {
    const {
      appointment_id: appointmentId,
      symptoms,
      diagnosis,
      prescription,
      doctor_note: doctorNote
    } = req.body;

    const appointment = await get(
      `SELECT *
       FROM appointments
       WHERE id = ?`,
      [appointmentId]
    );

    if (!appointment) {
      return res.status(404).json({
        message:
          'Không tìm thấy lịch hẹn'
      });
    }

    if (
      appointment.status === 'cancelled'
    ) {
      return res.status(409).json({
        message:
          'Không thể ghi hồ sơ cho lịch đã hủy'
      });
    }

    if (req.user.role === 'doctor') {
      const doctor =
        await getDoctorByUserId(
          req.user.id
        );

      if (
        !doctor ||
        Number(
          appointment.doctor_id
        ) !== Number(doctor.id)
      ) {
        return res.status(403).json({
          message:
            'Bạn chỉ được ghi hồ sơ lịch khám của mình'
        });
      }
    }

    await run(
      `INSERT INTO medical_records(
        appointment_id,
        patient_id,
        doctor_id,
        symptoms,
        diagnosis,
        prescription,
        doctor_note
      ) VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      )
      ON DUPLICATE KEY UPDATE
        symptoms = VALUES(symptoms),
        diagnosis = VALUES(diagnosis),
        prescription = VALUES(prescription),
        doctor_note = VALUES(doctor_note)`,
      [
        appointment.id,
        appointment.patient_id,
        appointment.doctor_id,
        symptoms || '',
        diagnosis || '',
        prescription || '',
        doctorNote || ''
      ]
    );

    await run(
      `UPDATE appointments
       SET status = 'completed'
       WHERE id = ?`,
      [appointment.id]
    );

    await createNotification(
      appointment.patient_id,
      'Đã có hồ sơ khám',
      `Bác sĩ đã cập nhật hồ sơ khám cho lịch hẹn #${appointment.id}.`
    );

    res.json({
      message:
        'Lưu hồ sơ khám thành công'
    });
  })
);

app.get(
  '/api/medical-records/my',
  auth,
  requireRole(
    'patient',
    'doctor',
    'admin'
  ),
  asyncHandler(async (req, res) => {
    let where = '';
    let params = [];
    let fields =
      'medical_records.*';

    if (req.user.role === 'patient') {
      where =
        `WHERE medical_records.patient_id = ?`;

      params = [req.user.id];

      fields = `
        medical_records.id,
        medical_records.appointment_id,
        medical_records.patient_id,
        medical_records.doctor_id,
        medical_records.symptoms,
        medical_records.diagnosis,
        medical_records.prescription,
        medical_records.created_at,
        medical_records.updated_at
      `;
    } else if (
      req.user.role === 'doctor'
    ) {
      const doctor =
        await getDoctorByUserId(
          req.user.id
        );

      if (!doctor) {
        return res.json([]);
      }

      where =
        `WHERE medical_records.doctor_id = ?`;

      params = [doctor.id];
    }

    const records = await all(
      `SELECT
        ${fields},
        patient.full_name
          AS patient_name,
        doctor_user.full_name
          AS doctor_name
       FROM medical_records
       JOIN users AS patient
         ON medical_records.patient_id =
            patient.id
       JOIN doctors
         ON medical_records.doctor_id =
            doctors.id
       JOIN users AS doctor_user
         ON doctors.user_id =
            doctor_user.id
       ${where}
       ORDER BY
         medical_records.created_at DESC`,
      params
    );

    res.json(records);
  })
);

// AI AGENT CHAT
async function loadActiveAiHistory(
  userId
) {
  return all(
    `SELECT
      id,
      message,
      reply,
      action,
      appointment_id,
      created_at
     FROM (
       SELECT
        id,
        message,
        reply,
        action,
        appointment_id,
        created_at
       FROM ai_chats
       WHERE user_id = ?
         AND created_at >=
           DATE_SUB(
             NOW(),
             INTERVAL 2 HOUR
           )
         AND id > COALESCE(
           (
             SELECT MAX(id)
             FROM ai_chats
             WHERE user_id = ?
               AND action =
                 'booking_created'
           ),
           0
         )
       ORDER BY id DESC
       LIMIT 20
     ) AS recent_ai_chats
     ORDER BY id ASC`,
    [userId, userId]
  );
}

async function repairLegacyAiAppointmentReasons() {
  const legacyAppointments = await all(
    `SELECT
      appointments.id,
      appointments.patient_id,
      appointments.reason,
      ai_chats.id AS booking_chat_id,
      ai_chats.message AS booking_message
     FROM appointments
     JOIN ai_chats
       ON ai_chats.appointment_id =
          appointments.id
     WHERE appointments.created_by_ai = 1
       AND (
         appointments.reason
           LIKE 'Đặt lịch%'
         OR appointments.reason
           LIKE 'Dat lich%'
         OR appointments.reason
           LIKE 'Đặt khám%'
       )`
  );

  let repaired = 0;

  for (
    const appointment
    of legacyAppointments
  ) {
    const history = await all(
      `SELECT
        id,
        message,
        reply,
        action
       FROM ai_chats
       WHERE user_id = ?
         AND id < ?
         AND id > COALESCE(
           (
             SELECT MAX(id)
             FROM ai_chats
             WHERE user_id = ?
               AND id < ?
               AND action =
                 'booking_created'
           ),
           0
         )
       ORDER BY id ASC
       LIMIT 20`,
      [
        appointment.patient_id,
        appointment.booking_chat_id,
        appointment.patient_id,
        appointment.booking_chat_id
      ]
    );

    const correctedReason =
      extractBookingReason(
        appointment.booking_message,
        '',
        history,
        ''
      );

    if (
      correctedReason &&
      correctedReason !==
        appointment.reason
    ) {
      await run(
        `UPDATE appointments
         SET reason = ?
         WHERE id = ?`,
        [
          correctedReason,
          appointment.id
        ]
      );

      repaired += 1;
    }
  }

  return repaired;
}

app.post(
  '/api/ai/chat',
  auth,
  asyncHandler(async (req, res) => {
    const message = cleanText(
      req.body.message,
      2000
    );

    const displayMessage =
      cleanText(
        req.body.display_message,
        2000
      ) || message;

    const bookingReason = cleanText(
      req.body.booking_reason,
      250
    );

    if (!message) {
      return res.status(400).json({
        message:
          'Vui lòng nhập nội dung chat'
      });
    }

    const chatHistory =
      await loadActiveAiHistory(
        req.user.id
      );

    const result =
      await processAiMessage(
        req.user,
        message,
        {
          bookingReason,
          displayMessage,
          chatHistory
        }
      );

    await run(
      `INSERT INTO ai_chats(
        user_id,
        message,
        reply,
        action,
        appointment_id
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        req.user.id,
        displayMessage,
        result.reply,
        result.action,
        result.appointment_id
      ]
    );

    res.json(result);
  })
);

app.get(
  '/api/ai/history',
  auth,
  asyncHandler(async (req, res) => {
    const data = await all(
      `SELECT *
       FROM ai_chats
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    res.json(data);
  })
);

// COMPLAINTS / CUSTOMER CARE
app.post(
  '/api/complaints',
  auth,
  requireRole('patient'),
  asyncHandler(async (req, res) => {
    const {
      target_type: targetType,
      doctor_id: doctorId,
      subject,
      message
    } = req.body;

    const cleanSubject = cleanText(
      subject,
      200
    );

    const cleanMessage = cleanText(
      message,
      3000
    );

    if (
      ![
        'doctor',
        'website'
      ].includes(targetType) ||
      !cleanSubject ||
      !cleanMessage
    ) {
      return res.status(400).json({
        message:
          'Thiếu nội dung khiếu nại'
      });
    }

    if (
      targetType === 'doctor' &&
      !positiveId(doctorId)
    ) {
      return res.status(400).json({
        message:
          'Vui lòng chọn bác sĩ cần phản ánh'
      });
    }

    if (targetType === 'doctor') {
      const doctor = await get(
        `SELECT doctors.id
         FROM doctors
         JOIN users
           ON doctors.user_id = users.id
         WHERE doctors.id = ?
           AND users.is_active = 1`,
        [doctorId]
      );

      if (!doctor) {
        return res.status(404).json({
          message:
            'Không tìm thấy bác sĩ'
        });
      }
    }

    await run(
      `INSERT INTO complaints(
        patient_id,
        target_type,
        doctor_id,
        subject,
        message
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        req.user.id,
        targetType,
        doctorId || null,
        cleanSubject,
        cleanMessage
      ]
    );

    const admins = await all(
      `SELECT id
       FROM users
       WHERE role IN (
         'admin',
         'support'
       )
         AND is_active = 1`
    );

    for (const admin of admins) {
      await createNotification(
        admin.id,
        'Khiếu nại mới',
        `${req.user.full_name} gửi khiếu nại: ${cleanSubject}`
      );
    }

    res.status(201).json({
      message:
        'Đã gửi khiếu nại đến kênh chăm sóc khách hàng'
    });
  })
);

app.get(
  '/api/complaints/my',
  auth,
  requireRole('patient'),
  asyncHandler(async (req, res) => {
    const data = await all(
      `SELECT *
       FROM complaints
       WHERE patient_id = ?
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json(data);
  })
);

app.get(
  '/api/complaints',
  auth,
  requireRole('admin', 'support'),
  asyncHandler(async (req, res) => {
    const data = await all(
      `SELECT
        complaints.*,
        users.full_name
          AS patient_name,
        doctor_user.full_name
          AS doctor_name
       FROM complaints
       JOIN users
         ON complaints.patient_id =
            users.id
       LEFT JOIN doctors
         ON complaints.doctor_id =
            doctors.id
       LEFT JOIN users AS doctor_user
         ON doctors.user_id =
            doctor_user.id
       ORDER BY
         complaints.created_at DESC`
    );

    res.json(data);
  })
);

app.patch(
  '/api/complaints/:id',
  auth,
  requireRole('admin', 'support'),
  asyncHandler(async (req, res) => {
    const {
      status,
      admin_reply: adminReply
    } = req.body;

    if (
      ![
        'new',
        'processing',
        'resolved',
        'rejected'
      ].includes(status)
    ) {
      return res.status(400).json({
        message:
          'Trạng thái khiếu nại không hợp lệ'
      });
    }

    await run(
      `UPDATE complaints
       SET status = ?,
           admin_reply = ?
       WHERE id = ?`,
      [
        status,
        cleanText(adminReply, 3000),
        req.params.id
      ]
    );

    const complaint = await get(
      `SELECT *
       FROM complaints
       WHERE id = ?`,
      [req.params.id]
    );

    if (complaint) {
      await createNotification(
        complaint.patient_id,
        'Phản hồi khiếu nại',
        `Khiếu nại #${complaint.id} đã được cập nhật: ${status}.`
      );
    }

    res.json({
      message:
        'Cập nhật khiếu nại thành công'
    });
  })
);

// DOCTOR ATTENDANCE
app.post(
  '/api/doctor/attendance',
  auth,
  requireRole('doctor'),
  asyncHandler(async (req, res) => {
    const workDate =
      req.body.work_date ||
      localDateString();

    if (
      workDate !== localDateString()
    ) {
      return res.status(400).json({
        message:
          'Bác sĩ chỉ được điểm danh cho ngày hôm nay'
      });
    }

    const doctor =
      await getDoctorByUserId(
        req.user.id
      );

    if (!doctor) {
      return res.status(404).json({
        message:
          'Không tìm thấy hồ sơ bác sĩ'
      });
    }

    const schedule = await get(
      `SELECT id
       FROM doctor_schedules
       WHERE doctor_id = ?
         AND work_date = ?
         AND status = 'active'
       LIMIT 1`,
      [doctor.id, workDate]
    );

    if (!schedule) {
      return res.status(409).json({
        message:
          'Hôm nay bác sĩ không có ca làm được xếp'
      });
    }

    const operationalLeave = await get(
      `SELECT id
       FROM doctor_leave_requests
       WHERE doctor_id = ?
         AND (
           status = 'approved'
           OR (
             leave_type = 'emergency'
             AND status IN (
               'pending',
               'rejected'
             )
           )
         )
         AND ? BETWEEN start_date AND end_date
       LIMIT 1`,
      [doctor.id, workDate]
    );

    if (operationalLeave) {
      return res.status(409).json({
        message:
          'Hôm nay đã được ghi nhận là ngày nghỉ nên không thể điểm danh'
      });
    }

    await run(
      `INSERT INTO doctor_attendance(
        doctor_id,
        work_date,
        status,
        reason,
        check_in_at
      ) VALUES (
        ?,
        ?,
        'working',
        '',
        NOW()
      )
      ON DUPLICATE KEY UPDATE
        status = 'working',
        reason = '',
        check_in_at =
          COALESCE(
            check_in_at,
            NOW()
          )`,
      [doctor.id, workDate]
    );

    res.json({
      message:
        'Đã điểm danh đi làm hôm nay'
    });
  })
);

app.get(
  '/api/doctor/calendar',
  auth,
  requireRole('doctor'),
  asyncHandler(async (req, res) => {
    const from =
      req.query.from ||
      localDateString();

    const defaultToDate =
      new Date(`${from}T00:00:00Z`);

    defaultToDate.setUTCDate(
      defaultToDate.getUTCDate() + 29
    );

    const to =
      req.query.to ||
      defaultToDate
        .toISOString()
        .slice(0, 10);

    if (
      !isValidDate(from) ||
      !isValidDate(to) ||
      to < from
    ) {
      return res.status(400).json({
        message:
          'Khoảng ngày xem lịch không hợp lệ'
      });
    }

    const dates = enumerateDates(
      from,
      to
    );

    if (dates.length > 62) {
      return res.status(400).json({
        message:
          'Chỉ được xem tối đa 62 ngày mỗi lần'
      });
    }

    const doctor =
      await getDoctorByUserId(
        req.user.id
      );

    if (!doctor) {
      return res.status(404).json({
        message:
          'Không tìm thấy hồ sơ bác sĩ'
      });
    }

    const [
      schedules,
      attendance,
      leaveRequests,
      appointmentCounts
    ] = await Promise.all([
      all(
        `SELECT
          id,
          DATE_FORMAT(
            work_date,
            '%Y-%m-%d'
          ) AS work_date,
          TIME_FORMAT(
            start_time,
            '%H:%i'
          ) AS start_time,
          TIME_FORMAT(
            end_time,
            '%H:%i'
          ) AS end_time
         FROM doctor_schedules
         WHERE doctor_id = ?
           AND work_date BETWEEN ? AND ?
           AND status = 'active'
         ORDER BY
           work_date,
           start_time`,
        [
          doctor.id,
          from,
          to
        ]
      ),

      all(
        `SELECT
          DATE_FORMAT(
            work_date,
            '%Y-%m-%d'
          ) AS work_date,
          status,
          reason,
          DATE_FORMAT(
            check_in_at,
            '%Y-%m-%d %H:%i'
          ) AS check_in_at
         FROM doctor_attendance
         WHERE doctor_id = ?
           AND work_date BETWEEN ? AND ?`,
        [
          doctor.id,
          from,
          to
        ]
      ),

      all(
        `SELECT
          id,
          DATE_FORMAT(
            start_date,
            '%Y-%m-%d'
          ) AS start_date,
          DATE_FORMAT(
            end_date,
            '%Y-%m-%d'
          ) AS end_date,
          leave_type,
          reason,
          status
         FROM doctor_leave_requests
         WHERE doctor_id = ?
           AND (
             status IN (
               'pending',
               'approved'
             )
             OR (
               leave_type = 'emergency'
               AND status = 'rejected'
             )
           )
           AND start_date <= ?
           AND end_date >= ?`,
        [
          doctor.id,
          to,
          from
        ]
      ),

      all(
        `SELECT
          DATE_FORMAT(
            appointment_date,
            '%Y-%m-%d'
          ) AS work_date,
          COUNT(*) AS total
         FROM appointments
         WHERE doctor_id = ?
           AND appointment_date
             BETWEEN ? AND ?
           AND status IN (
             'pending',
             'confirmed'
           )
         GROUP BY appointment_date`,
        [
          doctor.id,
          from,
          to
        ]
      )
    ]);

    const calendar = dates.map(date => {
      const shifts = schedules.filter(
        item => item.work_date === date
      );

      const checkIn = attendance.find(
        item => item.work_date === date
      );

      const leave = leaveRequests.find(
        item =>
          date >= item.start_date &&
          date <= item.end_date
      );

      const count =
        appointmentCounts.find(
          item =>
            item.work_date === date
        );

      let dayStatus = shifts.length
        ? 'scheduled'
        : 'not_scheduled';

      if (
        checkIn?.status === 'working'
      ) {
        dayStatus = 'checked_in';
      }

      if (
        leave?.leave_type ===
          'planned' &&
        leave.status === 'pending'
      ) {
        dayStatus = 'pending_leave';
      }

      if (
        leave?.leave_type ===
          'emergency' &&
        leave.status === 'pending'
      ) {
        dayStatus =
          'emergency_leave';
      }

      if (
        leave?.status === 'approved' ||
        checkIn?.status === 'off'
      ) {
        dayStatus =
          'approved_leave';
      }

      if (
        leave?.leave_type ===
          'emergency' &&
        leave.status === 'rejected'
      ) {
        dayStatus =
          'unexcused_leave';
      }

      return {
        work_date: date,
        shifts,
        day_status: dayStatus,
        check_in_at:
          checkIn?.check_in_at ||
          null,
        leave_request:
          leave || null,
        appointment_count: Number(
          count?.total || 0
        )
      };
    });

    res.json(calendar);
  })
);

app.get(
  '/api/doctor/leave-requests',
  auth,
  requireRole('doctor'),
  asyncHandler(async (req, res) => {
    const doctor =
      await getDoctorByUserId(
        req.user.id
      );

    if (!doctor) {
      return res.status(404).json({
        message:
          'Không tìm thấy hồ sơ bác sĩ'
      });
    }

    const items = await all(
      `SELECT
        doctor_leave_requests.id,
        DATE_FORMAT(
          doctor_leave_requests.start_date,
          '%Y-%m-%d'
        ) AS start_date,
        DATE_FORMAT(
          doctor_leave_requests.end_date,
          '%Y-%m-%d'
        ) AS end_date,
        doctor_leave_requests.leave_type,
        doctor_leave_requests.reason,
        doctor_leave_requests.status,
        doctor_leave_requests.resolution_action,
        doctor_leave_requests.review_note,
        doctor_leave_requests.submitted_at,
        doctor_leave_requests.reviewed_at,
        replacement_users.full_name
          AS replacement_doctor_name,
        (
          SELECT COUNT(*)
          FROM appointments
          WHERE appointments.doctor_id =
            doctor_leave_requests.doctor_id
            AND appointments.appointment_date
              BETWEEN
                doctor_leave_requests.start_date
                AND
                doctor_leave_requests.end_date
            AND appointments.status IN (
              'pending',
              'confirmed'
            )
        ) AS impacted_appointments
       FROM doctor_leave_requests
       LEFT JOIN doctors
         AS replacement_doctors
         ON doctor_leave_requests.replacement_doctor_id =
            replacement_doctors.id
       LEFT JOIN users
         AS replacement_users
         ON replacement_doctors.user_id =
            replacement_users.id
       WHERE doctor_leave_requests.doctor_id = ?
       ORDER BY
         doctor_leave_requests.submitted_at DESC`,
      [doctor.id]
    );

    res.json({
      items,
      policy: {
        planned_notice_days:
          PLANNED_LEAVE_NOTICE_DAYS,
        max_leave_days: 30
      }
    });
  })
);

app.post(
  '/api/doctor/leave-requests',
  auth,
  requireRole('doctor'),
  asyncHandler(async (req, res) => {
    const validation =
      validateLeaveRequestInput(
        req.body,
        {
          today: localDateString(),
          plannedNoticeDays:
            PLANNED_LEAVE_NOTICE_DAYS
        }
      );

    if (!validation.ok) {
      return res.status(400).json({
        message: validation.message
      });
    }

    const doctor =
      await getDoctorByUserId(
        req.user.id
      );

    if (!doctor) {
      return res.status(404).json({
        message:
          'Không tìm thấy hồ sơ bác sĩ'
      });
    }

    const value = validation.value;

    const overlap = await get(
      `SELECT id
       FROM doctor_leave_requests
       WHERE doctor_id = ?
         AND (
           status IN (
             'pending',
             'approved'
           )
           OR (
             leave_type = 'emergency'
             AND status = 'rejected'
           )
         )
         AND start_date <= ?
         AND end_date >= ?
       LIMIT 1`,
      [
        doctor.id,
        value.end_date,
        value.start_date
      ]
    );

    if (overlap) {
      return res.status(409).json({
        message:
          'Khoảng ngày này đã có đơn nghỉ đang chờ hoặc đã duyệt'
      });
    }

    const result =
      await withTransaction(
        async tx => {
          await tx.get(
            `SELECT id
             FROM doctors
             WHERE id = ?
             FOR UPDATE`,
            [doctor.id]
          );

          const freshOverlap =
            await tx.get(
              `SELECT id
               FROM doctor_leave_requests
               WHERE doctor_id = ?
                 AND (
                   status IN (
                     'pending',
                     'approved'
                   )
                   OR (
                     leave_type =
                       'emergency'
                     AND status =
                       'rejected'
                   )
                 )
                 AND start_date <= ?
                 AND end_date >= ?
               LIMIT 1`,
              [
                doctor.id,
                value.end_date,
                value.start_date
              ]
            );

          if (freshOverlap) {
            throw httpError(
              409,
              'Khoảng ngày này vừa có đơn nghỉ khác được gửi'
            );
          }

          const inserted =
            await tx.run(
              `INSERT INTO doctor_leave_requests(
                doctor_id,
                start_date,
                end_date,
                leave_type,
                reason
              ) VALUES (?, ?, ?, ?, ?)`,
              [
                doctor.id,
                value.start_date,
                value.end_date,
                value.leave_type,
                value.reason
              ]
            );

          const impacted =
            value.leave_type ===
              'emergency'
              ? await loadImpactedAppointments(
                  {
                    doctor_id:
                      doctor.id,
                    start_date:
                      value.start_date,
                    end_date:
                      value.end_date
                  },
                  tx
                )
              : [];

          const admins = await tx.all(
            `SELECT id
             FROM users
             WHERE role IN (
               'admin',
               'support'
             )
               AND is_active = 1`
          );

          for (const admin of admins) {
            await createTxNotification(
              tx,
              admin.id,
              value.leave_type ===
                'emergency'
                ? 'Cần xử lý nghỉ khẩn cấp'
                : 'Đơn xin nghỉ mới',
              value.leave_type ===
                'emergency'
                ? `${doctor.full_name} vừa báo nghỉ khẩn cấp từ ${value.start_date} đến ${value.end_date}. Hệ thống đã khóa lịch mới; có ${impacted.length} lịch cần điều phối.`
                : `${doctor.full_name} xin nghỉ từ ${value.start_date} đến ${value.end_date}. Lịch chỉ khóa sau khi được duyệt.`
            );
          }

          if (
            value.leave_type ===
            'emergency'
          ) {
            for (
              const appointment
              of impacted
            ) {
              await createTxNotification(
                tx,
                appointment.patient_id,
                'Lịch khám đang được điều phối',
                `Bác sĩ của lịch #${appointment.id} ngày ${appointment.date_text} lúc ${appointment.time_text} vừa báo nghỉ khẩn cấp. Bệnh viện sẽ thông báo sau khi đổi bác sĩ hoặc xử lý lịch.`
              );
            }
          }

          return {
            insertId:
              inserted.insertId,
            impacted:
              impacted.length
          };
        }
      );

    res.status(201).json({
      message:
        value.leave_type === 'emergency'
          ? `Đã báo nghỉ khẩn cấp và khóa lịch mới ngay. Admin sẽ hậu kiểm, xử lý ${result.impacted} lịch bị ảnh hưởng.`
          : 'Đã gửi đơn nghỉ có kế hoạch. Lịch chỉ được khóa sau khi Admin duyệt.',
      id: result.insertId
    });
  })
);

app.patch(
  '/api/doctor/leave-requests/:id/withdraw',
  auth,
  requireRole('doctor'),
  asyncHandler(async (req, res) => {
    const requestId = positiveId(
      req.params.id
    );

    const doctor =
      await getDoctorByUserId(
        req.user.id
      );

    if (!requestId || !doctor) {
      return res.status(400).json({
        message:
          'Đơn nghỉ không hợp lệ'
      });
    }

    const result =
      await withTransaction(
        async tx => {
          const leaveRequest =
            await tx.get(
              `SELECT
                id,
                doctor_id,
                DATE_FORMAT(
                  start_date,
                  '%Y-%m-%d'
                ) AS start_date,
                DATE_FORMAT(
                  end_date,
                  '%Y-%m-%d'
                ) AS end_date,
                leave_type,
                status
               FROM doctor_leave_requests
               WHERE id = ?
                 AND doctor_id = ?
               FOR UPDATE`,
              [
                requestId,
                doctor.id
              ]
            );

          if (
            !leaveRequest ||
            leaveRequest.status !==
              'pending'
          ) {
            throw httpError(
              409,
              'Chỉ có thể rút đơn đang chờ xử lý'
            );
          }

          const impacted =
            leaveRequest.leave_type ===
              'emergency'
              ? await loadImpactedAppointments(
                  leaveRequest,
                  tx
                )
              : [];

          await tx.run(
            `UPDATE doctor_leave_requests
             SET status = 'withdrawn'
             WHERE id = ?`,
            [requestId]
          );

          const managers =
            await tx.all(
              `SELECT id
               FROM users
               WHERE role IN (
                 'admin',
                 'support'
               )
                 AND is_active = 1`
            );

          for (
            const manager
            of managers
          ) {
            await createTxNotification(
              tx,
              manager.id,
              'Bác sĩ đã rút báo nghỉ',
              `${doctor.full_name} đã rút đơn #${requestId}.`
            );
          }

          for (
            const appointment
            of impacted
          ) {
            await createTxNotification(
              tx,
              appointment.patient_id,
              'Lịch khám tiếp tục như cũ',
              `Báo nghỉ khẩn cấp liên quan đến lịch #${appointment.id} đã được rút. Lịch khám hiện vẫn giữ nguyên.`
            );
          }

          return leaveRequest;
        }
      );

    res.json({
      message:
        result.leave_type ===
          'emergency'
          ? 'Đã rút báo nghỉ khẩn cấp và mở lại các khung giờ chưa đặt'
          : 'Đã rút đơn nghỉ có kế hoạch'
    });
  })
);

app.get(
  '/api/attendance',
  auth,
  requireRole('admin', 'support'),
  asyncHandler(async (req, res) => {
    const { date } = req.query;

    if (!isValidDate(date)) {
      return res.status(400).json({
        message:
          'Ngày theo dõi không hợp lệ'
      });
    }

    const data = await all(
      `SELECT
        doctors.id AS doctor_id,
        users.full_name
          AS doctor_name,
        specialties.name
          AS specialty_name,
        doctor_attendance.status
          AS attendance_status,
        doctor_attendance.reason
          AS attendance_reason,
        DATE_FORMAT(
          doctor_attendance.check_in_at,
          '%Y-%m-%d %H:%i'
        ) AS check_in_at,
        (
          SELECT GROUP_CONCAT(
            CONCAT(
              TIME_FORMAT(
                start_time,
                '%H:%i'
              ),
              '-',
              TIME_FORMAT(
                end_time,
                '%H:%i'
              )
            )
            ORDER BY start_time
            SEPARATOR ', '
          )
          FROM doctor_schedules
          WHERE doctor_schedules.doctor_id =
            doctors.id
            AND doctor_schedules.work_date = ?
            AND doctor_schedules.status =
              'active'
        ) AS shifts,
        active_leave.id
          AS leave_request_id,
        active_leave.leave_type,
        active_leave.status
          AS leave_status,
        active_leave.reason
          AS leave_reason,
        (
          SELECT COUNT(*)
          FROM appointments
          WHERE appointments.doctor_id =
            doctors.id
            AND appointments.appointment_date = ?
            AND appointments.status IN (
              'pending',
              'confirmed'
            )
        ) AS appointment_count
       FROM doctors
       JOIN users
         ON doctors.user_id = users.id
       JOIN specialties
         ON doctors.specialty_id =
            specialties.id
       LEFT JOIN doctor_attendance
         ON doctors.id =
            doctor_attendance.doctor_id
         AND doctor_attendance.work_date = ?
       LEFT JOIN doctor_leave_requests
         AS active_leave
         ON active_leave.id = (
           SELECT leave_for_day.id
           FROM doctor_leave_requests
             AS leave_for_day
           WHERE leave_for_day.doctor_id =
             doctors.id
             AND ? BETWEEN
               leave_for_day.start_date
               AND leave_for_day.end_date
             AND (
               leave_for_day.status IN (
                 'pending',
                 'approved'
               )
               OR (
                 leave_for_day.leave_type =
                   'emergency'
                 AND leave_for_day.status =
                   'rejected'
               )
             )
           ORDER BY FIELD(
             leave_for_day.status,
             'approved',
             'pending',
             'rejected'
           )
           LIMIT 1
         )
       WHERE users.is_active = 1
       ORDER BY doctors.id`,
      [
        date,
        date,
        date,
        date
      ]
    );

    res.json(
      data.map(item => {
        let dayStatus = item.shifts
          ? 'scheduled'
          : 'not_scheduled';

        if (
          item.attendance_status ===
            'working'
        ) {
          dayStatus = 'checked_in';
        }

        if (
          item.leave_type ===
            'planned' &&
          item.leave_status ===
            'pending'
        ) {
          dayStatus = 'pending_leave';
        }

        if (
          item.leave_type ===
            'emergency' &&
          item.leave_status ===
            'pending'
        ) {
          dayStatus =
            'emergency_leave';
        }

        if (
          item.leave_status ===
            'approved' ||
          item.attendance_status ===
            'off'
        ) {
          dayStatus =
            'approved_leave';
        }

        if (
          item.leave_type ===
            'emergency' &&
          item.leave_status ===
            'rejected'
        ) {
          dayStatus =
            'unexcused_leave';
        }

        return {
          ...item,
          appointment_count: Number(
            item.appointment_count || 0
          ),
          day_status: dayStatus
        };
      })
    );
  })
);

// ONLINE CHAT BETWEEN DOCTOR AND PATIENT
app.post(
  '/api/conversations',
  auth,
  requireRole('patient'),
  asyncHandler(async (req, res) => {
    const {
      doctor_id: doctorId
    } = req.body;

    const doctor = await get(
      `SELECT doctors.*
       FROM doctors
       JOIN users
         ON doctors.user_id = users.id
       WHERE doctors.id = ?
         AND users.is_active = 1`,
      [doctorId]
    );

    if (!doctor) {
      return res.status(404).json({
        message:
          'Không tìm thấy bác sĩ'
      });
    }

    await run(
      `INSERT IGNORE INTO conversations(
        patient_id,
        doctor_id
      ) VALUES (?, ?)`,
      [
        req.user.id,
        doctorId
      ]
    );

    const conversation = await get(
      `SELECT *
       FROM conversations
       WHERE patient_id = ?
         AND doctor_id = ?`,
      [
        req.user.id,
        doctorId
      ]
    );

    res.status(201).json(
      conversation
    );
  })
);

app.get(
  '/api/conversations',
  auth,
  requireRole('patient', 'doctor'),
  asyncHandler(async (req, res) => {
    let where = '';
    let params = [];

    if (req.user.role === 'patient') {
      where =
        `WHERE conversations.patient_id = ?`;

      params = [req.user.id];
    } else {
      const doctor =
        await getDoctorByUserId(
          req.user.id
        );

      if (!doctor) {
        return res.json([]);
      }

      where =
        `WHERE conversations.doctor_id = ?`;

      params = [doctor.id];
    }

    const data = await all(
      `SELECT
        conversations.*,
        patient.full_name
          AS patient_name,
        doctor_user.full_name
          AS doctor_name
       FROM conversations
       JOIN users AS patient
         ON conversations.patient_id =
            patient.id
       JOIN doctors
         ON conversations.doctor_id =
            doctors.id
       JOIN users AS doctor_user
         ON doctors.user_id =
            doctor_user.id
       ${where}
       ORDER BY
         conversations.created_at DESC`,
      params
    );

    res.json(data);
  })
);

app.get(
  '/api/conversations/:id/messages',
  auth,
  requireRole('patient', 'doctor'),
  asyncHandler(async (req, res) => {
    const conversation = await get(
      `SELECT *
       FROM conversations
       WHERE id = ?`,
      [req.params.id]
    );

    if (!conversation) {
      return res.status(404).json({
        message:
          'Không tìm thấy hội thoại'
      });
    }

    if (
      req.user.role === 'patient' &&
      Number(
        conversation.patient_id
      ) !== Number(req.user.id)
    ) {
      return res.status(403).json({
        message:
          'Bạn không có quyền xem hội thoại này'
      });
    }

    if (req.user.role === 'doctor') {
      const doctor =
        await getDoctorByUserId(
          req.user.id
        );

      if (
        !doctor ||
        Number(
          conversation.doctor_id
        ) !== Number(doctor.id)
      ) {
        return res.status(403).json({
          message:
            'Bạn không có quyền xem hội thoại này'
        });
      }
    }

    const messages = await all(
      `SELECT
        chat_messages.*,
        sender.full_name
          AS sender_name
       FROM chat_messages
       JOIN users AS sender
         ON chat_messages.sender_id =
            sender.id
       WHERE conversation_id = ?
       ORDER BY created_at ASC`,
      [conversation.id]
    );

    res.json(messages);
  })
);

app.post(
  '/api/conversations/:id/messages',
  auth,
  requireRole('patient', 'doctor'),
  asyncHandler(async (req, res) => {
    const message = cleanText(
      req.body.message,
      2000
    );

    if (!message || !message.trim()) {
      return res.status(400).json({
        message:
          'Tin nhắn không được rỗng'
      });
    }

    const conversation = await get(
      `SELECT *
       FROM conversations
       WHERE id = ?`,
      [req.params.id]
    );

    if (!conversation) {
      return res.status(404).json({
        message:
          'Không tìm thấy hội thoại'
      });
    }

    let receiverId;

    if (req.user.role === 'patient') {
      if (
        Number(
          conversation.patient_id
        ) !== Number(req.user.id)
      ) {
        return res.status(403).json({
          message:
            'Không có quyền gửi tin nhắn'
        });
      }

      const doctor = await get(
        `SELECT user_id
         FROM doctors
         WHERE id = ?`,
        [conversation.doctor_id]
      );

      if (!doctor) {
        return res.status(404).json({
          message:
            'Không tìm thấy tài khoản bác sĩ'
        });
      }

      receiverId = Number(
        doctor.user_id
      );
    } else {
      const doctor =
        await getDoctorByUserId(
          req.user.id
        );

      if (
        !doctor ||
        Number(
          conversation.doctor_id
        ) !== Number(doctor.id)
      ) {
        return res.status(403).json({
          message:
            'Không có quyền gửi tin nhắn'
        });
      }

      receiverId = Number(
        conversation.patient_id
      );
    }

    const result = await run(
      `INSERT INTO chat_messages(
        conversation_id,
        sender_id,
        receiver_id,
        message
      ) VALUES (?, ?, ?, ?)`,
      [
        conversation.id,
        Number(req.user.id),
        receiverId,
        message
      ]
    );

    const saved = await get(
      `SELECT
        chat_messages.*,
        sender.full_name
          AS sender_name
       FROM chat_messages
       JOIN users AS sender
         ON chat_messages.sender_id =
            sender.id
       WHERE chat_messages.id = ?`,
      [result.insertId]
    );

    io
      .to(`user:${receiverId}`)
      .emit('message:new', saved);

    io
      .to(
        `user:${Number(
          req.user.id
        )}`
      )
      .emit('message:new', saved);

    res.status(201).json(saved);
  })
);

// ADMIN USER MANAGEMENT
app.get(
  '/api/admin/users',
  auth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { role } = req.query;
    const params = [];

    let sql = `
      SELECT
        users.id,
        users.full_name,
        users.email,
        users.role,
        users.phone,
        users.is_active,
        users.created_at,
        doctors.specialty_id,
        doctors.degree,
        doctors.experience,
        doctors.room,
        doctors.bio,
        specialties.name AS specialty_name
      FROM users
      LEFT JOIN doctors
        ON users.id = doctors.user_id
      LEFT JOIN specialties
        ON doctors.specialty_id =
           specialties.id
      WHERE 1 = 1
    `;

    if (role) {
      sql += ` AND users.role = ?`;
      params.push(role);
    }

    sql +=
      ` ORDER BY users.created_at DESC`;

    const data = await all(
      sql,
      params
    );

    res.json(data);
  })
);

app.post(
  '/api/admin/users',
  auth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const {
      full_name: fullName,
      email,
      password,
      role,
      phone,
      specialty_id: specialtyId,
      degree,
      experience,
      room,
      bio
    } = req.body;

    const normalizedName = cleanText(
      fullName,
      120
    );

    const normalizedEmail =
      normalizeEmail(email);

    const normalizedPhone = cleanText(
      phone,
      30
    );

    if (
      !normalizedName ||
      !isEmail(normalizedEmail) ||
      !isStrongEnoughPassword(
        password
      ) ||
      !role
    ) {
      return res.status(400).json({
        message:
          'Thông tin tài khoản không hợp lệ (mật khẩu cần từ 8 ký tự)'
      });
    }

    if (
      ![
        'patient',
        'doctor',
        'admin',
        'support'
      ].includes(role)
    ) {
      return res.status(400).json({
        message: 'Role không hợp lệ'
      });
    }

    if (role === 'doctor') {
      const specialty =
        positiveId(specialtyId)
          ? await get(
              `SELECT id
               FROM specialties
               WHERE id = ?`,
              [specialtyId]
            )
          : null;

      if (!specialty) {
        return res.status(400).json({
          message:
            'Tài khoản bác sĩ cần chuyên khoa hợp lệ'
        });
      }
    }

    const exists = await get(
      `SELECT id
       FROM users
       WHERE email = ?`,
      [normalizedEmail]
    );

    if (exists) {
      return res.status(409).json({
        message: 'Email đã tồn tại'
      });
    }

    const userId = await createUser({
      full_name: normalizedName,
      email: normalizedEmail,
      password,
      role,
      phone: normalizedPhone
    });

    if (role === 'doctor') {
      try {
        await run(
          `INSERT INTO doctors(
            user_id,
            specialty_id,
            degree,
            experience,
            room,
            bio
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            userId,
            specialtyId,
            cleanText(degree, 120),
            cleanText(
              experience,
              120
            ),
            cleanText(room, 50),
            cleanText(bio, 3000)
          ]
        );
      } catch (error) {
        await run(
          `DELETE FROM users
           WHERE id = ?`,
          [userId]
        );

        throw error;
      }
    }

    res.status(201).json({
      message:
        'Tạo tài khoản thành công',
      user_id: userId
    });
  })
);

app.put(
  '/api/admin/users/:id',
  auth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const {
      full_name: fullName,
      email,
      phone,
      is_active: isActive,
      password,
      specialty_id: specialtyId,
      degree,
      experience,
      room,
      bio
    } = req.body;

    const user = await get(
      `SELECT *
       FROM users
       WHERE id = ?`,
      [req.params.id]
    );

    if (!user) {
      return res.status(404).json({
        message:
          'Không tìm thấy tài khoản'
      });
    }

    const nextName =
      fullName === undefined
        ? user.full_name
        : cleanText(fullName, 120);

    const nextEmail =
      email === undefined
        ? user.email
        : normalizeEmail(email);

    const nextPhone =
      phone === undefined
        ? user.phone
        : cleanText(phone, 30);

    if (
      !nextName ||
      !isEmail(nextEmail) ||
      (
        password &&
        !isStrongEnoughPassword(
          password
        )
      )
    ) {
      return res.status(400).json({
        message:
          'Thông tin cập nhật không hợp lệ'
      });
    }

    if (
      Number(user.id) ===
        Number(req.user.id) &&
      Number(isActive) === 0
    ) {
      return res.status(400).json({
        message:
          'Bạn không thể tự khóa tài khoản đang đăng nhập'
      });
    }

    await run(
      `UPDATE users
       SET full_name = ?,
           email = ?,
           phone = ?,
           is_active = ?
       WHERE id = ?`,
      [
        nextName,
        nextEmail,
        nextPhone,
        isActive ?? user.is_active,
        user.id
      ]
    );

    if (password) {
      const hashed =
        await bcrypt.hash(
          password,
          10
        );

      await run(
        `UPDATE users
         SET password = ?
         WHERE id = ?`,
        [
          hashed,
          user.id
        ]
      );
    }

    if (user.role === 'doctor') {
      const doctor = await get(
        `SELECT *
         FROM doctors
         WHERE user_id = ?`,
        [user.id]
      );

      if (doctor) {
        if (
          specialtyId !== undefined
        ) {
          const specialty =
            positiveId(specialtyId)
              ? await get(
                  `SELECT id
                   FROM specialties
                   WHERE id = ?`,
                  [specialtyId]
                )
              : null;

          if (!specialty) {
            return res.status(400).json({
              message:
                'Chuyên khoa không hợp lệ'
            });
          }
        }

        await run(
          `UPDATE doctors
           SET specialty_id = ?,
               degree = ?,
               experience = ?,
               room = ?,
               bio = ?
           WHERE user_id = ?`,
          [
            positiveId(specialtyId) ||
              doctor.specialty_id,

            degree === undefined
              ? doctor.degree
              : cleanText(
                  degree,
                  120
                ),

            experience === undefined
              ? doctor.experience
              : cleanText(
                  experience,
                  120
                ),

            room === undefined
              ? doctor.room
              : cleanText(
                  room,
                  50
                ),

            bio === undefined
              ? doctor.bio
              : cleanText(
                  bio,
                  3000
                ),

            user.id
          ]
        );
      }
    }

    res.json({
      message:
        'Cập nhật tài khoản thành công'
    });
  })
);

app.delete(
  '/api/admin/users/:id',
  auth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    if (
      Number(req.params.id) ===
      Number(req.user.id)
    ) {
      return res.status(400).json({
        message:
          'Bạn không thể tự khóa tài khoản đang đăng nhập'
      });
    }

    await run(
      `UPDATE users
       SET is_active = 0
       WHERE id = ?`,
      [req.params.id]
    );

    res.json({
      message: 'Đã khóa tài khoản'
    });
  })
);

// LEAVE REQUEST APPROVAL
app.get(
  '/api/admin/leave-requests',
  auth,
  requireRole('admin', 'support'),
  asyncHandler(async (req, res) => {
    const status =
      req.query.status || 'all';

    if (
      ![
        'all',
        'pending',
        'approved',
        'rejected',
        'withdrawn'
      ].includes(status)
    ) {
      return res.status(400).json({
        message:
          'Trạng thái đơn nghỉ không hợp lệ'
      });
    }

    const where =
      status === 'all'
        ? ''
        : `WHERE doctor_leave_requests.status = ?`;

    const params =
      status === 'all'
        ? []
        : [status];

    const data = await all(
      `SELECT
        doctor_leave_requests.id,
        doctor_leave_requests.doctor_id,
        DATE_FORMAT(
          doctor_leave_requests.start_date,
          '%Y-%m-%d'
        ) AS start_date,
        DATE_FORMAT(
          doctor_leave_requests.end_date,
          '%Y-%m-%d'
        ) AS end_date,
        doctor_leave_requests.leave_type,
        doctor_leave_requests.reason,
        doctor_leave_requests.status,
        doctor_leave_requests.resolution_action,
        doctor_leave_requests.review_note,
        doctor_leave_requests.submitted_at,
        doctor_leave_requests.reviewed_at,
        doctor_users.full_name
          AS doctor_name,
        specialties.name
          AS specialty_name,
        replacement_users.full_name
          AS replacement_doctor_name,
        reviewer.full_name
          AS reviewer_name,
        (
          SELECT COUNT(*)
          FROM appointments
          WHERE appointments.doctor_id =
            doctor_leave_requests.doctor_id
            AND appointments.appointment_date
              BETWEEN
                doctor_leave_requests.start_date
                AND
                doctor_leave_requests.end_date
            AND appointments.status IN (
              'pending',
              'confirmed'
            )
        ) AS impacted_appointments
       FROM doctor_leave_requests
       JOIN doctors
         ON doctor_leave_requests.doctor_id =
            doctors.id
       JOIN users AS doctor_users
         ON doctors.user_id =
            doctor_users.id
       JOIN specialties
         ON doctors.specialty_id =
            specialties.id
       LEFT JOIN doctors
         AS replacement_doctors
         ON doctor_leave_requests.replacement_doctor_id =
            replacement_doctors.id
       LEFT JOIN users
         AS replacement_users
         ON replacement_doctors.user_id =
            replacement_users.id
       LEFT JOIN users AS reviewer
         ON doctor_leave_requests.reviewed_by =
            reviewer.id
       ${where}
       ORDER BY
         FIELD(
           doctor_leave_requests.status,
           'pending',
           'approved',
           'rejected',
           'withdrawn'
         ),
         doctor_leave_requests.submitted_at DESC`,
      params
    );

    res.json(
      data.map(item => ({
        ...item,
        impacted_appointments: Number(
          item.impacted_appointments || 0
        )
      }))
    );
  })
);

app.get(
  '/api/admin/leave-requests/:id/coverage',
  auth,
  requireRole('admin', 'support'),
  asyncHandler(async (req, res) => {
    const requestId = positiveId(
      req.params.id
    );

    if (!requestId) {
      return res.status(400).json({
        message:
          'Đơn nghỉ không hợp lệ'
      });
    }

    const leaveRequest = await get(
      `SELECT
        doctor_leave_requests.id,
        doctor_leave_requests.doctor_id,
        DATE_FORMAT(
          doctor_leave_requests.start_date,
          '%Y-%m-%d'
        ) AS start_date,
        DATE_FORMAT(
          doctor_leave_requests.end_date,
          '%Y-%m-%d'
        ) AS end_date,
        doctor_leave_requests.status,
        doctors.specialty_id
       FROM doctor_leave_requests
       JOIN doctors
         ON doctor_leave_requests.doctor_id =
            doctors.id
       WHERE doctor_leave_requests.id = ?`,
      [requestId]
    );

    if (!leaveRequest) {
      return res.status(404).json({
        message:
          'Không tìm thấy đơn nghỉ'
      });
    }

    const appointments =
      await loadImpactedAppointments(
        leaveRequest
      );

    const candidates =
      await getReplacementCandidates(
        leaveRequest,
        appointments
      );

    res.json({
      appointments:
        appointments.map(item => ({
          id: item.id,
          patient_name:
            item.patient_name,
          appointment_date:
            item.date_text,
          appointment_time:
            item.time_text,
          status: item.status
        })),
      candidates
    });
  })
);

app.patch(
  '/api/admin/leave-requests/:id/review',
  auth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const requestId = positiveId(
      req.params.id
    );

    const decision = String(
      req.body.decision || ''
    );

    const requestedAction = String(
      req.body.resolution_action || ''
    );

    const replacementDoctorId =
      positiveId(
        req.body.replacement_doctor_id
      );

    const reviewNote = cleanText(
      req.body.review_note,
      2000
    );

    if (
      !requestId ||
      ![
        'approved',
        'rejected'
      ].includes(decision)
    ) {
      return res.status(400).json({
        message:
          'Kết quả duyệt không hợp lệ'
      });
    }

    if (
      decision === 'rejected' &&
      reviewNote.length < 5
    ) {
      return res.status(400).json({
        message:
          'Vui lòng ghi lý do từ chối ít nhất 5 ký tự'
      });
    }

    const result =
      await withTransaction(
        async tx => {
          const requestPointer =
            await tx.get(
              `SELECT doctor_id
               FROM doctor_leave_requests
               WHERE id = ?`,
              [requestId]
            );

          if (!requestPointer) {
            throw httpError(
              404,
              'Không tìm thấy đơn nghỉ'
            );
          }

          await tx.get(
            `SELECT id
             FROM doctors
             WHERE id = ?
             FOR UPDATE`,
            [requestPointer.doctor_id]
          );

          const leaveRequest =
            await tx.get(
              `SELECT
                doctor_leave_requests.id,
                doctor_leave_requests.doctor_id,
                DATE_FORMAT(
                  doctor_leave_requests.start_date,
                  '%Y-%m-%d'
                ) AS start_date,
                DATE_FORMAT(
                  doctor_leave_requests.end_date,
                  '%Y-%m-%d'
                ) AS end_date,
                doctor_leave_requests.leave_type,
                doctor_leave_requests.reason,
                doctor_leave_requests.status,
                doctors.specialty_id,
                doctors.user_id
                  AS doctor_user_id,
                doctor_users.full_name
                  AS doctor_name
               FROM doctor_leave_requests
               JOIN doctors
                 ON doctor_leave_requests.doctor_id =
                    doctors.id
               JOIN users AS doctor_users
                 ON doctors.user_id =
                    doctor_users.id
               WHERE doctor_leave_requests.id = ?
               FOR UPDATE`,
              [requestId]
            );

          if (!leaveRequest) {
            throw httpError(
              404,
              'Không tìm thấy đơn nghỉ'
            );
          }

          if (
            leaveRequest.status !==
            'pending'
          ) {
            throw httpError(
              409,
              'Đơn nghỉ này đã được xử lý'
            );
          }

          const appointments =
            await loadImpactedAppointments(
              leaveRequest,
              tx
            );

          const mustHandleAppointments =
            appointments.length > 0 &&
            (
              decision === 'approved' ||
              leaveRequest.leave_type ===
                'emergency'
            );

          let resolutionAction =
            mustHandleAppointments
              ? requestedAction
              : 'none';

          if (
            mustHandleAppointments &&
            ![
              'replace',
              'cancel'
            ].includes(resolutionAction)
          ) {
            throw httpError(
              400,
              'Bác sĩ đang có lịch khám. Admin phải chọn bác sĩ thay thế hoặc hủy các lịch bị ảnh hưởng.'
            );
          }

          let replacementDoctor = null;

          if (
            resolutionAction ===
            'replace'
          ) {
            if (
              !replacementDoctorId ||
              replacementDoctorId ===
                Number(
                  leaveRequest.doctor_id
                )
            ) {
              throw httpError(
                400,
                'Vui lòng chọn bác sĩ thay thế hợp lệ'
              );
            }

            replacementDoctor =
              await tx.get(
                `SELECT
                  doctors.id,
                  doctors.user_id,
                  doctors.specialty_id,
                  users.full_name
                 FROM doctors
                 JOIN users
                   ON doctors.user_id =
                      users.id
                 WHERE doctors.id = ?
                   AND users.is_active = 1`,
                [replacementDoctorId]
              );

            if (
              !replacementDoctor ||
              Number(
                replacementDoctor
                  .specialty_id
              ) !==
                Number(
                  leaveRequest
                    .specialty_id
                )
            ) {
              throw httpError(
                409,
                'Bác sĩ thay thế phải đang hoạt động và cùng chuyên khoa'
              );
            }

            const canCover =
              await doctorCanCoverAppointments(
                replacementDoctor.id,
                appointments,
                tx
              );

            if (!canCover) {
              throw httpError(
                409,
                'Bác sĩ thay thế không còn đủ ca trống cho toàn bộ lịch bị ảnh hưởng'
              );
            }
          }

          await tx.run(
            `UPDATE doctor_leave_requests
             SET status = ?,
                 resolution_action = ?,
                 replacement_doctor_id = ?,
                 reviewed_by = ?,
                 review_note = ?,
                 reviewed_at = NOW()
             WHERE id = ?`,
            [
              decision,
              resolutionAction,
              replacementDoctor?.id ||
                null,
              req.user.id,
              reviewNote,
              requestId
            ]
          );

          if (
            decision === 'approved' ||
            leaveRequest.leave_type ===
              'emergency'
          ) {
            const leaveDates =
              enumerateDates(
                leaveRequest.start_date,
                leaveRequest.end_date
              );

            for (
              const workDate
              of leaveDates
            ) {
              await tx.run(
                `INSERT INTO doctor_attendance(
                  doctor_id,
                  work_date,
                  status,
                  reason,
                  check_in_at
                ) VALUES (
                  ?,
                  ?,
                  'off',
                  ?,
                  NULL
                )
                ON DUPLICATE KEY UPDATE
                  status = 'off',
                  reason =
                    VALUES(reason),
                  check_in_at = NULL`,
                [
                  leaveRequest.doctor_id,
                  workDate,
                  decision === 'approved'
                    ? `Nghỉ đã duyệt theo đơn #${requestId}: ${leaveRequest.reason}`
                    : `Nghỉ khẩn cấp không được xác nhận theo đơn #${requestId}`
                ]
              );
            }
          }

          for (
            const appointment
            of appointments
          ) {
            const date =
              appointment.date_text;

            const time =
              appointment.time_text;

            if (
              resolutionAction ===
              'replace'
            ) {
              await tx.run(
                `UPDATE appointments
                 SET doctor_id = ?
                 WHERE id = ?`,
                [
                  replacementDoctor.id,
                  appointment.id
                ]
              );

              await tx.run(
                `INSERT INTO appointment_history(
                  appointment_id,
                  action_type,
                  old_status,
                  new_status,
                  previous_doctor_id,
                  new_doctor_id,
                  actor_user_id,
                  actor_role,
                  reason
                ) VALUES (
                  ?,
                  'reassign',
                  ?,
                  ?,
                  ?,
                  ?,
                  ?,
                  'admin',
                  ?
                )`,
                [
                  appointment.id,
                  appointment.status,
                  appointment.status,
                  leaveRequest.doctor_id,
                  replacementDoctor.id,
                  req.user.id,
                  `Điều phối do đơn nghỉ #${requestId}`
                ]
              );

              await createTxNotification(
                tx,
                appointment.patient_id,
                'Thay đổi bác sĩ khám',
                `Lịch #${appointment.id} ngày ${date} lúc ${time} được chuyển từ ${leaveRequest.doctor_name} sang ${replacementDoctor.full_name}.`
              );

              await createTxNotification(
                tx,
                replacementDoctor.user_id,
                'Lịch khám thay thế',
                `Bạn được phân công khám thay lịch #${appointment.id} ngày ${date} lúc ${time}.`
              );
            } else if (
              resolutionAction ===
              'cancel'
            ) {
              const cancellationReason =
                leaveRequest.leave_type ===
                  'emergency'
                  ? `Bác sĩ nghỉ khẩn cấp theo đơn #${requestId}`
                  : `Bác sĩ nghỉ đã được duyệt theo đơn #${requestId}`;

              await tx.run(
                `INSERT INTO appointment_cancellations(
                  appointment_id,
                  cancelled_by,
                  cancelled_by_role,
                  reason,
                  previous_status,
                  leave_request_id
                ) VALUES (
                  ?,
                  ?,
                  'admin',
                  ?,
                  ?,
                  ?
                )`,
                [
                  appointment.id,
                  req.user.id,
                  cancellationReason,
                  appointment.status,
                  requestId
                ]
              );

              await tx.run(
                `UPDATE appointments
                 SET status = 'cancelled'
                 WHERE id = ?`,
                [appointment.id]
              );

              await tx.run(
                `INSERT INTO appointment_history(
                  appointment_id,
                  action_type,
                  old_status,
                  new_status,
                  previous_doctor_id,
                  new_doctor_id,
                  actor_user_id,
                  actor_role,
                  reason
                ) VALUES (
                  ?,
                  'cancel',
                  ?,
                  'cancelled',
                  ?,
                  ?,
                  ?,
                  'admin',
                  ?
                )`,
                [
                  appointment.id,
                  appointment.status,
                  leaveRequest.doctor_id,
                  leaveRequest.doctor_id,
                  req.user.id,
                  cancellationReason
                ]
              );

              await createTxNotification(
                tx,
                appointment.patient_id,
                'Lịch khám bị hủy',
                `Lịch #${appointment.id} ngày ${date} lúc ${time} bị hủy vì bác sĩ nghỉ. Vui lòng đặt lịch khác.`
              );
            }
          }

          const actionMessage =
            resolutionAction === 'replace'
              ? `Đã chuyển ${appointments.length} lịch sang ${replacementDoctor.full_name}.`
              : resolutionAction ===
                  'cancel'
                ? `Đã hủy và lưu ${appointments.length} lịch vào kho lịch đã hủy.`
                : appointments.length
                  ? `${appointments.length} lịch khám hiện có được giữ nguyên.`
                  : 'Không có lịch hẹn bị ảnh hưởng.';

          const reviewTitle =
            decision === 'approved'
              ? (
                  leaveRequest.leave_type ===
                    'emergency'
                    ? 'Báo nghỉ khẩn cấp đã được xác nhận'
                    : 'Đơn xin nghỉ đã được duyệt'
                )
              : (
                  leaveRequest.leave_type ===
                    'emergency'
                    ? 'Báo nghỉ khẩn cấp không được xác nhận'
                    : 'Đơn xin nghỉ bị từ chối'
                );

          const reviewResult =
            decision === 'approved'
              ? 'đã được duyệt'
              : leaveRequest.leave_type ===
                  'emergency'
                ? `không được xác nhận và được ghi nhận là nghỉ không phép. Lý do: ${reviewNote}`
                : `bị từ chối. Lý do: ${reviewNote}`;

          await createTxNotification(
            tx,
            leaveRequest.doctor_user_id,
            reviewTitle,
            `Đơn #${requestId} ${reviewResult}. ${actionMessage}`
          );

          return {
            decision,
            impacted:
              appointments.length,
            action:
              resolutionAction,
            replacement_doctor_name:
              replacementDoctor
                ?.full_name || null
          };
        }
      );

    res.json({
      message:
        decision === 'approved'
          ? 'Đã duyệt và xử lý lịch khám liên quan'
          : 'Đã hoàn tất hậu kiểm và xử lý lịch khám liên quan',
      result
    });
  })
);

// SCHEDULE MANAGEMENT
app.get(
  '/api/admin/schedules',
  auth,
  requireRole('admin', 'support'),
  asyncHandler(async (req, res) => {
    const {
      date,
      doctor_id: doctorIdValue
    } = req.query;

    if (!isValidDate(date)) {
      return res.status(400).json({
        message:
          'Ngày làm việc không hợp lệ'
      });
    }

    const params = [date];
    let doctorFilter = '';

    if (doctorIdValue) {
      const doctorId = positiveId(
        doctorIdValue
      );

      if (!doctorId) {
        return res.status(400).json({
          message:
            'Bác sĩ không hợp lệ'
        });
      }

      doctorFilter =
        `AND doctor_schedules.doctor_id = ?`;

      params.push(doctorId);
    }

    const schedules = await all(
      `SELECT
        doctor_schedules.id,
        doctor_schedules.doctor_id,
        DATE_FORMAT(
          doctor_schedules.work_date,
          '%Y-%m-%d'
        ) AS work_date,
        TIME_FORMAT(
          doctor_schedules.start_time,
          '%H:%i'
        ) AS start_time,
        TIME_FORMAT(
          doctor_schedules.end_time,
          '%H:%i'
        ) AS end_time,
        users.full_name
          AS doctor_name,
        specialties.name
          AS specialty_name
       FROM doctor_schedules
       JOIN doctors
         ON doctor_schedules.doctor_id =
            doctors.id
       JOIN users
         ON doctors.user_id = users.id
       JOIN specialties
         ON doctors.specialty_id =
            specialties.id
       WHERE doctor_schedules.work_date = ?
         AND doctor_schedules.status =
           'active'
         ${doctorFilter}
       ORDER BY
         doctor_schedules.start_time,
         users.full_name`,
      params
    );

    res.json(schedules);
  })
);

app.post(
  '/api/admin/schedules',
  auth,
  requireRole('admin', 'support'),
  asyncHandler(async (req, res) => {
    const {
      doctor_id: doctorId,
      work_date: workDate,
      start_time: startTime,
      end_time: endTime
    } = req.body;

    if (
      !positiveId(doctorId) ||
      !isValidDate(workDate) ||
      isPastDate(workDate) ||
      !isValidTime(startTime) ||
      !isValidTime(endTime) ||
      startTime >= endTime
    ) {
      return res.status(400).json({
        message:
          'Lịch làm việc không hợp lệ'
      });
    }

    const doctor = await get(
      `SELECT doctors.id
       FROM doctors
       JOIN users
         ON doctors.user_id = users.id
       WHERE doctors.id = ?
         AND users.is_active = 1`,
      [doctorId]
    );

    if (!doctor) {
      return res.status(404).json({
        message:
          'Không tìm thấy bác sĩ đang hoạt động'
      });
    }

    const operationalLeave = await get(
      `SELECT id
       FROM doctor_leave_requests
       WHERE doctor_id = ?
         AND (
           status = 'approved'
           OR (
             leave_type =
               'emergency'
             AND status IN (
               'pending',
               'rejected'
             )
           )
         )
         AND ? BETWEEN
           start_date AND end_date
       LIMIT 1`,
      [
        doctorId,
        workDate
      ]
    );

    if (operationalLeave) {
      return res.status(409).json({
        message:
          'Không thể thêm ca vào ngày bác sĩ đã được ghi nhận nghỉ'
      });
    }

    const overlap = await get(
      `SELECT id
       FROM doctor_schedules
       WHERE doctor_id = ?
         AND work_date = ?
         AND status = 'active'
         AND start_time < ?
         AND end_time > ?
       LIMIT 1`,
      [
        doctorId,
        workDate,
        endTime,
        startTime
      ]
    );

    if (overlap) {
      return res.status(409).json({
        message:
          'Lịch làm việc bị trùng với ca đã có'
      });
    }

    await run(
      `INSERT INTO doctor_schedules(
        doctor_id,
        work_date,
        start_time,
        end_time
      ) VALUES (?, ?, ?, ?)`,
      [
        doctorId,
        workDate,
        startTime,
        endTime
      ]
    );

    res.status(201).json({
      message:
        'Thêm lịch làm việc thành công'
    });
  })
);

app.get(
  '/api/admin/summary',
  auth,
  requireRole('admin', 'support'),
  asyncHandler(async (req, res) => {
    const [
      patients,
      doctors,
      appointments,
      complaints,
      pendingLeaves,
      cancelledAppointments
    ] = await Promise.all([
      get(
        `SELECT COUNT(*) AS total
         FROM users
         WHERE role = 'patient'
           AND is_active = 1`
      ),

      get(
        `SELECT COUNT(*) AS total
         FROM users
         WHERE role = 'doctor'
           AND is_active = 1`
      ),

      get(
        `SELECT COUNT(*) AS total
         FROM appointments`
      ),

      get(
        `SELECT COUNT(*) AS total
         FROM complaints
         WHERE status IN (
           'new',
           'processing'
         )`
      ),

      get(
        `SELECT COUNT(*) AS total
         FROM doctor_leave_requests
         WHERE status = 'pending'`
      ),

      get(
        `SELECT COUNT(*) AS total
         FROM appointments
         WHERE status = 'cancelled'`
      )
    ]);

    res.json({
      patients: patients.total,
      doctors: doctors.total,
      appointments:
        appointments.total,
      open_complaints:
        complaints.total,
      pending_leave_requests:
        pendingLeaves.total,
      cancelled_appointments:
        cancelledAppointments.total
    });
  })
);

// SOCKET.IO REALTIME CHAT
io.use(async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token;

    if (!token) {
      return next(
        new Error('Missing token')
      );
    }

    const payload = jwt.verify(
      token,
      JWT_SECRET
    );

    const user = await get(
      `SELECT *
       FROM users
       WHERE id = ?
         AND is_active = 1`,
      [payload.id]
    );

    if (!user) {
      return next(
        new Error('Invalid user')
      );
    }

    socket.user = publicUser(user);
    next();
  } catch {
    next(
      new Error('Unauthorized')
    );
  }
});

io.on(
  'connection',
  socket => {
    const userId = Number(
      socket.user.id
    );

    socket.join(
      `user:${userId}`
    );
  }
);

// GLOBAL ERROR HANDLER
app.use((err, req, res, next) => {
  console.error(
    'Server error:',
    err
  );

  const knownStatus = Number(
    err.status
  );

  const status =
    knownStatus >= 400 &&
    knownStatus < 600
      ? knownStatus
      : [
          'ER_DUP_ENTRY',
          'ER_ROW_IS_REFERENCED_2'
        ].includes(err.code)
        ? 409
        : 500;

  res.status(status).json({
    message:
      status === 500
        ? 'Hệ thống đang gặp lỗi. Vui lòng thử lại sau.'
        : err.message,

    ...(
      err.availableSlots
        ? {
            availableSlots:
              err.availableSlots
          }
        : {}
    )
  });
});

initDb()
  .then(async () => {
    const repairedReasons =
      await repairLegacyAiAppointmentReasons();

    if (repairedReasons > 0) {
      console.log(
        `Đã sửa ${repairedReasons} lý do khám cũ được tạo bởi AI`
      );
    }

    server.listen(PORT, () => {
      console.log(
        'Database initialized successfully'
      );

      console.log(
        `Backend running at http://localhost:${PORT}`
      );
    });
  })
  .catch(error => {
    console.error(
      'Không thể khởi động backend:',
      error
    );
  });