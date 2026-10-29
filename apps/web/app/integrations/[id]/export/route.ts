import { rawApi } from '@/lib/api';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('not found', { status: 404 });
  const res = await rawApi(`/v1/integration-batches/${id}/export`);
  return new Response(res.body, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': res.headers.get('content-disposition') ?? 'attachment',
      'cache-control': 'no-store',
    },
  });
}
