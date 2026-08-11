# Kịch bản test chấm công, xin nghỉ và lịch đã hủy

Mật khẩu chung cho tài khoản demo: `123456789`.

## 1. Test điểm danh

1. Đăng nhập bác sĩ `noitongquat@gmail.com`.
2. Mở **Chấm công & xin nghỉ**.
3. Kiểm tra bảng 30 ngày có ca làm, số lịch khám và trạng thái.
4. Bấm **Điểm danh đi làm**.
5. Kết quả đúng: hôm nay chuyển sang **Đã điểm danh** và có giờ điểm danh.

## 2. Test xin nghỉ và thay bác sĩ

1. Chọn một ngày cách hôm nay ít nhất 3 ngày.
2. Đăng nhập bệnh nhân `patient@gmail.com`, đặt lịch Nội tổng quát với
   `BS. Phạm Anh Tuấn` vào ngày đã chọn.
3. Đăng nhập bác sĩ `noitongquat@gmail.com`, gửi đơn nghỉ có kế hoạch đúng ngày đó.
4. Đăng nhập admin `admin@gmail.com`, mở **Điều phối bác sĩ** → **Đơn xin nghỉ** → **Xử lý**.
5. Chọn `BS. Đỗ Minh Khoa`, sau đó bấm **Duyệt + thay bác sĩ**.
6. Kết quả đúng:
   - Đơn nghỉ chuyển sang **Đã duyệt**.
   - Lịch bệnh nhân chuyển sang `BS. Đỗ Minh Khoa`.
   - Bệnh nhân, bác sĩ cũ và bác sĩ thay thế đều nhận thông báo.
   - Bác sĩ cũ không còn khung giờ đặt lịch trong ngày nghỉ.

## 3. Test duyệt nghỉ và hủy lịch

1. Lặp lại việc đặt lịch và xin nghỉ ở một ngày khác.
2. Admin mở đơn và bấm **Duyệt + hủy lịch**.
3. Kết quả đúng:
   - Lịch không còn ở **Lịch hẹn đang hoạt động**.
   - Lịch xuất hiện ở **Kho lịch đã hủy**.
   - Kho lưu người hủy, lý do và thời điểm hủy.
   - Bệnh nhân nhận thông báo đặt lịch khác.

## 4. Test bệnh nhân hoặc bác sĩ tự hủy

1. Mở một lịch chưa khám.
2. Nhập lý do ít nhất 5 ký tự rồi bấm **Hủy lịch**.
3. Kết quả đúng: lịch được lưu tại **Kho lịch đã hủy**, không bị xóa.

## 5. Test nghỉ khẩn cấp

1. Bác sĩ chọn **Nghỉ khẩn cấp** và ngày hôm nay.
2. Thử gửi không có tệp: hệ thống phải từ chối.
3. Đính kèm JPG, PNG, WEBP hoặc PDF hợp lệ dưới 5 MB rồi gửi lại.
4. Admin phải xem được minh chứng trước khi duyệt.

## 6. Các trường hợp phải bị chặn

- Điểm danh cho ngày khác hôm nay.
- Điểm danh ngày không có ca hoặc ngày nghỉ đã duyệt.
- Nghỉ có kế hoạch nhưng gửi trước ít hơn số ngày cấu hình.
- Đơn nghỉ khẩn cấp không có minh chứng.
- Duyệt nghỉ đã có bệnh nhân mà không chọn thay bác sĩ hoặc hủy lịch.
- Chọn bác sĩ khác chuyên khoa, đang nghỉ, không có ca hoặc trùng giờ.
- Hủy lịch đã khám.
- Xem minh chứng bằng tài khoản bệnh nhân.
