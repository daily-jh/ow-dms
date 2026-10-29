import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, Header } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CreateDistributionRequest, CreateDonorRequest, CreateGoodsReceiptRequest, CreateIntegrationBatchRequest, CreateMoneyReceiptRequest,
  ClosePeriodRequest, DecideApprovalRequest, DevLoginRequest, GenerateDocumentRequest, PeriodParam, ReopenPeriodRequest, RequestApprovalRequest,
  RequestCorrectionRequest,
} from '@owdms/contracts';
import {
  activeMemberships, capabilities, createDistributionDraft, createDonor, createGoodsReceiptBatch, createGoodsReceiptDraft,
  createMoneyReceiptDraft, decideApproval, exportGoodsReceiptBatch, findUser, generateDocument, getGoodsReceipt, getLedger,
  listApprovals, listBatches, listDistributions, listDocuments, listDonors, listGoodsReceipts, listMoneyReceipts, listStock,
  postDistribution, renderStoredDocument, requestApproval, submitBatch, todayDashboard, withTenant, requestCorrection, listCorrections,
  periodChecklist, closePeriod, reopenPeriod, listAuditEvents,
} from '@owdms/db';
import { DomainError, ROLE_LABEL, ROLE_ACTIONS, type Role } from '@owdms/domain';
import { z } from 'zod';
import { RUNTIME, Runtime } from './runtime';
import { signSession } from './session';
import { requestId } from './http';

const Uuid = z.uuid();
const id = (v: string) => {
  const r = Uuid.safeParse(v);
  if (!r.success) throw new DomainError('NOT_FOUND', '대상을 찾을 수 없습니다.');
  return r.data;
};

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

// 단순 로그인 시도 제한(프로세스 메모리). 운영에서는 IdP·게이트웨이의 제한을 사용한다.
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const e = loginAttempts.get(key);
  if (!e || e.resetAt < now) return void loginAttempts.set(key, { count: 1, resetAt: now + windowMs });
  e.count += 1;
  if (e.count > max) throw new DomainError('FORBIDDEN', '잠시 후 다시 시도하십시오.');
}

@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(RUNTIME) private readonly rt: Runtime) {}

  /** 합성 계정 개발 로그인. 운영(DEV_LOGIN_ENABLED=false)에서는 404와 동일하게 거부. */
  @Post('dev-login')
  async devLogin(@Req() req: Request, @Body() body: unknown) {
    if (!this.rt.config.devLoginEnabled) throw new DomainError('NOT_FOUND', '경로를 찾을 수 없습니다.');
    rateLimit(req.ip ?? 'unknown');
    const input = DevLoginRequest.parse(body);
    const user = await findUser(this.rt.pool, input.username);
    const memberships = user ? await activeMemberships(this.rt.pool, user.userId) : [];
    const m = memberships[0];
    if (!user || !m) throw new DomainError('FORBIDDEN', '로그인할 수 없는 계정입니다.');
    const exp = Math.floor(Date.now() / 1000) + 8 * 3600;
    await withTenant(this.rt.pool, { tenantId: m.tenantId, userId: user.userId }, (db) =>
      db.query(`insert into audit_events (tenant_id, actor_user_id, category, action, result, request_id) values (app_tenant(), app_user(), 'AUTH', 'login.dev', 'SUCCESS', $1)`, [
        requestId(req),
      ]),
    );
    return { token: signSession({ sub: user.userId, tid: m.tenantId, exp }, this.rt.config.sessionSecret), expiresAt: new Date(exp * 1000).toISOString() };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const ctx = await this.rt.actor(req);
    const name = await this.rt.tx(req, async (db) => (await db.query<{ display_name: string }>('select display_name from users where id = app_user()')).rows[0]?.display_name);
    return {
      userId: ctx.userId, displayName: name, tenantId: ctx.tenantId, tenantName: ctx.tenantName, roles: ctx.roles,
      roleLabels: ctx.roles.map((r) => ROLE_LABEL[r as Role] ?? r),
      actions: [...new Set(ctx.roles.flatMap((r) => ROLE_ACTIONS[r as Role] ?? []))],
    };
  }
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
      const facilities = await db.query('select id, name from facilities order by name');
      const warehouses = await db.query('select id, facility_id as "facilityId", name from warehouses order by name');
      const items = await db.query('select id, name, base_unit as "baseUnit", perishable from items order by name');
      const funds = await db.query('select id, name, designated from funds order by designated, name');
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

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return { ok: true };
  }
}
