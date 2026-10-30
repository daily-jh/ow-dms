import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, Header } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CreateDistributionRequest, CreateDonorRequest, CreateGoodsReceiptRequest, CreateIntegrationBatchRequest, CreateMoneyReceiptRequest,
  ClosePeriodRequest, DecideApprovalRequest, GenerateDocumentRequest, PeriodParam, ReopenPeriodRequest, RequestApprovalRequest,
  RequestCorrectionRequest, CreateLegalEntityRequest, CreateFacilityRequest, CreateWarehouseRequest, CreateItemRequest, CreateFundRequest,
  UpdateMasterRequest, MasterKindParam, ImportBankStatementRequest, ImportMoneySheetRequest, BankReceiptRequest,
  ExcludeBankTransactionRequest, CreatePledgeRequest, EndPledgeRequest,
} from '@owdms/contracts';
import {
  capabilities, createDistributionDraft, createDonor, createGoodsReceiptBatch, createGoodsReceiptDraft,
  createMoneyReceiptDraft, decideApproval, exportGoodsReceiptBatch, generateDocument, getGoodsReceipt, getLedger,
  listApprovals, listBatches, listDistributions, listDocuments, listDonors, listGoodsReceipts, listMoneyReceipts, listStock,
  postDistribution, renderStoredDocument, requestApproval, submitBatch, todayDashboard, requestCorrection, listCorrections,
  periodChecklist, closePeriod, reopenPeriod, listAuditEvents, listMasterData, createLegalEntity, createFacility, createWarehouse,
  createItem, createFund, updateMaster, importBankStatement, importMoneySheet, listBankTransactions, listImportBatches,
  createReceiptFromBank, excludeBankTransaction, reopenBankTransaction, type BankTxView,
  createPledge, endPledge, listPledges, type PledgeView,
} from '@owdms/db';
import { DomainError } from '@owdms/domain';
import { z } from 'zod';
import { RUNTIME, Runtime } from './runtime';
import { readGrid } from './spreadsheet';

const Uuid = z.uuid();
export const id = (v: string) => {
  const r = Uuid.safeParse(v);
  if (!r.success) throw new DomainError('NOT_FOUND', '대상을 찾을 수 없습니다.');
  return r.data;
};

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

@Controller('v1')
export class LedgerController {
  constructor(@Inject(RUNTIME) private readonly rt: Runtime) {}

  @Get('dashboard')
  dashboard(@Req() req: Request) {
    return this.rt.tx(req, (db, ctx) => todayDashboard(db, ctx, seoulToday()));
  }

  @Get('reference-data')
  referenceData(@Req() req: Request) {
    return this.rt.tx(req, async (db) => {
      // 한 연결(트랜잭션)에서는 순차 실행한다
      // 새 거래 입력용: 사용 중인 기준정보만
      const facilities = await db.query('select id, name from facilities where active order by name');
      const warehouses = await db.query('select id, facility_id as "facilityId", name from warehouses where active order by name');
      const items = await db.query('select id, name, base_unit as "baseUnit", perishable from items where active order by name');
      const funds = await db.query('select id, name, designated from funds where active order by designated, name');
      return { facilities: facilities.rows, warehouses: warehouses.rows, items: items.rows, funds: funds.rows };
    });
  }

  @Get('donors')
  donors(@Req() req: Request, @Query('search') search?: string) {
    return this.rt.tx(req, (db, ctx) => listDonors(db, ctx, this.rt.cipher, { search }));
  }

  @Post('donors')
  createDonor(@Req() req: Request, @Body() body: unknown) {
    const input = CreateDonorRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => createDonor(db, ctx, this.rt.cipher, input));
  }

  @Get('goods-receipts')
  goodsReceipts(@Req() req: Request, @Query('status') status?: string) {
    return this.rt.tx(req, (db, ctx) => listGoodsReceipts(db, ctx, { status }));
  }

  @Get('goods-receipts/:id')
  goodsReceipt(@Req() req: Request, @Param('id') rid: string) {
    return this.rt.tx(req, (db, ctx) => getGoodsReceipt(db, ctx, id(rid)));
  }

  @Post('goods-receipts')
  createGoodsReceipt(@Req() req: Request, @Body() body: unknown) {
    const input = CreateGoodsReceiptRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => createGoodsReceiptDraft(db, ctx, input));
  }

  @Get('money-receipts')
  moneyReceipts(@Req() req: Request) {
    return this.rt.tx(req, (db, ctx) => listMoneyReceipts(db, ctx));
  }

  @Post('money-receipts')
  createMoneyReceipt(@Req() req: Request, @Body() body: unknown) {
    const input = CreateMoneyReceiptRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => createMoneyReceiptDraft(db, ctx, input));
  }

  /** 통장 거래내역 반입: 입금은 후보로만 쌓인다(수입 아님). 원본 파일은 저장하지 않는다. */
  @Post('imports/bank-statement')
  async importBank(@Req() req: Request, @Body() body: unknown) {
    await this.rt.actor(req); // 로그인 확인을 파일 해석보다 먼저 한다
    const input = ImportBankStatementRequest.parse(body);
    const content = Buffer.from(input.contentBase64, 'base64');
    const grid = await readGrid(input.fileName, content);
    return this.rt.mutate(req, (db, ctx) => importBankStatement(db, ctx, { fileName: input.fileName, content, grid, accountLabel: input.accountLabel }));
  }

  /** 후원금 입력 양식 반입: 모든 행이 맞을 때만 초안을 한꺼번에 만든다. */
  @Post('imports/money-sheet')
  async importSheet(@Req() req: Request, @Body() body: unknown) {
    await this.rt.actor(req);
    const input = ImportMoneySheetRequest.parse(body);
    const content = Buffer.from(input.contentBase64, 'base64');
    const grid = await readGrid(input.fileName, content);
    return this.rt.mutate(req, (db, ctx) => importMoneySheet(db, ctx, { fileName: input.fileName, content, grid, facilityId: input.facilityId }));
  }

  @Get('imports')
  imports(@Req() req: Request) {
    return this.rt.tx(req, (db, ctx) => listImportBatches(db, ctx));
  }

  @Get('bank-transactions')
  bankTransactions(@Req() req: Request, @Query('view') view?: string) {
    const v: BankTxView = view === 'excluded' || view === 'all' ? view : 'open';
    return this.rt.tx(req, (db, ctx) => listBankTransactions(db, ctx, { view: v }));
  }

  @Post('bank-transactions/:id/receipt')
  bankReceipt(@Req() req: Request, @Param('id') tid: string, @Body() body: unknown) {
    const input = BankReceiptRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => createReceiptFromBank(db, ctx, this.rt.cipher, id(tid), input));
  }

  @Post('bank-transactions/:id/exclude')
  bankExclude(@Req() req: Request, @Param('id') tid: string, @Body() body: unknown) {
    const input = ExcludeBankTransactionRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => excludeBankTransaction(db, ctx, id(tid), input.reason));
  }

  @Post('bank-transactions/:id/reopen')
  bankReopen(@Req() req: Request, @Param('id') tid: string) {
    return this.rt.mutate(req, (db, ctx) => reopenBankTransaction(db, ctx, id(tid)));
  }

  /** 정기후원 약정과 최근 월별 납입 상태. 약정은 수입이 아니다. */
  @Get('pledges')
  pledges(@Req() req: Request, @Query('view') view?: string, @Query('months') months?: string, @Query('donorId') donorId?: string) {
    const v: PledgeView = view === 'ended' || view === 'all' ? view : 'active';
    const n = Number.parseInt(months ?? '', 10);
    return this.rt.tx(req, (db, ctx) => listPledges(db, ctx, {
      current: seoulToday().slice(0, 7), view: v, months: Number.isFinite(n) ? n : 6, donorId: donorId ? id(donorId) : undefined,
    }));
  }

  @Post('pledges')
  createPledge(@Req() req: Request, @Body() body: unknown) {
    const input = CreatePledgeRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => createPledge(db, ctx, input));
  }

  @Post('pledges/:id/end')
  endPledge(@Req() req: Request, @Param('id') pid: string, @Body() body: unknown) {
    const input = EndPledgeRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => endPledge(db, ctx, id(pid), input));
  }

  @Get('distributions')
  distributions(@Req() req: Request) {
    return this.rt.tx(req, (db, ctx) => listDistributions(db, ctx));
  }

  @Post('distributions')
  createDistribution(@Req() req: Request, @Body() body: unknown) {
    const input = CreateDistributionRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => createDistributionDraft(db, ctx, input));
  }

  @Post('distributions/:id/post')
  post(@Req() req: Request, @Param('id') did: string) {
    return this.rt.mutate(req, (db, ctx) => postDistribution(db, ctx, id(did)));
  }

  @Get('stock')
  stock(@Req() req: Request) {
    return this.rt.tx(req, (db, ctx) => listStock(db, ctx));
  }

  @Get('stock/lots/:id/ledger')
  ledger(@Req() req: Request, @Param('id') lotId: string) {
    return this.rt.tx(req, (db, ctx) => getLedger(db, ctx, id(lotId)));
  }

  @Get('approvals')
  approvals(@Req() req: Request, @Query('status') status?: string) {
    return this.rt.tx(req, (db, ctx) => listApprovals(db, ctx, { status }));
  }

  @Post('approvals')
  requestApproval(@Req() req: Request, @Body() body: unknown) {
    const input = RequestApprovalRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => requestApproval(db, ctx, input.targetType, input.targetId));
  }

  @Post('approvals/:id/decide')
  decide(@Req() req: Request, @Param('id') aid: string, @Body() body: unknown) {
    const input = DecideApprovalRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => decideApproval(db, ctx, id(aid), input));
  }

  @Get('documents')
  documents(@Req() req: Request, @Query('sourceId') sourceId?: string) {
    return this.rt.tx(req, (db, ctx) => listDocuments(db, ctx, { sourceId: sourceId ? id(sourceId) : undefined }));
  }

  @Post('documents')
  generate(@Req() req: Request, @Body() body: unknown) {
    const input = GenerateDocumentRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => generateDocument(db, ctx, input));
  }

  /** 문서 미리보기 HTML. 원격 리소스 차단 CSP로 응답한다. */
  @Get('documents/:id/html')
  @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:")
  @Header('Cache-Control', 'no-store')
  async documentHtml(@Req() req: Request, @Res() res: Response, @Param('id') did: string) {
    const r = await this.rt.tx(req, (db, ctx) => renderStoredDocument(db, ctx, id(did)));
    res.type('html').send(r.html);
  }

  @Get('corrections')
  corrections(@Req() req: Request, @Query('targetId') targetId?: string) {
    return this.rt.tx(req, (db, ctx) => listCorrections(db, ctx, { targetId: targetId ? id(targetId) : undefined }));
  }

  /** 승인 후 정정 요청(입고 역거래·후원금 취소·배분 취소/반품). 승인권자 승인 시 반영된다. */
  @Post('corrections')
  requestCorrection(@Req() req: Request, @Body() body: unknown) {
    const input = RequestCorrectionRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => requestCorrection(db, ctx, input));
  }

  @Get('period-closures/:period')
  checklist(@Req() req: Request, @Param('period') period: string) {
    const p = PeriodParam.parse(period);
    return this.rt.tx(req, (db, ctx) => periodChecklist(db, ctx, p));
  }

  @Post('period-closures')
  close(@Req() req: Request, @Body() body: unknown) {
    const input = ClosePeriodRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => closePeriod(db, ctx, input.period));
  }

  @Post('period-closures/:period/reopen')
  reopen(@Req() req: Request, @Param('period') period: string, @Body() body: unknown) {
    const p = PeriodParam.parse(period);
    const input = ReopenPeriodRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => reopenPeriod(db, ctx, p, input.reason));
  }

  @Get('audit-events')
  auditEvents(@Req() req: Request, @Query('category') category?: string) {
    const c = category && ['LEDGER', 'ACCESS', 'AUTH', 'ADMIN'].includes(category) ? category : undefined;
    return this.rt.tx(req, (db, ctx) => listAuditEvents(db, ctx, { category: c }));
  }

  @Get('integrations/capabilities')
  async capabilities(@Req() req: Request) {
    const ctx = await this.rt.actor(req);
    return capabilities(ctx);
  }

  @Get('integration-batches')
  batches(@Req() req: Request) {
    return this.rt.tx(req, (db, ctx) => listBatches(db, ctx));
  }

  @Post('integration-batches')
  createBatch(@Req() req: Request, @Body() body: unknown) {
    const input = CreateIntegrationBatchRequest.parse(body);
    const key = req.header('idempotency-key');
    if (!key) throw new DomainError('VALIDATION_FAILED', 'Idempotency-Key 헤더가 필요합니다.', { 'Idempotency-Key': '필수' });
    return this.rt.tx(req, (db, ctx) => createGoodsReceiptBatch(db, ctx, { sourceIds: input.sourceIds, idempotencyKey: key }));
  }

  @Get('integration-batches/:id/export')
  async export(@Req() req: Request, @Res() res: Response, @Param('id') bid: string) {
    const f = await this.rt.tx(req, (db, ctx) => exportGoodsReceiptBatch(db, ctx, id(bid)));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${f.fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(f.buffer);
  }

  @Post('integration-batches/:id/submit')
  submit(@Req() req: Request, @Param('id') bid: string) {
    return this.rt.tx(req, (db, ctx) => submitBatch(db, ctx, id(bid)));
  }
}

/** 기준정보: 기관관리자(settings.write)만 입력·변경한다. */
@Controller('v1/settings')
export class SettingsController {
  constructor(@Inject(RUNTIME) private readonly rt: Runtime) {}

  @Get('master')
  master(@Req() req: Request) {
    return this.rt.tx(req, (db, ctx) => listMasterData(db, ctx));
  }

  @Post('legal-entities')
  legalEntity(@Req() req: Request, @Body() body: unknown) {
    const input = CreateLegalEntityRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => createLegalEntity(db, ctx, input));
  }

  @Post('facilities')
  facility(@Req() req: Request, @Body() body: unknown) {
    const input = CreateFacilityRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => createFacility(db, ctx, input));
  }

  @Post('warehouses')
  warehouse(@Req() req: Request, @Body() body: unknown) {
    const input = CreateWarehouseRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => createWarehouse(db, ctx, input));
  }

  @Post('items')
  item(@Req() req: Request, @Body() body: unknown) {
    const input = CreateItemRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => createItem(db, ctx, input));
  }

  @Post('funds')
  fund(@Req() req: Request, @Body() body: unknown) {
    const input = CreateFundRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => createFund(db, ctx, input));
  }

  @Post(':kind/:id')
  update(@Req() req: Request, @Param('kind') kind: string, @Param('id') mid: string, @Body() body: unknown) {
    const k = MasterKindParam.parse(kind);
    const input = UpdateMasterRequest.parse(body);
    return this.rt.mutate(req, (db, ctx) => updateMaster(db, ctx, k, id(mid), input));
  }
}

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return { ok: true };
  }
}
