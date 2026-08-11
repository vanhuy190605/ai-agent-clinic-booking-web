const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cleanText,
  normalizeEmail,
  isEmail,
  isStrongEnoughPassword,
  isValidDate,
  isValidTime,
  normalizeTime,
  positiveId
} = require('../src/validation');

const {
  generateSlots
} = require('../src/appointmentService');

const {
  parseDate,
  parseTime
} = require('../src/aiAgent');

const {
  daysBetween,
  enumerateDates,
  validateLeaveRequestInput
} = require('../src/leavePolicy');

test(
  'normalizes and validates user input',
  () => {
    assert.equal(
      normalizeEmail(
        '  USER@Example.COM '
      ),
      'user@example.com'
    );

    assert.equal(
      isEmail('user@example.com'),
      true
    );

    assert.equal(
      isEmail('not-an-email'),
      false
    );

    assert.equal(
      isStrongEnoughPassword('12345678'),
      true
    );

    assert.equal(
      isStrongEnoughPassword('1234567'),
      false
    );

    assert.equal(
      cleanText('  hello  ', 20),
      'hello'
    );

    assert.equal(
      positiveId('12'),
      12
    );

    assert.equal(
      positiveId('-1'),
      null
    );
  }
);

test(
  'validates calendar dates and times',
  () => {
    assert.equal(
      isValidDate('2026-02-28'),
      true
    );

    assert.equal(
      isValidDate('2026-02-30'),
      false
    );

    assert.equal(
      isValidTime('08:30'),
      true
    );

    assert.equal(
      isValidTime('25:00'),
      false
    );

    assert.equal(
      normalizeTime('8:30:00'),
      '08:30'
    );
  }
);

test(
  'creates 30-minute appointment slots',
  () => {
    assert.deepEqual(
      generateSlots(
        '08:00',
        '09:30'
      ),
      [
        '08:00',
        '08:30',
        '09:00'
      ]
    );
  }
);

test(
  'AI understands common Vietnamese date and time formats',
  () => {
    assert.equal(
      parseDate(
        'Đặt ngày 31/12/2026'
      ),
      '2026-12-31'
    );

    assert.equal(
      parseDate(
        'Đặt ngày 31/02/2026'
      ),
      null
    );

    assert.equal(
      parseTime(
        'lúc 8h30 sáng'
      ),
      '08:30'
    );

    assert.equal(
      parseTime(
        'lúc 3 giờ chiều'
      ),
      '15:00'
    );

    assert.equal(
      parseTime(
        'lúc 25:00'
      ),
      null
    );
  }
);

test(
  'validates planned and emergency leave policy',
  () => {
    const planned =
      validateLeaveRequestInput(
        {
          start_date:
            '2026-08-04',

          end_date:
            '2026-08-05',

          leave_type:
            'planned',

          reason:
            'Nghỉ phép gia đình'
        },
        {
          today:
            '2026-08-01',

          plannedNoticeDays: 3
        }
      );

    assert.equal(
      planned.ok,
      true
    );

    const tooLate =
      validateLeaveRequestInput(
        {
          start_date:
            '2026-08-02',

          end_date:
            '2026-08-02',

          leave_type:
            'planned',

          reason:
            'Nghỉ phép gia đình'
        },
        {
          today:
            '2026-08-01',

          plannedNoticeDays: 3
        }
      );

    assert.equal(
      tooLate.ok,
      false
    );

    const emergency =
      validateLeaveRequestInput(
        {
          start_date:
            '2026-08-01',

          end_date:
            '2026-08-01',

          leave_type:
            'emergency',

          reason:
            'Cấp cứu đột xuất'
        },
        {
          today:
            '2026-08-01',

          plannedNoticeDays: 3
        }
      );

    assert.equal(
      emergency.ok,
      true
    );

    const futureEmergency =
      validateLeaveRequestInput(
        {
          start_date:
            '2026-08-02',

          end_date:
            '2026-08-02',

          leave_type:
            'emergency',

          reason:
            'Cấp cứu đột xuất'
        },
        {
          today:
            '2026-08-01',

          plannedNoticeDays: 3
        }
      );

    assert.equal(
      futureEmergency.ok,
      false
    );
  }
);

test(
  'enumerates leave dates without timezone drift',
  () => {
    assert.equal(
      daysBetween(
        '2026-08-01',
        '2026-08-03'
      ),
      2
    );

    assert.deepEqual(
      enumerateDates(
        '2026-08-01',
        '2026-08-03'
      ),
      [
        '2026-08-01',
        '2026-08-02',
        '2026-08-03'
      ]
    );
  }
);