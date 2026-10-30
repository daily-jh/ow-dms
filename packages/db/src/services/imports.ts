import { createHash } from 'node:crypto';
import {
  DomainError, interpretBankGrid, interpretMoneySheet, nameKey, parsePositiveWon, type Grid, type RowError,
} from '@owdms/domain';
import type { ActorContext } from '../pool';
import { assertActiveMaster, audit, requireAction, type Db } from './common';
import { createDonor, type DonorType } from './donors';
import { createMoneyReceiptDraft } from './money';
import type { PiiCipher } from './pii';

/**
 * 파일 반입. 원본 파일은 보관하지 않고(개인정보 최소화) 해시·해석 결과만 남긴다.
 * 통장 입금은 '후보'로만 쌓이고, 사람이 후원자·기금을 골라 초안을 만든 뒤 승인을 거쳐야 수입이 된다.
 */
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function accountLabel(v: string): string {
  const label = v.trim().replace(/\s+/g, ' ');
  if (!label || label.length > 40) throw new DomainError('VALIDATION_FAILED', '통장 이름은 1~40자입니다(예: 후원금 통장).', { accountLabel: '1~40자' });
  if (/\d{6,}/.test(label.replace(/-/g, ''))) {
    throw new DomainError('VALIDATION_FAILED', '통장 이름에 계좌번호를 넣지 마십시오(예: 후원금 통장).', { accountLabel: '계좌번호 금지' });
  }
  return label;
}

export async function importBankStatement(
  db: Db,
  ctx: ActorContext,
  input: { fileName: string; content: Buffer; grid: Grid; accountLabel: string },
) {
  requireAction(ctx, 'money.draft');
  const label = accountLabel(input.accountLabel);
  const parsed = interpretBankGrid(input.grid);
  // 같은 통장에서 이미 들어온 거래(같은 파일 재반입·기간이 겹친 파일)는 건너뛴다.
  const existing = await db.query<{ fingerprint: string }>(
    `select fingerprint from bank_transactions where account_label = $1 and fingerprint = any($2::text[])`,
    [label, parsed.rows.map((r) => r.fingerprint)],
  );
  const known = new Set(existing.rows.map((r) => r.fingerprint));
  const fresh = parsed.rows.filter((r) => !known.has(r.fingerprint));
  const batch = await db.query<{ id: string }>(
    `insert into import_batches (tenant_id, kind, account_label, file_name, file_sha256, total_rows, imported_rows, duplicate_rows, skipped_rows, created_by)
     values (app_tenant(), 'BANK_STATEMENT', $1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [label, input.fileName.slice(0, 200), sha256(input.content), parsed.rows.length, fresh.length, parsed.rows.length - fresh.length,
      parsed.withdrawals + parsed.errors.length, ctx.userId],
  );
  const batchId = batch.rows[0]!.id;
  for (const r of fresh) {
    await db.query(
      `insert into bank_transactions (tenant_id, batch_id, account_label, occurred_on, occurred_time, amount, balance, counterparty, memo, fingerprint, line_no)
       values (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [batchId, label, r.date, r.time, r.amount.toString(), r.balance?.toString() ?? null, r.counterparty, r.memo, r.fingerprint, r.line],
    );
  }
  await audit(db, ctx, {
    category: 'LEDGER', action: 'bank_statement.import', resourceType: 'import_batch', resourceId: batchId,
    reason: `입금 ${fresh.length}건 반입, 중복 ${parsed.rows.length - fresh.length}건`,
  });
  return { batchId, imported: fresh.length, duplicates: parsed.rows.length - fresh.length, withdrawals: parsed.withdrawals, errors: parsed.errors };
}

export type BankTxView = 'open' | 'excluded' | 'all';

export async function listBankTransactions(db: Db, ctx: ActorContext, q: { view?: BankTxView; limit?: number } = {}) {
  requireAction(ctx, 'money.read');
  const view = q.view ?? 'open';
  const where = view === 'excluded' ? `t.status = 'EXCLUDED'`
    : view === 'open' ? `t.status = 'OPEN' and coalesce(a.allocated, 0) < t.amount` : 'true';
  const r = await db.query(
    `select t.id, t.account_label, t.occurred_on, t.occurred_time, t.amount, t.counterparty, t.memo, t.status, t.exclude_reason,
            coalesce(a.allocated, 0) as allocated, coalesce(a.receipts, '[]'::json) as receipts
       from bank_transactions t
       left join lateral (
         select sum(x.amount) as allocated,
                json_agg(json_build_object('id', m.id, 'amount', x.amount::text, 'status', m.status, 'donorName', d.display_name) order by x.created_at) as receipts
           from bank_allocations x join money_receipts m on m.id = x.money_receipt_id left join donors d on d.id = m.donor_id
          where x.bank_transaction_id = t.id
       ) a on true
      where ${where}
      order by t.occurred_on desc, t.occurred_time desc nulls last, t.line_no
      limit $1`,
    [Math.min(Math.max(q.limit ?? 200, 1), 500)],
  );
  // 후원자 후보: 입금자명과 이름 키가 같은 후원자. 여러 명이면 모두 보여 주고 고르게 한다(자동 연결·병합 없음).
  const donors = r.rowCount && ctx.roles.length
    ? (await db.query<{ id: string; display_name: string; donor_type: string }>(`select id, display_name, donor_type from donors order by created_at`)).rows
    : [];
  const byKey = new Map<string, { id: string; displayName: string }[]>();
  for (const d of donors) {
    const k = nameKey(d.display_name);
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), { id: d.id, displayName: d.display_name }]);
  }
  return r.rows.map((t) => {
    const amount = BigInt(t.amount as string);
    const allocated = BigInt(t.allocated as string);
    const remaining = amount - allocated;
    return {
      id: t.id as string, accountLabel: t.account_label as string, occurredOn: t.occurred_on as string,
      occurredTime: (t.occurred_time ?? null) as string | null, amount: amount.toString(), allocated: allocated.toString(),
      remaining: remaining.toString(), counterparty: t.counterparty as string, memo: (t.memo ?? null) as string | null,
      status: t.status === 'EXCLUDED' ? 'EXCLUDED' : remaining === 0n ? 'MATCHED' : allocated > 0n ? 'PARTIAL' : 'OPEN',
      excludeReason: (t.exclude_reason ?? null) as string | null,
      receipts: t.receipts as { id: string; amount: string; status: string; donorName: string | null }[],
      donorCandidates: byKey.get(nameKey(t.counterparty as string)) ?? [],
    };
  });
}

async function lockOpenTransaction(db: Db, id: string) {
  const r = await db.query<{ amount: string; status: string; occurred_on: string; counterparty: string; account_label: string }>(
    `select amount, status, occurred_on, counterparty, account_label from bank_transactions where id = $1 for update`, [id],
  );
  const t = r.rows[0];
  if (!t) throw new DomainError('NOT_FOUND', '통장 거래를 찾을 수 없습니다.');
  const a = await db.query<{ s: string }>(`select coalesce(sum(amount), 0) as s from bank_allocations where bank_transaction_id = $1`, [id]);
  return { ...t, amount: BigInt(t.amount), allocated: BigInt(a.rows[0]!.s) };
}

/**
 * 입금 1건으로 후원금 수입 초안을 만든다. 금액을 나누면 같은 입금에서 여러 건(여러 후원자·기금)을 만들 수 있다.
 * 새 후원자 등록은 담당자가 명시적으로 고른 경우에만 한다.
 */
export async function createReceiptFromBank(
  db: Db,
  ctx: ActorContext,
  cipher: PiiCipher,
  txId: string,
  input: { facilityId: string; fundId: string; amount?: string | null; donorId?: string | null; newDonor?: { donorType: DonorType; displayName?: string | null } | null; memo?: string | null },
) {
  requireAction(ctx, 'money.draft');
  const t = await lockOpenTransaction(db, txId);
  if (t.status === 'EXCLUDED') throw new DomainError('INVALID_STATE_TRANSITION', '후원금 아님으로 표시된 입금입니다. 먼저 표시를 해제하십시오.');
  const remaining = t.amount - t.allocated;
  const amount = input.amount ? parsePositiveWon(input.amount) : remaining;
  if (amount > remaining) {
    throw new DomainError('ALLOCATION_EXCEEDS_REMAINING', `남은 입금액(${remaining.toString()}원)보다 크게 연결할 수 없습니다.`, { amount: `최대 ${remaining.toString()}원` });
  }
  if (input.donorId && input.newDonor) throw new DomainError('VALIDATION_FAILED', '기존 후원자와 새 후원자 중 하나만 고르십시오.');
  await assertActiveMaster(db, 'funds', [input.fundId]);
  let donorId = input.donorId ?? null;
  if (input.newDonor) {
    const name = (input.newDonor.displayName ?? t.counterparty).trim();
    donorId = (await createDonor(db, ctx, cipher, { donorType: input.newDonor.donorType, displayName: name, facilityId: input.facilityId })).id;
  }
  const receipt = await createMoneyReceiptDraft(db, ctx, {
    facilityId: input.facilityId, donorId, receivedOn: t.occurred_on, amount: amount.toString(), method: 'BANK_TRANSFER',
    memo: input.memo?.trim() || `통장 입금 연결(${t.account_label})`,
    fundLines: [{ fundId: input.fundId, amount: amount.toString() }],
  });
  await db.query(
    `insert into bank_allocations (tenant_id, bank_transaction_id, money_receipt_id, amount, created_by) values (app_tenant(), $1, $2, $3, $4)`,
    [txId, receipt.id, amount.toString(), ctx.userId],
  );
  await audit(db, ctx, { category: 'LEDGER', action: 'bank_allocation.create', resourceType: 'bank_transaction', resourceId: txId });
  return { receiptId: receipt.id, donorId, remaining: (remaining - amount).toString() };
}

/** 이자·보조금·내부 이체 등 후원금이 아닌 입금 표시. 이미 후원금으로 연결된 입금은 표시할 수 없다. */
export async function excludeBankTransaction(db: Db, ctx: ActorContext, txId: string, reason: string) {
  requireAction(ctx, 'money.draft');
  const why = reason.trim();
  if (!why || why.length > 200) throw new DomainError('VALIDATION_FAILED', '사유를 1~200자로 적어 주십시오.', { reason: '1~200자' });
  const t = await lockOpenTransaction(db, txId);
  if (t.allocated > 0n) throw new DomainError('INVALID_STATE_TRANSITION', '이미 후원금으로 연결된 입금입니다. 연결된 수입을 정정한 뒤 표시하십시오.');
  await db.query(
    `update bank_transactions set status = 'EXCLUDED', exclude_reason = $2, excluded_by = $3, excluded_at = now() where id = $1`,
    [txId, why, ctx.userId],
  );
  await audit(db, ctx, { category: 'LEDGER', action: 'bank_transaction.exclude', resourceType: 'bank_transaction', resourceId: txId, reason: why });
  return { id: txId, status: 'EXCLUDED' };
}

export async function reopenBankTransaction(db: Db, ctx: ActorContext, txId: string) {
  requireAction(ctx, 'money.draft');
  await lockOpenTransaction(db, txId);
  await db.query(`update bank_transactions set status = 'OPEN', exclude_reason = null, excluded_by = null, excluded_at = null where id = $1`, [txId]);
  await audit(db, ctx, { category: 'LEDGER', action: 'bank_transaction.reopen', resourceType: 'bank_transaction', resourceId: txId });
  return { id: txId, status: 'OPEN' };
}

/**
 * 후원금 입력 양식 반입: 모든 행이 올바를 때만 한꺼번에 초안을 만든다(일부만 들어가 중복·누락이 생기지 않게).
 * 후원자는 이름이 정확히 같은 1명일 때만 연결하고, 없거나 동명이인이면 오류로 돌려준다.
 */
export async function importMoneySheet(
  db: Db,
  ctx: ActorContext,
  input: { fileName: string; content: Buffer; grid: Grid; facilityId: string },
): Promise<{ created: number; errors: RowError[]; batchId: string | null }> {
  requireAction(ctx, 'money.draft');
  const hash = sha256(input.content);
  const dup = await db.query(`select created_at from import_batches where kind = 'MONEY_SHEET' and file_sha256 = $1`, [hash]);
  if (dup.rowCount) throw new DomainError('DUPLICATE_IMPORT', '이미 반입한 파일입니다. 같은 초안이 두 번 만들어지지 않도록 막았습니다.');
  const parsed = interpretMoneySheet(input.grid);
  const errors: RowError[] = [...parsed.errors];
  const donors = (await db.query<{ id: string; display_name: string; external_ref: string | null }>(
    `select id, display_name, external_ref from donors`,
  )).rows;
  const funds = (await db.query<{ id: string; name: string }>(`select id, name from funds where active`)).rows;
  const plans: { line: number; donorId: string | null; fundId: string; row: (typeof parsed.rows)[number] }[] = [];
  for (const row of parsed.rows) {
    const problems: string[] = [];
    let donorId: string | null = null;
    if (row.donorRef) {
      const m = donors.filter((d) => d.external_ref === row.donorRef);
      if (m.length !== 1) problems.push(`후원자번호 ${row.donorRef}에 맞는 후원자가 없습니다`);
      else donorId = m[0]!.id;
    } else if (row.donorName) {
      const m = donors.filter((d) => d.display_name.trim() === row.donorName);
      if (m.length === 0) problems.push(`후원자 "${row.donorName}"가 등록되어 있지 않습니다(먼저 등록하거나 비워 두면 익명/미확인)`);
      else if (m.length > 1) problems.push(`"${row.donorName}" 이름의 후원자가 ${m.length}명입니다(후원자번호 열로 구분)`);
      else donorId = m[0]!.id;
    }
    const fund = funds.find((f) => f.name.trim().toLowerCase() === row.fundName.trim().toLowerCase());
    if (!fund) problems.push(`기금 "${row.fundName}"이 없거나 사용 중지되었습니다`);
    if (problems.length) errors.push({ line: row.line, message: problems.join(' / ') });
    else plans.push({ line: row.line, donorId, fundId: fund!.id, row });
  }
  if (errors.length || plans.length === 0) {
    if (!errors.length) errors.push({ line: 0, message: '반입할 행이 없습니다.' });
    return { created: 0, errors: errors.sort((a, b) => a.line - b.line), batchId: null };
  }
  const batch = await db.query<{ id: string }>(
    `insert into import_batches (tenant_id, kind, file_name, file_sha256, total_rows, imported_rows, duplicate_rows, skipped_rows, created_by)
     values (app_tenant(), 'MONEY_SHEET', $1, $2, $3, $3, 0, 0, $4) returning id`,
    [input.fileName.slice(0, 200), hash, plans.length, ctx.userId],
  );
  for (const p of plans) {
    await createMoneyReceiptDraft(db, ctx, {
      facilityId: input.facilityId, donorId: p.donorId, receivedOn: p.row.receivedOn, amount: p.row.amount.toString(), method: p.row.method,
      memo: p.row.memo, fundLines: [{ fundId: p.fundId, amount: p.row.amount.toString() }],
    });
  }
  await audit(db, ctx, { category: 'LEDGER', action: 'money_sheet.import', resourceType: 'import_batch', resourceId: batch.rows[0]!.id, reason: `초안 ${plans.length}건` });
  return { created: plans.length, errors: [], batchId: batch.rows[0]!.id };
}

export async function listImportBatches(db: Db, ctx: ActorContext) {
  requireAction(ctx, 'money.read');
  const r = await db.query(
    `select b.id, b.kind, b.account_label, b.file_name, b.total_rows, b.imported_rows, b.duplicate_rows, b.skipped_rows, b.created_at, u.display_name as created_by
       from import_batches b left join users u on u.id = b.created_by order by b.created_at desc limit 20`,
  );
  return r.rows.map((b) => ({
    id: b.id as string, kind: b.kind as string, accountLabel: (b.account_label ?? null) as string | null, fileName: b.file_name as string,
    totalRows: b.total_rows as number, importedRows: b.imported_rows as number, duplicateRows: b.duplicate_rows as number,
    skippedRows: b.skipped_rows as number, createdAt: (b.created_at as Date).toISOString(), createdBy: (b.created_by ?? '') as string,
  }));
}
