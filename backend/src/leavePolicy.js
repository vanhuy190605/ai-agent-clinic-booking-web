const {
  cleanText,
  isValidDate
} = require('./validation');

function utcDay(dateString) {
  const [year, month, day] =
    dateString
      .split('-')
      .map(Number);

  return Date.UTC(
    year,
    month - 1,
    day
  );
}

function daysBetween(
  fromDate,
  toDate
) {
  return Math.round(
    (
      utcDay(toDate) -
      utcDay(fromDate)
    ) / 86400000
  );
}

function enumerateDates(
  startDate,
  endDate
) {
  const dates = [];
  const end = utcDay(endDate);

  for (
    let cursor = utcDay(startDate);
    cursor <= end;
    cursor += 86400000
  ) {
    dates.push(
      new Date(cursor)
        .toISOString()
        .slice(0, 10)
    );
  }

  return dates;
}

function validateLeaveRequestInput(
  input,
  {
    today,
    plannedNoticeDays = 3
  }
) {
  const startDate = String(
    input.start_date || ''
  );

  const endDate = String(
    input.end_date || ''
  );

  const leaveType = String(
    input.leave_type || ''
  );

  const reason = cleanText(
    input.reason,
    2000
  );

  if (
    !isValidDate(startDate) ||
    !isValidDate(endDate) ||
    endDate < startDate
  ) {
    return {
      ok: false,
      message:
        'Khoảng ngày nghỉ không hợp lệ'
    };
  }

  if (startDate < today) {
    return {
      ok: false,
      message:
        'Không thể gửi đơn nghỉ cho ngày đã qua'
    };
  }

  if (
    ![
      'planned',
      'emergency'
    ].includes(leaveType)
  ) {
    return {
      ok: false,
      message:
        'Loại nghỉ không hợp lệ'
    };
  }

  if (reason.length < 10) {
    return {
      ok: false,
      message:
        'Lý do nghỉ phải có ít nhất 10 ký tự'
    };
  }

  if (
    daysBetween(
      startDate,
      endDate
    ) > 29
  ) {
    return {
      ok: false,
      message:
        'Mỗi đơn chỉ được đăng ký tối đa 30 ngày'
    };
  }

  if (
    leaveType === 'planned' &&
    daysBetween(
      today,
      startDate
    ) < plannedNoticeDays
  ) {
    return {
      ok: false,
      message:
        `Nghỉ có kế hoạch phải gửi trước ít nhất ${plannedNoticeDays} ngày`
    };
  }

  // Nghỉ khẩn cấp chỉ được bắt đầu từ hôm nay.
  // Nếu nghỉ vào ngày tương lai thì phải dùng
  // loại nghỉ có kế hoạch.
  if (
    leaveType === 'emergency' &&
    startDate !== today
  ) {
    return {
      ok: false,
      message:
        'Nghỉ khẩn cấp phải bắt đầu từ hôm nay. Ngày tương lai hãy chọn nghỉ có kế hoạch'
    };
  }

  return {
    ok: true,
    value: {
      start_date: startDate,
      end_date: endDate,
      leave_type: leaveType,
      reason
    }
  };
}

// Xác định đơn nghỉ có khóa lịch khám hay không.
function isOperationalLeave(
  {
    leave_type: leaveType,
    status
  } = {}
) {
  return (
    status === 'approved' ||
    (
      leaveType === 'emergency' &&
      [
        'pending',
        'rejected'
      ].includes(status)
    )
  );
}

module.exports = {
  daysBetween,
  enumerateDates,
  isOperationalLeave,
  validateLeaveRequestInput
};