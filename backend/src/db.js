const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

let pool;

function getDbConfig() {
  const database = process.env.DB_NAME || 'clinic_ai_agent';
  if (!/^[a-zA-Z0-9_]+$/.test(database)) {
    throw new Error('DB_NAME chỉ được chứa chữ, số và dấu gạch dưới');
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+07:00'
  };
}

async function ensureDatabase() {
  const cfg = getDbConfig();
  const connection = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password
  });

  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.end();
}

async function getPool() {
  if (pool) return pool;
  await ensureDatabase();
  pool = mysql.createPool(getDbConfig());
  return pool;
}

async function run(sql, params = []) {
  const p = await getPool();
  const [result] = await p.execute(sql, params);
  return result;
}

async function all(sql, params = []) {
  const p = await getPool();
  const [rows] = await p.execute(sql, params);
  return rows;
}

async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0];
}

async function withTransaction(work) {
  const p = await getPool();
  const connection = await p.getConnection();

  const tx = {
    run: async (sql, params = []) => {
      const [result] = await connection.execute(sql, params);
      return result;
    },
    all: async (sql, params = []) => {
      const [rows] = await connection.execute(sql, params);
      return rows;
    },
    get: async (sql, params = []) => {
      const [rows] = await connection.execute(sql, params);
      return rows[0];
    }
  };

  try {
    await connection.beginTransaction();
    const result = await work(tx);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function createUser({ full_name, email, password, role, phone = '', is_active = 1 }) {
  const hashed = await bcrypt.hash(password, 10);
  const result = await run(
    `INSERT INTO users(full_name, email, password, role, phone, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [full_name, email, hashed, role, phone, is_active]
  );
  return result.insertId;
}

async function createNotification(userId, title, message) {
  await run(
    `INSERT INTO notifications(user_id, title, message) VALUES (?, ?, ?)`,
    [userId, title, message]
  );
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      full_name VARCHAR(120) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role ENUM('patient', 'doctor', 'admin', 'support') NOT NULL DEFAULT 'patient',
      phone VARCHAR(30),
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS specialties (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(120) NOT NULL UNIQUE,
      description TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS doctors (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL UNIQUE,
      specialty_id INT NOT NULL,
      degree VARCHAR(120),
      experience VARCHAR(120),
      room VARCHAR(50),
      bio TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(specialty_id) REFERENCES specialties(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS doctor_schedules (
      id INT PRIMARY KEY AUTO_INCREMENT,
      doctor_id INT NOT NULL,
      work_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      status ENUM('active', 'disabled') DEFAULT 'active',
      FOREIGN KEY(doctor_id) REFERENCES doctors(id),
      INDEX idx_schedule_doctor_date(doctor_id, work_date)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS doctor_attendance (
      id INT PRIMARY KEY AUTO_INCREMENT,
      doctor_id INT NOT NULL,
      work_date DATE NOT NULL,
      status ENUM('working', 'off') NOT NULL DEFAULT 'working',
      reason TEXT,
      check_in_at TIMESTAMP NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY(doctor_id) REFERENCES doctors(id),
      UNIQUE KEY unique_attendance(doctor_id, work_date)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS doctor_leave_requests (
      id INT PRIMARY KEY AUTO_INCREMENT,
      doctor_id INT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      leave_type ENUM('planned', 'emergency') NOT NULL,
      reason TEXT NOT NULL,
      status ENUM('pending', 'approved', 'rejected', 'withdrawn') NOT NULL DEFAULT 'pending',
      resolution_action ENUM('none', 'replace', 'cancel') NULL,
      replacement_doctor_id INT NULL,
      reviewed_by INT NULL,
      review_note TEXT,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TIMESTAMP NULL,
      FOREIGN KEY(doctor_id) REFERENCES doctors(id),
      FOREIGN KEY(replacement_doctor_id) REFERENCES doctors(id),
      FOREIGN KEY(reviewed_by) REFERENCES users(id),
      INDEX idx_leave_doctor_dates(doctor_id, start_date, end_date),
      INDEX idx_leave_status(status, start_date)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INT PRIMARY KEY AUTO_INCREMENT,
      patient_id INT NOT NULL,
      doctor_id INT NOT NULL,
      appointment_date DATE NOT NULL,
      appointment_time TIME NOT NULL,
      reason TEXT,
      status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
      created_by_ai TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      active_slot VARCHAR(80)
        GENERATED ALWAYS AS (
          CASE
            WHEN status <> 'cancelled'
            THEN CONCAT(doctor_id, '#', appointment_date, '#', appointment_time)
            ELSE NULL
          END
        ) STORED,
      FOREIGN KEY(patient_id) REFERENCES users(id),
      FOREIGN KEY(doctor_id) REFERENCES doctors(id),
      UNIQUE KEY unique_active_doctor_slot(active_slot),
      INDEX idx_appt_doctor_date_time(doctor_id, appointment_date, appointment_time),
      INDEX idx_appt_patient(patient_id)
    )
  `);

  const activeSlotColumn = await get(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'appointments' AND COLUMN_NAME = 'active_slot'`,
    [getDbConfig().database]
  );

  if (!activeSlotColumn) {
    await run(`
      ALTER TABLE appointments
      ADD COLUMN active_slot VARCHAR(80)
        GENERATED ALWAYS AS (
          CASE
            WHEN status <> 'cancelled'
            THEN CONCAT(doctor_id, '#', appointment_date, '#', appointment_time)
            ELSE NULL
          END
        ) STORED,
      ADD UNIQUE KEY unique_active_doctor_slot(active_slot)
    `);
  }

  await run(`
    CREATE TABLE IF NOT EXISTS appointment_cancellations (
      id INT PRIMARY KEY AUTO_INCREMENT,
      appointment_id INT NOT NULL UNIQUE,
      cancelled_by INT NULL,
      cancelled_by_role ENUM('patient', 'doctor', 'admin', 'support', 'system') NOT NULL,
      reason TEXT NOT NULL,
      previous_status ENUM('pending', 'confirmed', 'completed') NOT NULL,
      leave_request_id INT NULL,
      cancelled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(appointment_id) REFERENCES appointments(id),
      FOREIGN KEY(cancelled_by) REFERENCES users(id),
      FOREIGN KEY(leave_request_id) REFERENCES doctor_leave_requests(id),
      INDEX idx_cancellation_date(cancelled_at)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS appointment_history (
      id INT PRIMARY KEY AUTO_INCREMENT,
      appointment_id INT NOT NULL,
      action_type ENUM('status_change', 'cancel', 'reassign') NOT NULL,
      old_status VARCHAR(30),
      new_status VARCHAR(30),
      previous_doctor_id INT NULL,
      new_doctor_id INT NULL,
      actor_user_id INT NULL,
      actor_role VARCHAR(30) NOT NULL,
      reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(appointment_id) REFERENCES appointments(id),
      FOREIGN KEY(previous_doctor_id) REFERENCES doctors(id),
      FOREIGN KEY(new_doctor_id) REFERENCES doctors(id),
      FOREIGN KEY(actor_user_id) REFERENCES users(id),
      INDEX idx_appointment_history(appointment_id, created_at)
    )
  `);

  await run(`
    INSERT IGNORE INTO appointment_cancellations(
      appointment_id,
      cancelled_by,
      cancelled_by_role,
      reason,
      previous_status,
      cancelled_at
    )
    SELECT
      appointments.id,
      NULL,
      'system',
      'Lịch đã hủy trước khi bật chức năng lưu lịch sử',
      'pending',
      appointments.created_at
    FROM appointments
    WHERE appointments.status = 'cancelled'
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS medical_records (
      id INT PRIMARY KEY AUTO_INCREMENT,
      appointment_id INT NOT NULL UNIQUE,
      patient_id INT NOT NULL,
      doctor_id INT NOT NULL,
      symptoms TEXT,
      diagnosis TEXT,
      prescription TEXT,
      doctor_note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY(appointment_id) REFERENCES appointments(id),
      FOREIGN KEY(patient_id) REFERENCES users(id),
      FOREIGN KEY(doctor_id) REFERENCES doctors(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS complaints (
      id INT PRIMARY KEY AUTO_INCREMENT,
      patient_id INT NOT NULL,
      target_type ENUM('doctor', 'website') NOT NULL,
      doctor_id INT NULL,
      subject VARCHAR(200) NOT NULL,
      message TEXT NOT NULL,
      status ENUM('new', 'processing', 'resolved', 'rejected') DEFAULT 'new',
      admin_reply TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY(patient_id) REFERENCES users(id),
      FOREIGN KEY(doctor_id) REFERENCES doctors(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INT PRIMARY KEY AUTO_INCREMENT,
      patient_id INT NOT NULL,
      doctor_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(patient_id) REFERENCES users(id),
      FOREIGN KEY(doctor_id) REFERENCES doctors(id),
      UNIQUE KEY unique_conversation(patient_id, doctor_id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INT PRIMARY KEY AUTO_INCREMENT,
      conversation_id INT NOT NULL,
      sender_id INT NOT NULL,
      receiver_id INT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      read_at TIMESTAMP NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id),
      FOREIGN KEY(sender_id) REFERENCES users(id),
      FOREIGN KEY(receiver_id) REFERENCES users(id),
      INDEX idx_chat_conversation(conversation_id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS ai_chats (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      message TEXT NOT NULL,
      reply TEXT NOT NULL,
      action VARCHAR(60),
      appointment_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(appointment_id) REFERENCES appointments(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      code VARCHAR(10) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      title VARCHAR(200) NOT NULL,
      message TEXT NOT NULL,
      is_read TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      INDEX idx_notification_user(user_id, is_read)
    )
  `);

  await seedDb();
}

async function seedDb() {
  const defaultSeed = process.env.NODE_ENV === 'production' ? 'false' : 'true';
  const shouldSeed = String(process.env.SEED_DEMO_DATA || defaultSeed).toLowerCase() === 'true';
  if (!shouldSeed) return;

  const count = await get(`SELECT COUNT(*) AS total FROM users`);
  if (count.total > 0) {
    await ensureDemoReplacementDoctor();
    await ensureDemoTodaySchedules();
    return;
  }

  await run(`
    INSERT INTO specialties(name, description) VALUES
    ('Nội tổng quát', 'Khám sức khỏe tổng quát, sốt, đau đầu, mệt mỏi'),
    ('Tai Mũi Họng', 'Khám ho, đau họng, viêm mũi, viêm xoang'),
    ('Da liễu', 'Khám mụn, dị ứng, mề đay, bệnh ngoài da'),
    ('Tiêu hóa', 'Khám đau bụng, tiêu chảy, buồn nôn, bệnh dạ dày'),
    ('Tim mạch', 'Khám đau ngực, huyết áp, hồi hộp, bệnh tim mạch'),
    ('Phụ khoa', 'Khám sức khỏe phụ khoa')
  `);

  await createUser({ full_name: 'Admin hệ thống', email: 'admin@gmail.com', password: '123456789', role: 'admin', phone: '0900000001' });
  await createUser({ full_name: 'Nhân viên CSKH', email: 'support@gmail.com', password: '123456789', role: 'support', phone: '0900000002' });
  await createUser({ full_name: 'Nguyễn Thanh Cảnh', email: 'patient@gmail.com', password: '123456789', role: 'patient', phone: '0900000003' });
  await createUser({ full_name: 'Trần Ngọc Anh', email: 'patient2@gmail.com', password: '123456789', role: 'patient', phone: '0900000004' });

  const doctorSeeds = [
    ['BS. Phạm Anh Tuấn', 'noitongquat@gmail.com', 'Nội tổng quát', 'Bác sĩ CKI', '5 năm', 'P101', 'Chuyên khám nội tổng quát và tư vấn sức khỏe ban đầu'],
    ['BS. Nguyễn Minh An', 'taimuihong@gmail.com', 'Tai Mũi Họng', 'Thạc sĩ - Bác sĩ', '8 năm', 'P102', 'Chuyên điều trị các bệnh tai mũi họng'],
    ['BS. Trần Thu Hà', 'dalieu@gmail.com', 'Da liễu', 'Bác sĩ CKI', '6 năm', 'P103', 'Chuyên khám dị ứng, mụn, mề đay'],
    ['BS. Lê Quốc Bình', 'tieuhoa@gmail.com', 'Tiêu hóa', 'Bác sĩ CKI', '7 năm', 'P104', 'Chuyên khám tiêu hóa, dạ dày'],
    ['BS. Võ Hoàng Nam', 'timmach@gmail.com', 'Tim mạch', 'Thạc sĩ - Bác sĩ', '9 năm', 'P105', 'Chuyên khám huyết áp và tim mạch'],
    ['BS. Mai Thanh Hương', 'phukhoa@gmail.com', 'Phụ khoa', 'Bác sĩ CKI', '6 năm', 'P106', 'Chuyên khám sức khỏe phụ khoa'],
    ['BS. Đỗ Minh Khoa', 'noitongquat2@gmail.com', 'Nội tổng quát', 'Bác sĩ CKI', '4 năm', 'P107', 'Bác sĩ dự phòng để điều phối lịch khám Nội tổng quát']
  ];

  for (const [fullName, email, specialtyName, degree, experience, room, bio] of doctorSeeds) {
    const userId = await createUser({ full_name: fullName, email, password: '123456789', role: 'doctor' });
    const specialty = await get(`SELECT id FROM specialties WHERE name = ?`, [specialtyName]);
    const doctor = await run(
      `INSERT INTO doctors(user_id, specialty_id, degree, experience, room, bio) VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, specialty.id, degree, experience, room, bio]
    );
    const doctorId = doctor.insertId;

    for (let i = 1; i <= 21; i += 1) {
      await run(
        `INSERT INTO doctor_schedules(doctor_id, work_date, start_time, end_time)
         VALUES
         (?, DATE_ADD(CURDATE(), INTERVAL ? DAY), '08:00', '11:00'),
         (?, DATE_ADD(CURDATE(), INTERVAL ? DAY), '13:30', '16:30')`,
        [doctorId, i, doctorId, i]
      );
    }
  }

  await ensureDemoTodaySchedules();
}

async function ensureDemoReplacementDoctor() {
  const existing = await get(`SELECT id FROM users WHERE email = ?`, ['noitongquat2@gmail.com']);
  if (existing) return;

  const specialty = await get(`SELECT id FROM specialties WHERE name = ?`, ['Nội tổng quát']);
  if (!specialty) return;

  const userId = await createUser({
    full_name: 'BS. Đỗ Minh Khoa',
    email: 'noitongquat2@gmail.com',
    password: '123456789',
    role: 'doctor'
  });
  const doctor = await run(
    `INSERT INTO doctors(user_id, specialty_id, degree, experience, room, bio)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      specialty.id,
      'Bác sĩ CKI',
      '4 năm',
      'P107',
      'Bác sĩ dự phòng để điều phối lịch khám Nội tổng quát'
    ]
  );

  for (let i = 1; i <= 21; i += 1) {
    await run(
      `INSERT INTO doctor_schedules(doctor_id, work_date, start_time, end_time)
       VALUES
       (?, DATE_ADD(CURDATE(), INTERVAL ? DAY), '08:00', '11:00'),
       (?, DATE_ADD(CURDATE(), INTERVAL ? DAY), '13:30', '16:30')`,
      [doctor.insertId, i, doctor.insertId, i]
    );
  }
}

async function ensureDemoTodaySchedules() {
  const doctors = await all(
    `SELECT doctors.id
     FROM doctors
     JOIN users ON doctors.user_id = users.id
     WHERE users.is_active = 1
       AND NOT EXISTS (
         SELECT 1 FROM doctor_leave_requests
         WHERE doctor_leave_requests.doctor_id = doctors.id
           AND (
             doctor_leave_requests.status = 'approved'
             OR (
               doctor_leave_requests.leave_type = 'emergency'
               AND doctor_leave_requests.status IN ('pending', 'rejected')
             )
           )
           AND CURDATE() BETWEEN start_date AND end_date
       )`
  );

  for (const doctor of doctors) {
    const existing = await get(
      `SELECT id FROM doctor_schedules
       WHERE doctor_id = ? AND work_date = CURDATE() AND status = 'active'
       LIMIT 1`,
      [doctor.id]
    );
    if (existing) continue;

    await run(
      `INSERT INTO doctor_schedules(doctor_id, work_date, start_time, end_time)
       VALUES
       (?, CURDATE(), '08:00', '11:00'),
       (?, CURDATE(), '13:30', '16:30')`,
      [doctor.id, doctor.id]
    );
  }
}

module.exports = {
  run,
  all,
  get,
  initDb,
  createUser,
  createNotification,
  withTransaction
};