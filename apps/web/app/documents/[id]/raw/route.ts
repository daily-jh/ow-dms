import { rawApi } from '@/lib/api';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('not found', { status: 404 });
  const res = await rawApi(`/v1/documents/${id}/html`);
  return new Response(await res.text(), {
    status: res.status,
    headers: {
      'content-type': res.ok ? 'text/html; charset=utf-8' : 'application/json',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      'cache-control': 'no-store',
    },
  });
}
