/** 후원금 입력 양식(CSV). 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 붙인다. 예시 행은 합성 자료다. */
export function GET() {
  const rows = [
    ['수납일', '후원자', '후원자번호', '금액', '수납방법', '기금', '메모'],
    ['2026-10-01', '홍길동(예시)', '', '30000', '계좌이체', '비지정후원금', '예시 행: 지우고 입력하십시오'],
    ['2026-10-02', '', '', '5000', '현금', '비지정후원금', '후원자를 비우면 익명/미확인'],
  ];
  const csv = '﻿' + rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n') + '\r\n';
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="money-sheet-template.csv"; filename*=UTF-8''${encodeURIComponent('후원금_입력양식.csv')}`,
    },
  });
}
