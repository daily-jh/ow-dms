'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, api } from './api';

export type ImportState =
  | null
  | { kind: 'bank'; imported: number; duplicates: number; withdrawals: number; errors: { line: number; message: string }[] }
  | { kind: 'sheet'; created: number; errors: { line: number; message: string }[] }
  | { error: string };

const MAX_BYTES = 5 * 1024 * 1024;

/** 파일은 이 서버(웹)에서 API로만 넘기고, 다른 곳으로 보내지 않는다. 원본은 API도 저장하지 않는다. */
export async function uploadImport(_prev: ImportState, form: FormData): Promise<ImportState> {
  const file = form.get('file');
  const kind = form.get('kind') === 'sheet' ? 'sheet' : 'bank';
  if (!(file instanceof File) || file.size === 0) return { error: '파일을 고르십시오.' };
  if (file.size > MAX_BYTES) return { error: '파일은 5MB 이하만 올릴 수 있습니다. 기간을 나눠 내려받으십시오.' };
  const contentBase64 = Buffer.from(await file.arrayBuffer()).toString('base64');
  try {
    if (kind === 'bank') {
      const r = await api<{ imported: number; duplicates: number; withdrawals: number; errors: { line: number; message: string }[] }>(
        '/v1/imports/bank-statement',
        { method: 'POST', body: { fileName: file.name, contentBase64, accountLabel: String(form.get('accountLabel') ?? '') } },
      );
      revalidatePath('/money/import');
      return { kind: 'bank', ...r };
    }
    const r = await api<{ created: number; errors: { line: number; message: string }[] }>(
      '/v1/imports/money-sheet',
      { method: 'POST', body: { fileName: file.name, contentBase64, facilityId: String(form.get('facilityId') ?? '') } },
    );
    revalidatePath('/money');
    return { kind: 'sheet', ...r };
  } catch (e) {
    if (e instanceof ApiError) return { error: e.body.safeMessage };
    throw e;
  }
}
