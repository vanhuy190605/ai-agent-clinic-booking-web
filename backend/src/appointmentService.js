const {
  all,
  get,
  createNotification,
  withTransaction
} = require('./db');

const {
  cleanText,
  isPastDate,
  isValidDate,
  isValidTime,
  normalizeTime,
  positiveId
} = require('./validation');

/* =========================
   XỬ LÝ KHUNG GIỜ
========================= */

function pad(number) {
  return String(number).padStart(2, '0');
}

function toTime5(value) {
  if (!value) return '';

  if (typeof value === 'string') {
    return value.slice(0, 5);
  }

  return String(value).slice(0, 5);
}

function addMinutes(time, minutes) {
  const [hour, minute] = toTime5(time)
    .split(':')
    .map(Number);

  const totalMinutes = hour * 60 + minute + minutes;

  return `${pad(Math.floor(totalMinutes / 60))}:${pad(
    totalMinutes % 60
  )}`;
}

function minutesOf(time) {
  const [hour, minute] = toTime5(time)
    .split(':')
    .map(Number);

  return hour * 60 + minute;
}

function generateSlots(start, end, step = 30) {
  const slots = [];
  let cursor = toTime5(start);

  while (minutesOf(cursor) < minutesOf(end)) {
    slots.push(cursor);
    cursor = addMinutes(cursor, step);
  }

  return slots;
}

/* =========================
   LẤY THÔNG TIN BÁC SĨ
========================= */

async function getDoctorInfo(
  doctorId,
  database = { get }
) {
  return database.get(
    `SELECT
       doctors.*,
       users.full_name,
       users.email,
       specialties.name AS specialty_name
     FROM doctors
     JOIN users
       ON doctors.user_id = users.id
     JOIN specialties
       ON doctors.specialty_id = specialties.id
     WHERE doctors.id = ?`,
    [doctorId]
  );
}

/* =========================
   KIỂM TRA GIỜ KHÁM TRỐNG
========================= */

async function getAvailableSlots(
  doctorId,
  date,
  database = { all, get }
) {
  const normalizedDoctorId = positiveId(doctorId);

  if (
    !normalizedDoctorId ||
    !isValidDate(date)
  ) {
    return {
      doctorOff: true,
      reason: 'Bác sĩ hoặc ngày khám không hợp lệ',
      availableSlots: [],
      busySlots: [],
      doctor: null
    };
  }

  const doctor = await getDoctorInfo(
    normalizedDoctorId,
    database
  );

  if (!doctor) {
    return {
      doctorOff: true,
      reason: 'Không tìm thấy bác sĩ',
      availableSlots: [],
      busySlots: [],
      doctor: null
    };
  }

  /* Kiểm tra trạng thái chấm công */

  const attendance = await database.get(
    `SELECT status
     FROM doctor_attendance
     WHERE doctor_id = ?
       AND work_date = ?`,
    [normalizedDoctorId, date]
  );

  if (attendance?.status === 'off') {
    return {
      doctorOff: true,

      // Không trả lý do riêng tư của bác sĩ cho bệnh nhân.
      reason: 'Bác sĩ không làm việc trong ngày này',

      availableSlots: [],
      busySlots: [],
      doctor
    };
  }

  /* Kiểm tra đơn xin nghỉ */

  const leave = await database.get(
    `SELECT leave_type, status
     FROM doctor_leave_requests
     WHERE doctor_id = ?
       AND ? BETWEEN start_date AND end_date
       AND (
         status = 'approved'
         OR (
           leave_type = 'emergency'
           AND status IN ('pending', 'rejected')
         )
       )
     ORDER BY FIELD(
       status,
       'approved',
       'pending',
       'rejected'
     )
     LIMIT 1`,
    [normalizedDoctorId, date]
  );

  if (leave) {
    let publicReason =
      'Bác sĩ không làm việc trong ngày này';

    if (
      leave.leave_type === 'emergency' &&
      leave.status === 'pending'
    ) {
      publicReason =
        'Bác sĩ vừa báo nghỉ khẩn cấp, bệnh viện đang điều phối lịch';
    }

    return {
      doctorOff: true,
      reason: publicReason,
      availableSlots: [],
      busySlots: [],
      doctor
    };
  }

  /* Lấy lịch làm việc */

  const schedules = await database.all(
    `SELECT start_time, end_time
     FROM doctor_schedules
     WHERE doctor_id = ?
       AND work_date = ?
       AND status = 'active'
     ORDER BY start_time`,
    [normalizedDoctorId, date]
  );

  /* Lấy các giờ đã được đặt */

  const bookedAppointments = await database.all(
    `SELECT appointment_time
     FROM appointments
     WHERE doctor_id = ?
       AND appointment_date = ?
       AND status != 'cancelled'`,
    [normalizedDoctorId, date]
  );

  const busySlots = bookedAppointments.map(row =>
    toTime5(row.appointment_time)
  );

  /* Tạo danh sách khung giờ */

  const allSlots = schedules.flatMap(schedule =>
    generateSlots(
      schedule.start_time,
      schedule.end_time,
      30
    )
  );

  const uniqueSlots = [...new Set(allSlots)];

  const availableSlots = uniqueSlots.filter(
    slot => !busySlots.includes(slot)
  );

  return {
    doctorOff: false,
    reason: '',
    availableSlots,
    busySlots,
    doctor
  };
}

/* =========================
   TẠO LỊCH KHÁM
========================= */

async function createAppointment({
  patient_id,
  doctor_id,
  appointment_date,
  appointment_time,
  reason = '',
  created_by_ai = 0
}) {
  const patientId = positiveId(patient_id);
  const doctorId = positiveId(doctor_id);
  const time = normalizeTime(appointment_time);

  /* Kiểm tra dữ liệu đầu vào */

  if (
    !patientId ||
    !doctorId ||
    !isValidDate(appointment_date) ||
    !isValidTime(time)
  ) {
    const error = new Error(
      'Thông tin đặt lịch không hợp lệ'
    );

    error.status = 400;
    throw error;
  }

  if (isPastDate(appointment_date)) {
    const error = new Error(
      'Không thể đặt lịch vào ngày đã qua'
    );

    error.status = 400;
    throw error;
  }

  /*
   * Khóa dữ liệu bác sĩ trong lúc kiểm tra và tạo lịch.
   * Route báo nghỉ khẩn cấp cũng phải khóa cùng dòng bác sĩ.
   * Nhờ đó không có lịch mới lọt vào đúng lúc bác sĩ báo nghỉ.
   */

  const created = await withTransaction(async transaction => {
    /* Kiểm tra bệnh nhân */

    const patient = await transaction.get(
      `SELECT id
       FROM users
       WHERE id = ?
         AND role = 'patient'
         AND is_active = 1`,
      [patientId]
    );

    if (!patient) {
      const error = new Error(
        'Không tìm thấy tài khoản bệnh nhân đang hoạt động'
      );

      error.status = 404;
      throw error;
    }

    /* Khóa dòng bác sĩ */

    const doctorLock = await transaction.get(
      `SELECT id
       FROM doctors
       WHERE id = ?
       FOR UPDATE`,
      [doctorId]
    );

    if (!doctorLock) {
      const error = new Error(
        'Không tìm thấy bác sĩ'
      );

      error.status = 404;
      throw error;
    }

    /* Kiểm tra bác sĩ có đi làm và còn giờ trống không */

    const availability = await getAvailableSlots(
      doctorId,
      appointment_date,
      transaction
    );

    if (!availability.doctor) {
      const error = new Error(
        'Không tìm thấy bác sĩ'
      );

      error.status = 404;
      error.availableSlots = [];

      throw error;
    }

    if (availability.doctorOff) {
      const error = new Error(
        `Bác sĩ ${availability.doctor.full_name} không làm việc ngày ${appointment_date}. Vui lòng chọn bác sĩ hoặc ngày khác.`
      );

      error.status = 409;
      error.doctorOff = true;
      error.reason = availability.reason;
      error.availableSlots = [];

      throw error;
    }

    if (
      !availability.availableSlots.includes(time)
    ) {
      const error = new Error(
        'Khung giờ này đã bận hoặc không thuộc lịch làm việc của bác sĩ'
      );

      error.status = 409;
      error.availableSlots =
        availability.availableSlots;
      error.busySlots =
        availability.busySlots;

      throw error;
    }

    /* Lưu lịch khám */

    try {
      const result = await transaction.run(
        `INSERT INTO appointments(
           patient_id,
           doctor_id,
           appointment_date,
           appointment_time,
           reason,
           created_by_ai
         )
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          patientId,
          doctorId,
          appointment_date,
          `${time}:00`,
          cleanText(reason, 1000),
          created_by_ai ? 1 : 0
        ]
      );

      return {
        appointmentId: result.insertId,
        availability
      };
    } catch (error) {
      /*
       * Trường hợp một bệnh nhân khác vừa đặt
       * cùng khung giờ.
       */

      if (error.code !== 'ER_DUP_ENTRY') {
        throw error;
      }

      const freshAvailability =
        await getAvailableSlots(
          doctorId,
          appointment_date,
          transaction
        );

      const conflictError = new Error(
        'Khung giờ này vừa có bệnh nhân khác đặt. Vui lòng chọn giờ còn trống.'
      );

      conflictError.status = 409;
      conflictError.availableSlots =
        freshAvailability.availableSlots;
      conflictError.busySlots =
        freshAvailability.busySlots;

      throw conflictError;
    }
  });

  const appointmentId = created.appointmentId;
  const availability = created.availability;

  /* Thông báo cho bệnh nhân */

  await createNotification(
    patientId,
    'Đặt lịch thành công',
    `Lịch khám của bạn được đặt vào ${appointment_date} lúc ${time}.`
  );

  /* Thông báo cho Admin */

  const admins = await all(
    `SELECT id
     FROM users
     WHERE role = 'admin'
       AND is_active = 1`
  );

  for (const admin of admins) {
    await createNotification(
      admin.id,
      'Có lịch hẹn mới',
      `Bệnh nhân vừa đặt lịch với ${availability.doctor.full_name} vào ${appointment_date} lúc ${time}.`
    );
  }

  return {
    id: appointmentId,
    appointment_date,
    appointment_time: time,
    doctor: availability.doctor
  };
}

/* =========================
   XUẤT CÁC HÀM
========================= */

module.exports = {
  getAvailableSlots,
  createAppointment,
  toTime5,
  generateSlots
};