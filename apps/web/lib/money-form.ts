/** 화면·서버 액션에서 쓰는 후원금 입력 검사. 금액은 정수 문자열/BigInt만 사용한다. */
export interface MoneyFormState { error?: string; fieldErrors?: Record<string, string> }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const value = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const money = (form: FormData, key: string) => value(form, key).replaceAll(',', '');
const positive = (s: string) => /^\d{1,15}$/.test(s) && BigInt(s) > 0n;

export function moneyFormInput(form: FormData) {
  const errors: Record<string, string> = {};
  const facilityId = value(form, 'facilityId');
  const amount = money(form, 'amount');
  if (!uuid.test(facilityId)) errors.facilityId = '시설을 선택해 주세요. 목록이 없으면 기관관리자가 기준정보에서 시설을 등록해야 합니다.';
  if (!positive(amount)) errors.amount = '수납액은 0보다 큰 원 단위 정수로 입력해 주세요.';
  const fundLines: { fundId: string; amount: string }[] = [];
  for (const i of [0, 1]) {
    const fundId = value(form, `fundId${i}`);
    const lineAmount = money(form, `fundAmount${i}`);
    if (!fundId && !lineAmount && i === 1) continue;
    if (!uuid.test(fundId)) errors[`fundId${i}`] = `기금 ${i + 1}을 선택해 주세요.`;
    if (!positive(lineAmount)) errors[`fundAmount${i}`] = '배분액은 0보다 큰 원 단위 정수로 입력해 주세요.';
    fundLines.push({ fundId, amount: lineAmount });
  }
  if (fundLines.length === 2 && fundLines[0]!.fundId && fundLines[0]!.fundId === fundLines[1]!.fundId) {
    errors.fundId1 = '같은 기금은 나누지 말고 한 줄에 합쳐 입력해 주세요.';
  }
  if (positive(amount) && fundLines.every((l) => positive(l.amount)) && fundLines.reduce((sum, l) => sum + BigInt(l.amount), 0n) !== BigInt(amount)) {
    errors.fundLines = '기금 배분액의 합계가 수납액과 같아야 합니다.';
  }
  const [pledgeId, pledgeDonor] = value(form, 'pledge').split('|');
  return {
    errors,
    input: {
      facilityId, amount, fundLines,
      sourceChannel: value(form, 'sourceChannel') || 'OTHER', projectName: value(form, 'projectName') || null, evidenceRef: value(form, 'evidenceRef') || null,
      donorId: value(form, 'donorId') || pledgeDonor || null,
      receivedOn: value(form, 'receivedOn'), method: value(form, 'method'), memo: value(form, 'memo') || null,
      pledgeId: pledgeId || null, pledgeMonth: pledgeId ? value(form, 'pledgeMonth') || null : null,
    },
  };
}
