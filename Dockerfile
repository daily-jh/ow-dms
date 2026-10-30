# OW-DMS 공용 이미지: api / worker / web / bootstrap을 같은 이미지에서 command만 바꿔 실행한다.
# 비밀값은 이미지에 넣지 않고 실행 시 환경변수로 주입한다.
FROM node:24-slim AS build
WORKDIR /app
RUN npm install -g pnpm@10.28.0
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @owdms/web build
# 실행에 필요 없는 것 지우기(작은 서버 디스크 절약): 빌드 캐시, 다른 libc(musl)용 바이너리, 시험 도구.
# tsx(실행기)·esbuild·typescript·next swc(glibc)는 실행에 쓰이므로 남긴다.
RUN rm -rf apps/web/.next/cache \
 && find node_modules/.pnpm -maxdepth 1 \( -name '*musl*' -o -name 'vitest@*' -o -name '@vitest+*' -o -name 'vite@*' \
      -o -name 'rolldown@*' -o -name '@rolldown+*' -o -name 'playwright*' \) -exec rm -rf {} +

FROM node:24-slim
LABEL org.opencontainers.image.source=https://github.com/daily-jh/ow-dms
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000 4000
# tsx는 현재 폴더의 tsconfig(데코레이터 설정)를 읽으므로 패키지 폴더에서 실행한다.
WORKDIR /app/apps/api
CMD ["../../node_modules/.bin/tsx", "src/main.ts"]
