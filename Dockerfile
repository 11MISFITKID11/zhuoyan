# 琢言 · Docker 配置

# 构建阶段
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

# 运行阶段
FROM node:18-alpine
WORKDIR /app

# 环境变量（运行时覆盖）
ENV NODE_ENV production

# 复制依赖和文件（前端已统一在 public/ 下）
# 密钥/数据库不打包进镜像：生产用环境变量注入（JWT_SECRET 等）
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/server ./server
COPY --from=build /app/public ./public

# 暴露端口
EXPOSE 3003

# 启动命令
CMD ["node", "server/index.js"]