import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { interpretBankGrid } from '@owdms/domain';
import { decodeText, readCsv, readGrid, readHtmlTable } from '../src/spreadsheet';

// 합성 자료만 사용한다.
describe('반입 파일 읽기', () => {
  it('xlsx: 날짜·숫자 칸을 문자열로 읽어 거래내역으로 해석된다', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('거래내역');
    ws.addRow(['가상은행 거래내역']);
    ws.addRow(['거래일시', '적요', '기재내용', '찾으신금액', '맡기신금액', '거래후잔액']);
    ws.addRow([new Date(Date.UTC(2026, 9, 1, 9, 12, 0)), '타행이체', '홍길동(가상)', 0, 50000, 1050000]);
    ws.addRow([new Date(Date.UTC(2026, 9, 2)), '이자', '결산이자', 0, 120, 1050120]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const grid = await readGrid('내역.xlsx', buf);
    expect(grid[2]).toEqual(['2026-10-01 09:12:00', '타행이체', '홍길동(가상)', '0', '50000', '1050000']);
    expect(interpretBankGrid(grid).rows.map((r) => [r.date, r.amount])).toEqual([['2026-10-01', 50000n], ['2026-10-02', 120n]]);
  });

  it('EUC-KR CSV와 UTF-8 BOM CSV를 모두 읽는다', () => {
    const csv = '거래일자,입금액,입금자명\r\n2026-10-05,"30,000",가상기업\r\n';
    const euc = Buffer.from(new Uint8Array([...'거래일자'].length ? [] : []));
    expect(euc.length).toBe(0);
    const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, 'utf8')]);
    expect(readCsv(decodeText(utf8Bom))[1]).toEqual(['2026-10-05', '30,000', '가상기업']);
    // "가" = EUC-KR B0 A1
    expect(decodeText(Buffer.from([0xb0, 0xa1]))).toBe('가');
  });

  it('은행이 .xls 이름으로 주는 HTML 표를 글자만 뽑아 읽는다', async () => {
    const html = '<html><body><table><tr><th>거래일시</th><th>입금액</th><th>입금자명</th></tr>' +
      '<tr><td>2026.10.06 10:00</td><td>1,000</td><td>A&amp;B <b>가상</b><script>x()</script></td></tr></table></body></html>';
    const grid = await readGrid('내역.xls', Buffer.from(html, 'utf8'));
    expect(grid[1]).toEqual(['2026.10.06 10:00', '1,000', 'A&B 가상x()']);
    expect(readHtmlTable('<table></table>')).toEqual([]);
  });

  it('옛 엑셀(.xls 이진)과 빈 파일은 안내와 함께 거부한다', async () => {
    await expect(readGrid('a.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]))).rejects.toThrow(/xlsx/);
    await expect(readGrid('a.csv', Buffer.alloc(0))).rejects.toThrow(/빈 파일/);
  });

  it('따옴표 안 쉼표·줄바꿈과 탭 구분 CSV', () => {
    expect(readCsv('a,"b,c","d\ne"\n1,2,3')).toEqual([['a', 'b,c', 'd\ne'], ['1', '2', '3']]);
    expect(readCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});
