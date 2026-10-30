/** 운영 빌드는 Secure 쿠키. 내 PC에서 http://localhost로 띄울 때만 COOKIE_SECURE=false로 끈다. */
export function secureCookie(): boolean {
  if (process.env.COOKIE_SECURE === 'false') return false;
  return process.env.NODE_ENV === 'production';
}
