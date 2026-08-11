# Clinic AI Agent Booking Web

Project web hỗ trợ đặt lịch khám trực tuyến, chat AI Agent, chat bác sĩ - bệnh nhân, khiếu nại CSKH, điểm danh bác sĩ và quản trị tài khoản.

## 1. Công nghệ

- Backend: Node.js, Express.js, Socket.IO
- Database: MySQL
- Frontend: React, Vite, Axios, Socket.IO Client
- AI: Gemini API tùy chọn, nếu không có key sẽ dùng AI demo fallback
- Email quên mật khẩu: Nodemailer + Gmail SMTP, có chế độ demo `EMAIL_DRY_RUN=true`

Yêu cầu: **Node.js 20 trở lên**, npm và **MySQL 8 trở lên**.

## 2. Chức năng đã có

### Bệnh nhân
- Đăng ký, đăng nhập.
- Đặt lịch khám theo chuyên khoa, bác sĩ, ngày tháng năm và giờ khám.
- Hệ thống báo trùng lịch/bác sĩ bận và gợi ý giờ còn trống.
- Chat với AI Agent và có thể bảo AI đặt lịch cho bản thân.
- Chat trực tuyến với bác sĩ.
- Gửi khiếu nại về bác sĩ hoặc website qua kênh CSKH.
- Xem lịch hẹn và thông báo.
- Tự hủy lịch khi có lý do; lịch được chuyển sang kho lịch đã hủy, không bị xóa.
- Quên mật khẩu: nhận mã qua Gmail hoặc mã demo khi chưa cấu hình SMTP.

### Bác sĩ
- Đăng nhập.
- Chat trực tuyến với bệnh nhân.
- Xem lịch làm việc, số lịch khám và trạng thái 30 ngày.
- Chỉ điểm danh được trong ngày hiện tại khi có ca làm.
- Gửi đơn xin nghỉ có kế hoạch hoặc nghỉ khẩn cấp; 
- Xem cách admin xử lý lịch bị ảnh hưởng: thay bác sĩ hoặc hủy lịch.
- Xem lịch khám.
- Tick đã khám/chưa khám bằng trạng thái lịch hẹn.
- Ghi chú hồ sơ khám bệnh: triệu chứng, chẩn đoán, đơn thuốc, ghi chú bác sĩ.

### Admin / CSKH
- Xem thống kê tổng quan.
- Quản lý tài khoản bệnh nhân.
- Quản lý tài khoản bác sĩ.
- Thêm tài khoản admin/CSKH.
- Khóa tài khoản.
- Xem và xử lý khiếu nại.
- Nhận thông báo khi bác sĩ báo nghỉ hoặc có lịch mới.
- Xem trạng thái bác sĩ theo hôm nay, ngày mai hoặc ngày tự chọn.
- Duyệt/từ chối đơn nghỉ; xem tệp minh chứng.
- Nếu đã có bệnh nhân, bắt buộc chọn bác sĩ cùng chuyên khoa đủ ca trống để thay hoặc hủy lịch.
- Xem kho lịch đã hủy và thông tin kiểm tra: ai hủy, lý do, thời điểm hủy.

## 3. Cấu trúc thư mục

```txt
clinic-ai-agent-booking-web
├── backend
│   ├── src
│   │   ├── server.js
│   │   ├── db.js
│   │   ├── appointmentService.js
│   │   ├── aiAgent.js
│   │   └── mailer.js
│   ├── .env.example
│   └── package.json
└── frontend
    ├── src
    │   ├── pages
    │   ├── components
    │   ├── api.js
    │   ├── App.jsx
    │   ├── main.jsx
    │   └── style.css
    ├── .env.example
    └── package.json
```

## 4. Cài đặt và chạy Backend

Mở terminal trong VS Code:

```powershell
cd backend
copy .env.example .env
npm install
npm run dev
```

Sửa file `backend/.env` theo MySQL của bạn:

```env
PORT=3000
FRONTEND_URL=http://localhost:5173

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=mat_khau_mysql_cua_ban
DB_NAME=clinic_ai_agent

JWT_SECRET=thay_bang_chuoi_bi_mat_ngau_nhien_tu_32_ky_tu
SEED_DEMO_DATA=true
PLANNED_LEAVE_NOTICE_DAYS=3

GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

EMAIL_DRY_RUN=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_gmail_app_password
```

Backend chạy thành công khi thấy:

```txt
Database initialized successfully
Backend running at http://localhost:3000
```

Test API:

```txt
http://localhost:3000
http://localhost:3000/api/specialties
```

Database và các bảng sẽ được tạo tự động. Nếu tài khoản MySQL không có quyền
`CREATE DATABASE`, hãy tạo database `clinic_ai_agent` trước rồi chạy lại.

## 5. Cách chạy Frontend

Mở terminal thứ 2:

```powershell
cd frontend
copy .env.example .env
npm install
npm run dev
```

Mở trình duyệt:

```txt
http://localhost:5173
```

## 6. Tài khoản mẫu

Mật khẩu chung: `123456789`

| Vai trò | Email |
|---|---|
| Admin | `admin@gmail.com` |
| CSKH | `support@gmail.com` |
| Bệnh nhân | `patient@gmail.com` |
| Bệnh nhân 2 | `patient2@gmail.com` |
| Bác sĩ Nội tổng quát | `noitongquat@gmail.com` |
| Bác sĩ Nội tổng quát dự phòng | `noitongquat2@gmail.com` |
| Bác sĩ Tai Mũi Họng | `taimuihong@gmail.com` |
| Bác sĩ Da liễu | `dalieu@gmail.com` |
| Bác sĩ Tiêu hóa | `tieuhoa@gmail.com` |
| Bác sĩ Tim mạch | `timmach@gmail.com` |
| Bác sĩ Phụ khoa | `phukhoa@gmail.com` |

Các tài khoản này chỉ dùng để trình bày đồ án. Khi triển khai thật, đặt
`SEED_DEMO_DATA=false`, dùng mật khẩu riêng và thay `JWT_SECRET`.

## 7. Cách dùng AI Agent đặt lịch

Đăng nhập bằng tài khoản bệnh nhân, vào trang **Chat AI đặt lịch**, nhập câu như:

```txt
Đặt lịch khám Tai Mũi Họng ngày mai lúc 08:30 vì tôi bị đau họng
```

Hoặc:

```txt
Đặt lịch khám Tim mạch ngày 20/07/2026 lúc 09:00
```

AI sẽ kiểm tra:

- Có đủ ngày khám chưa.
- Có đủ giờ khám chưa.
- Có chuyên khoa hoặc bác sĩ chưa.
- Bác sĩ có nghỉ ngày đó không.
- Giờ đó có bị bệnh nhân khác đặt trùng không.

Nếu giờ bận, AI trả về danh sách giờ còn trống.

## 8. Cấu hình Gmail cho quên mật khẩu

Mặc định project để:

```env
EMAIL_DRY_RUN=true
```

Khi đó mã quên mật khẩu hiện trực tiếp trên giao diện để demo.

Muốn gửi mã thật về Gmail, sửa:

```env
EMAIL_DRY_RUN=false
SMTP_USER=email_cua_ban@gmail.com
SMTP_PASS=gmail_app_password
```

Gmail cần dùng **App Password**, không dùng mật khẩu đăng nhập Gmail thông thường.

## 9. Các API chính

### Auth
- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

### Đặt lịch
- `GET /api/specialties`
- `GET /api/doctors`
- `GET /api/availability?doctor_id=1&date=2026-07-20`
- `POST /api/appointments`
- `GET /api/appointments/my`
- `PATCH /api/appointments/:id/status`

### AI Agent
- `POST /api/ai/chat`
- `GET /api/ai/history`

### Chat bác sĩ - bệnh nhân
- `POST /api/conversations`
- `GET /api/conversations`
- `GET /api/conversations/:id/messages`
- `POST /api/conversations/:id/messages`

### Khiếu nại
- `POST /api/complaints`
- `GET /api/complaints/my`
- `GET /api/complaints`
- `PATCH /api/complaints/:id`

### Bác sĩ
- `POST /api/doctor/attendance`
- `GET /api/doctor/calendar`
- `GET /api/doctor/leave-requests`
- `POST /api/doctor/leave-requests`
- `PATCH /api/doctor/leave-requests/:id/withdraw`
- `GET /api/leave-requests/:id/evidence`
- `POST /api/medical-records`
- `GET /api/medical-records/my`

### Admin
- `GET /api/admin/users?role=patient`
- `GET /api/admin/users?role=doctor`
- `POST /api/admin/users`
- `PUT /api/admin/users/:id`
- `DELETE /api/admin/users/:id`
- `GET /api/admin/leave-requests`
- `GET /api/admin/leave-requests/:id/coverage`
- `PATCH /api/admin/leave-requests/:id/review`
- `GET /api/attendance?date=YYYY-MM-DD`
- `GET /api/admin/summary`

### Hủy và lưu lịch
- `POST /api/appointments/:id/cancel`
- `GET /api/appointments/cancelled`

## 10. Quy trình nghỉ và điều phối lịch

1. Admin tạo ca làm việc cho bác sĩ.
2. Bác sĩ xem lịch 30 ngày và điểm danh khi đến làm.
3. Khi cần nghỉ, bác sĩ gửi đơn; nghỉ khẩn cấp phải có minh chứng.
4. Admin mở **Điều phối bác sĩ** để duyệt.
5. Nếu chưa có bệnh nhân, admin có thể duyệt ngay.
6. Nếu đã có lịch khám, admin phải chọn:
   - **Duyệt + thay bác sĩ:** chỉ chọn được bác sĩ cùng chuyên khoa và đủ giờ trống.
   - **Duyệt + hủy lịch:** bệnh nhân nhận thông báo và lịch được lưu tại **Kho lịch đã hủy**.

`PLANNED_LEAVE_NOTICE_DAYS=3` là quy định nội bộ mẫu cho đồ án và có thể đổi trong `.env`.
Luật lao động không ấn định một số ngày báo trước chung cho mọi đơn nghỉ phép; bệnh viện thực tế cần cấu hình theo nội quy của đơn vị.

Kịch bản kiểm thử từng bước: `docs/TEST_ATTENDANCE_LEAVE.md`.

## 11. Kiểm tra trước khi nộp

```powershell
cd backend
npm test
npm audit --omit=dev

cd ..\frontend
npm run build
npm audit --omit=dev
```

Không đưa các thư mục `node_modules`, `dist` hoặc file `.env` lên Git/ZIP.
Chỉ gửi `.env.example`; mỗi máy tự tạo `.env` riêng.

## 12. Các lưu ý an toàn

- AI chỉ tư vấn tham khảo, không thay thế bác sĩ.
- API có xác thực JWT, kiểm tra vai trò và giới hạn số lần gọi các API đăng nhập.
- Mật khẩu được băm bằng bcrypt.
- Mã đặt lại mật khẩu có hiệu lực 10 phút.
- Database chặn hai lịch chưa hủy của cùng bác sĩ tại cùng một thời điểm.
- Ghi chú riêng của bác sĩ không trả về cho tài khoản bệnh nhân.
