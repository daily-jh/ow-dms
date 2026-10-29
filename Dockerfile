# OW-DMS 공용 이미지: api / worker / web / bootstrap을 같은 이미지에서 command만 바꿔 실행한다.
# 비밀값은 이미지에 넣지 않고 실행 시 환경변수로 주입한다.
FROM node:24-slim AS build
WORKDIR /app
RUN npm install -g pnpm@10.28.0
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @owdms/web build

FROM node:24-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000 4000
# tsx는 현재 폴더의 tsconfig(데코레이터 설정)를 읽으므로 패키지 폴더에서 실행한다.
WORKDIR /app/apps/api
CMD ["../../node_modules/.bin/tsx", "src/main.ts"]
