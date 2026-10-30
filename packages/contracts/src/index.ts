import { z } from 'zod';

/** 자체 API 요청 스키마. 희망이음 규격이 아니다. 금액·수량은 문자열로 주고받는다. */
const uuid = z.uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const won = z.string().regex(/^\d{1,15}$/, '원 단위 정수 문자열');
const qty = z.string().regex(/^\d{1,12}(\.\d{1,3})?$/, '소수 3자리 이내 수량 문자열');

export const DevLoginRequest = z.object({ username: z.string().min(1).max(64), tenantCode: z.string().max(32).optional() });

// ───────────── 실제 로그인·계정 ─────────────
export const PasswordLoginRequest = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(256) });
export const TotpLoginRequest = z.object({ mfaToken: z.string().min(1).max(1024), code: z.string().trim().min(6).max(8) });
export const ChangePasswordRequest = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(1).max(256) });
export const TotpEnableRequest = z.object({ code: z.string().trim().min(6).max(8) });
const Username = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,31}$/, '영문 소문자·숫자·._- 3~32자');
const RoleList = z.array(z.string().max(32)).min(1).max(8);
export const CreateUserRequest = z.object({ username: Username, displayName: z.string().trim().min(1).max(40), roles: RoleList });
export const ResetPasswordRequest = z.object({ resetMfa: z.boolean().default(false) });
export const SetMembershipRequest = z.object({ roles: RoleList, revoke: z.boolean().default(false) });

export const CreateDonorRequest = z.object({
  donorType: z.enum(['INDIVIDUAL', 'CORPORATION', 'GROUP', 'ANONYMOUS']),
  displayName: z.string().trim().min(1).max(100),
  facilityId: uuid.nullish(),
  contact: z.object({ phone: z.string().max(30).optional(), email: z.string().max(200).optional(), address: z.string().max(300).optional() }).optional(),
});

export const CreateGoodsReceiptRequest = z.object({
  facilityId: uuid,
  donorId: uuid.nullish(),
  receivedOn: date,
  memo: z.string().max(500).nullish(),
  lines: z.array(z.object({
    itemId: uuid,
    warehouseId: uuid,
    quantity: qty,
    unit: z.string().min(1).max(20),
    unitConversion: z.object({ unit: z.string(), baseUnit: z.string(), factor: qty }).nullish(),
    expiresOn: date.nullish(),
    unitValue: won.nullish(),
    valuationBasis: z.string().max(300).nullish(),
  })).min(1).max(200),
});

export const CreateMoneyReceiptRequest = z.object({
  facilityId: uuid,
  donorId: uuid.nullish(),
  receivedOn: date,
  amount: won,
  method: z.enum(['BANK_TRANSFER', 'CASH', 'CMS', 'CARD', 'OTHER']),
  memo: z.string().max(500).nullish(),
  fundLines: z.array(z.object({ fundId: uuid, amount: won })).min(1).max(50),
});

export const CreateDistributionRequest = z.object({
  facilityId: uuid,
  programName: z.string().trim().min(1).max(100),
  recipientRef: z.string().regex(/^[A-Za-z0-9-]{1,40}$/).nullish(),
  plannedOn: date,
  lines: z.array(z.object({ lotId: uuid, warehouseId: uuid, quantity: qty })).min(1).max(100),
});

export const RequestApprovalRequest = z.object({
  targetType: z.enum(['GOODS_RECEIPT', 'MONEY_RECEIPT', 'DISTRIBUTION']),
  targetId: uuid,
});

export const DecideApprovalRequest = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().max(500).nullish(),
});

export const GenerateDocumentRequest = z.object({
  documentType: z.enum(['GOODS_RECEIPT_CERT', 'DISTRIBUTION_LIST', 'MONEY_RECEIPT_NOTE']),
  sourceId: uuid,
});

export const CreateIntegrationBatchRequest = z.object({
  operation: z.enum(['goodsReceipt']),
  sourceIds: z.array(uuid).min(1).max(500),
});

/** 커넥터 계약(우리 시스템 내부 설계; 공식 규격 아님) — 명세서 7.3 */
export type Operation = 'donor' | 'moneyReceipt' | 'goodsReceipt' | 'goodsUse' | 'report';
export type ConnectorMode = 'reference' | 'officialFile' | 'approvedModule' | 'officialApi';

export interface Capability {
  operation: Operation;
  mode: ConnectorMode;
  enabled: boolean;
  specVersion?: string;
  verifiedEvidenceId?: string;
  label: string;
}

export interface ApiError {
  code: string;
  safeMessage: string;
  fieldErrors: Record<string, string>;
  requestId: string;
}

export const RequestCorrectionRequest = z.object({
  targetType: z.enum(['GOODS_RECEIPT', 'MONEY_RECEIPT', 'DISTRIBUTION']),
  targetId: uuid,
  reason: z.string().trim().min(1).max(500),
  businessDate: date,
  inspectionConfirmed: z.boolean().optional(),
});

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');
export const ClosePeriodRequest = z.object({ period });
export const ReopenPeriodRequest = z.object({ reason: z.string().trim().min(1).max(500) });
export const PeriodParam = period;

// ───────────── 기준정보 ─────────────
const MasterName = z.string().trim().min(1).max(80);
export const CreateLegalEntityRequest = z.object({ name: MasterName, kind: z.enum(['CORPORATION', 'FACILITY']) });
export const CreateFacilityRequest = z.object({ name: MasterName, legalEntityId: z.uuid() });
export const CreateWarehouseRequest = z.object({ name: MasterName, facilityId: z.uuid() });
export const CreateItemRequest = z.object({ name: MasterName, baseUnit: z.string().trim().min(1).max(10), perishable: z.boolean().default(false) });
export const CreateFundRequest = z.object({ name: MasterName, designated: z.boolean(), purpose: z.string().trim().max(200).nullish() });
export const UpdateMasterRequest = z.object({ name: MasterName.optional(), active: z.boolean().optional(), purpose: z.string().trim().max(200).nullish() });
export const MasterKindParam = z.enum(['legal-entities', 'facilities', 'warehouses', 'items', 'funds']);
