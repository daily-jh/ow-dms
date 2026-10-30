import { STATUS_LABEL } from '@/lib/format';

const TONE: Record<string, string> = {
  APPROVED: 'ok', POSTED: 'ok', VERIFIED: 'ok', CONFIRMED: 'ok',
  PENDING_APPROVAL: 'warn', PENDING: 'warn', EXPORTED: 'warn', UNKNOWN: 'warn', PROPOSED: 'warn', UNCONFIRMED: 'warn',
  REJECTED: 'err', NOT_READY: 'err', INVALIDATED: 'err', CORRECTION_REQUIRED: 'err',
  REVERSED: 'info', CANCELLED: 'info', RETURNED: 'info', CLOSED: 'ok', OPEN: 'warn',
};

/** 상태는 색만이 아니라 글자로도 표시한다. */
export function Status({ value, label }: { value: string; label?: string }) {
  return <span className={`badge ${TONE[value] ?? 'info'}`}>{label ?? STATUS_LABEL[value] ?? value}</span>;
}

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === 'string' ? sp.ok : null;
  const error = typeof sp.error === 'string' ? sp.error : null;
  return (
    <>
      {ok && <p className="msg ok" role="status">{ok}</p>}
      {error && <p className="msg err" role="alert">{error}</p>}
    </>
  );
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** 확정 후 정정 확정 폼. 원거래는 수정하지 않고 승인 시 역거래로 반영된다. */
export function CorrectionForm({ targetType, targetId, returnTo, label, needsInspection = false, action }: {
  targetType: string; targetId: string; returnTo: string; label: string; needsInspection?: boolean; action: (f: FormData) => Promise<void>;
}) {
  return (
    <details>
      <summary className="muted" style={{ cursor: 'pointer' }}>{label}</summary>
      <form action={action} className="row" style={{ marginTop: 6 }}>
        <input type="hidden" name="targetType" value={targetType} /><input type="hidden" name="targetId" value={targetId} />
        <input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="idempotencyKey" value={`corr-${crypto.randomUUID()}`} />
        <input name="reason" placeholder="정정 사유(개인정보 기재 금지)" aria-label="정정 사유" required maxLength={500} style={{ width: 220 }} />
        {needsInspection && (
          <label className="row" style={{ color: 'var(--text)', margin: 0 }}>
            <input type="checkbox" name="inspectionConfirmed" required style={{ width: 'auto' }} /> 회수·상태검사 확인
          </label>
        )}
        <button type="submit" className="danger">정정 확정</button>
      </form>
    </details>
  );
}

export const DEMO_MODE = process.env.DEMO_MODE === 'true';

/** 공개 시연판 표시: 누구나 같은 합성 계정으로 들어오므로 실제 정보 입력을 막는 안내를 항상 띄운다. */
export function DemoBanner() {
  if (!DEMO_MODE) return null;
  return (
    <p className="demo-banner" role="note">
      공개 시연판입니다. 모든 기관·후원자·물품은 합성(가상) 자료이며, 입력한 내용은 다른 방문자에게 보이고 수시로 초기화됩니다.
      실제 이름·연락처·주민번호·계좌 등 개인정보를 입력하지 마십시오.
    </p>
  );
}
