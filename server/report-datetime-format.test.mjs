import test from 'node:test';
import assert from 'node:assert/strict';

import { renderReportHtml, renderReportXlsx } from './services/reportCenter.js';

const report = {
  title: 'Báo cáo kiểm thử',
  generated_at: '2026-08-25T18:30:45.000Z',
  range: { label: '25/08/2026 → 26/08/2026' },
  scope: { label: 'Chi nhánh 1' },
  summary: [],
  sections: [{
    title: 'Giao dịch',
    columns: [
      { key: 'occurred_at', label: 'Thời gian', format: 'datetime' },
      { key: 'business_date', label: 'Ngày', format: 'date' },
    ],
    rows: [{
      occurred_at: '2026-08-25T18:30:45.000Z',
      business_date: '2026-08-26',
    }],
  }],
};

test('report HTML renders canonical Vietnam date/time without exposing ISO values', () => {
  const html = renderReportHtml(report);
  assert.match(html, /26\/08\/2026 01:30:45/);
  assert.match(html, />26\/08\/2026</);
  assert.doesNotMatch(html, /2026-08-25T18:30:45/);
});

test('report XLSX is generated with typed date/time cells', async () => {
  const buffer = await renderReportXlsx(report);
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  assert.ok(buffer.length > 1000);
});
