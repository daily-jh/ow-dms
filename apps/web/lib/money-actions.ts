'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, ApiError } from './api';
import { moneyFormInput, type MoneyFormState } from './money-form';

export async function saveMoneyReceipt(_state: MoneyFormState, form: FormData): Promise<MoneyFormState> {
  const { input, errors } = moneyFormInput(form);
  if (Object.keys(errors).length) return { error: '입력 내용을 확인해 주세요.', fieldErrors: errors };
  try {
    await api('/v1/money-receipts/record', {
      method: 'POST', body: input, idempotencyKey: String(form.get('idempotencyKey') ?? ''),
    });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    // API 스키마의 기술적 오류 원문은 화면에 그대로 출력하지 않는다. 입력 DOM은 유지한다.
    return { error: e.body.code === 'VALIDATION_FAILED' ? '필수 항목과 입력 형식을 확인해 주세요.' : e.body.safeMessage };
  }
  revalidatePath('/', 'layout');
  redirect('/money?ok=' + encodeURIComponent('후원금을 저장·확정했습니다. 실적에 반영되었습니다.'));
}
