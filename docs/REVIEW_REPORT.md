# Báo cáo kiểm tra và sửa chữa đồ án

## Phạm vi đã kiểm tra

- Cấu trúc React/Vite, Express, MySQL và Socket.IO.
- Đăng ký, đăng nhập, quên mật khẩu và phân quyền.
- Đặt lịch trực tiếp và qua AI.
- Lịch hẹn, hồ sơ khám, khiếu nại, điểm danh và chat trực tuyến.
- Quản trị tài khoản, cấu hình môi trường và quy trình build.
- Lỗ hổng thư viện bằng `npm audit`.

## Các lỗi quan trọng đã sửa

1. Xóa khóa AI khỏi file cấu hình mẫu và không đóng gói file `.env`.
2. Loại `node_modules` khỏi ZIP để tránh lỗi khác hệ điều hành và giảm dung lượng.
3. Nâng thư viện email, thêm HTTP security headers và rate limit cho API xác thực.
4. Kiểm tra email, mật khẩu, ID, ngày, giờ và độ dài nội dung ở backend.
5. Chặn đặt lịch trong quá khứ và chặn trùng lịch khi hai yêu cầu đến đồng thời.
6. Sửa lỗi múi giờ khi frontend tạo ngày mặc định.
7. Kiểm tra vai trò ở cả route giao diện và API.
8. Không trả ghi chú riêng của bác sĩ cho bệnh nhân.
9. Ngăn admin tự khóa tài khoản đang dùng.
10. Kiểm tra chuyên khoa trước khi tạo bác sĩ, tránh tài khoản bị tạo dở.
11. Kiểm tra ca làm việc trùng nhau.
12. Bổ sung sửa tài khoản trên giao diện admin và hiển thị hồ sơ khám.
13. Trả mã lỗi phù hợp, không gửi chi tiết lỗi database cho người dùng.
14. Dùng bộ sinh số an toàn cho mã khôi phục mật khẩu.
15. Thay thao tác “bác sĩ tự báo nghỉ” bằng đơn xin nghỉ có duyệt, lịch sử và minh chứng.
16. Bác sĩ có lịch làm việc 30 ngày và chỉ được điểm danh đúng ngày có ca.
17. Khi duyệt nghỉ có lịch khám, admin bắt buộc thay bác sĩ cùng chuyên khoa đủ ca trống hoặc hủy lịch.
18. Mọi lịch hủy được lưu riêng cùng người hủy, vai trò, lý do, trạng thái cũ và thời gian.
19. Thêm lịch sử thao tác cho đổi trạng thái, hủy lịch và thay bác sĩ.
20. Giới hạn minh chứng nghỉ khẩn cấp ở 5 MB và chỉ cho chủ đơn/admin/CSKH tải xuống.

## Kết quả xác minh

- Frontend build production: đạt.
- Kiểm tra cú pháp backend: đạt.
- Unit test backend: 6/6 đạt.
- `npm audit --omit=dev` backend: 0 lỗ hổng đã biết.
- `npm audit --omit=dev` frontend: 0 lỗ hổng đã biết.

## Việc cần làm trên máy trình bày

1. Cài Node.js 20+, npm và MySQL 8+.
2. Tạo `backend/.env` và `frontend/.env` từ các file `.env.example`.
3. Điền đúng `DB_PASSWORD` và một `JWT_SECRET` mới.
4. Chạy `npm install` trong cả `backend` và `frontend`.
5. Mở backend trước, sau đó mở frontend.
6. Kiểm thử tối thiểu một luồng cho từng vai trò trước khi bảo vệ đồ án.

## Giới hạn

- Chưa thể kiểm thử tích hợp với MySQL/Gmail/Gemini thật nếu chưa có dịch vụ và
  thông tin cấu hình tương ứng.
- Tư vấn AI chỉ là hỗ trợ sơ bộ; hệ thống thực tế cần quy trình pháp lý, bảo mật
  dữ liệu y tế, sao lưu, giám sát và đánh giá chuyên môn sâu hơn.
