# BA Requirements - Clinic AI Agent Booking

## Mục tiêu hệ thống

Xây dựng website hỗ trợ bệnh nhân đặt lịch khám trực tuyến, chat với AI để được tư vấn và đặt lịch tự động, chat trực tuyến với bác sĩ, gửi khiếu nại qua CSKH, đồng thời hỗ trợ bác sĩ quản lý lịch làm việc và admin quản trị tài khoản.

## Actor

| Actor | Mô tả |
|---|---|
| Bệnh nhân | Người đặt lịch, chat AI, chat bác sĩ, gửi khiếu nại |
| Bác sĩ | Người khám bệnh, xem lịch làm, điểm danh, xin nghỉ, chat bệnh nhân, ghi hồ sơ khám |
| Admin | Quản trị tài khoản, duyệt nghỉ, điều phối bác sĩ thay thế, theo dõi chấm công |
| CSKH | Tiếp nhận và xử lý khiếu nại |
| AI Agent | Tư vấn sơ bộ và hỗ trợ đặt lịch cho bệnh nhân |

## Functional Requirements

| Mã | Chức năng | Actor | Mức ưu tiên |
|---|---|---|---|
| FR-01 | Đăng ký/đăng nhập | Bệnh nhân, Bác sĩ, Admin, CSKH | High |
| FR-02 | Quên mật khẩu và cấp mã về Gmail | Bệnh nhân | High |
| FR-03 | Xem chuyên khoa và bác sĩ | Bệnh nhân | High |
| FR-04 | Đặt lịch theo ngày tháng năm và giờ khám | Bệnh nhân | High |
| FR-05 | Kiểm tra trùng lịch và gợi ý giờ trống | Hệ thống | High |
| FR-06 | Chat AI tư vấn sức khỏe | Bệnh nhân | High |
| FR-07 | AI Agent hỗ trợ đặt lịch | Bệnh nhân, AI Agent | High |
| FR-08 | Gửi khiếu nại về bác sĩ hoặc website | Bệnh nhân | Medium |
| FR-09 | Xử lý khiếu nại | Admin, CSKH | Medium |
| FR-10 | Chat trực tuyến bác sĩ - bệnh nhân | Bệnh nhân, Bác sĩ | High |
| FR-11 | Bác sĩ xem lịch làm và điểm danh đi làm | Bác sĩ | High |
| FR-12 | Bác sĩ gửi đơn xin nghỉ; hệ thống thông báo cho admin | Bác sĩ, Hệ thống | High |
| FR-13 | Bác sĩ tick trạng thái đã khám/chưa khám | Bác sĩ | High |
| FR-14 | Bác sĩ ghi chú hồ sơ khám bệnh | Bác sĩ | High |
| FR-15 | Admin thêm/sửa/xóa/khóa tài khoản bác sĩ | Admin | High |
| FR-16 | Admin thêm/sửa/xóa/khóa tài khoản bệnh nhân | Admin | High |
| FR-17 | Bác sĩ xem lịch làm việc 30 ngày và điểm danh hôm nay | Bác sĩ | High |
| FR-18 | Bác sĩ gửi/rút đơn xin nghỉ, đính kèm ảnh hoặc PDF minh chứng | Bác sĩ | High |
| FR-19 | Admin xem, duyệt hoặc từ chối đơn nghỉ | Admin | High |
| FR-20 | Khi duyệt nghỉ, admin chọn bác sĩ cùng chuyên khoa thay thế hoặc hủy các lịch bị ảnh hưởng | Admin | High |
| FR-21 | Lưu lịch đã hủy kèm người hủy, lý do, trạng thái cũ và thời điểm hủy | Hệ thống | High |
| FR-22 | Admin xem trạng thái có ca, đã điểm danh, đang xin nghỉ, nghỉ đã duyệt theo ngày | Admin, CSKH | High |

## Business Rules

| Mã | Quy tắc nghiệp vụ |
|---|---|
| BR-01 | Một bác sĩ không thể có hai lịch hẹn cùng ngày và cùng giờ nếu lịch chưa bị hủy. |
| BR-02 | Ngày nghỉ chỉ có hiệu lực sau khi admin duyệt; bệnh nhân không được đặt lịch với bác sĩ trong ngày nghỉ đã duyệt. |
| BR-03 | Nếu bác sĩ nghỉ và đã có bệnh nhân đặt lịch, admin bắt buộc chọn bác sĩ cùng chuyên khoa đủ ca trống để thay hoặc hủy toàn bộ lịch bị ảnh hưởng. |
| BR-04 | AI Agent chỉ được đặt lịch cho tài khoản bệnh nhân đang đăng nhập. |
| BR-05 | Khi đặt lịch qua AI, yêu cầu phải có ngày khám, giờ khám và chuyên khoa hoặc bác sĩ. |
| BR-06 | Bác sĩ chỉ được cập nhật hồ sơ khám cho lịch hẹn của mình. |
| BR-07 | Bệnh nhân chỉ được gửi khiếu nại bằng tài khoản bệnh nhân. |
| BR-08 | Admin có quyền khóa tài khoản bệnh nhân và bác sĩ. |
| BR-09 | Mã quên mật khẩu có hiệu lực trong 10 phút. |
| BR-10 | Bác sĩ chỉ được điểm danh đúng ngày hiện tại, khi có ca làm và không có ngày nghỉ đã duyệt. |
| BR-11 | Nghỉ có kế hoạch phải gửi trước số ngày do bệnh viện cấu hình; bản demo mặc định là 3 ngày. |
| BR-12 | Đơn nghỉ khẩn cấp bắt buộc có minh chứng JPG, PNG, WEBP hoặc PDF, tối đa 5 MB. |
| BR-13 | Bác sĩ thay thế phải cùng chuyên khoa, có ca bao phủ giờ khám, không nghỉ và không bị trùng lịch. |
| BR-14 | Lịch bị hủy không được xóa; phải lưu người hủy, vai trò, lý do, trạng thái cũ và thời điểm hủy. |
| BR-15 | Mọi lần hủy, đổi trạng thái và điều phối bác sĩ đều được ghi vào lịch sử thao tác. |

## Non-functional Requirements

| Mã | Yêu cầu phi chức năng |
|---|---|
| NFR-01 | Mật khẩu phải được mã hóa bằng bcrypt. |
| NFR-02 | API cần xác thực bằng JWT token. |
| NFR-03 | Chat trực tuyến dùng Socket.IO để cập nhật real-time. |
| NFR-04 | CSDL sử dụng MySQL và có khóa ngoại giữa các bảng chính. |
| NFR-05 | Hệ thống có thể chạy local bằng VS Code, Node.js và MySQL. |

## Use Case chính

- Đặt lịch khám trực tuyến.
- Chat AI và nhờ AI đặt lịch.
- Chat trực tuyến với bác sĩ.
- Khiếu nại CSKH.
- Bác sĩ xem lịch làm, điểm danh và gửi đơn xin nghỉ.
- Admin duyệt nghỉ, điều phối bác sĩ thay thế hoặc hủy lịch bị ảnh hưởng.
- Tra cứu kho lịch đã hủy.
- Bác sĩ ghi hồ sơ khám.
- Admin quản lý tài khoản.

## Database tables

- users
- specialties
- doctors
- doctor_schedules
- doctor_attendance
- doctor_leave_requests
- appointments
- appointment_cancellations
- appointment_history
- medical_records
- complaints
- conversations
- chat_messages
- ai_chats
- password_resets
- notifications
