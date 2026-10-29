import { STATUS_LABEL } from '@/lib/format';

const TONE: Record<string, string> = {
  APPROVED: 'ok', POSTED: 'ok', VERIFIED: 'ok', CONFIRMED: 'ok',
  PENDING_APPROVAL: 'warn', PENDING: 'warn', EXPORTED: 'warn', UNKNOWN: 'warn', PROPOSED: 'warn', UNCONFIRMED: 'warn',
  REJECTED: 'err', NOT_READY: 'err', INVALIDATED: 'err',
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
