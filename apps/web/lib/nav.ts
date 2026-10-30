import { cache } from 'react';
import { redirect } from 'next/navigation';
import { api, type Me } from './api';
import { needFor } from './menu';

/** 한 요청 안에서 내 정보는 한 번만 부른다. */
export const getMe = cache(() => api<Me>('/v1/auth/me'));

/** 화면 첫머리에서 호출: 권한이 없으면 깨진 화면 대신 안내 화면으로 보낸다. */
export async function requirePage(path: string): Promise<Me> {
  const me = await getMe();
  const need = needFor(path);
  if (need && !me.actions.includes(need)) redirect(`/no-access?page=${encodeURIComponent(path)}`);
  return me;
}
