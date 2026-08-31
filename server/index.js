/**
 * 琢言 · 学术写作助手 — 服务启动入口
 *
 * 启动: npm start
 * 功能: 初始化数据库 → 启动 HTTP 服务 → 打开浏览器
 */

const config = require('./config');
const logger = require('./utils/logger');
const { initDb, setupGracefulShutdown } = require('./db');
const app = require('./app');

async function start() {
  logger.info('琢言 · 启动中...', { env: config.nodeEnv, port: config.port });

  // 初始化数据库
  await initDb();
  setupGracefulShutdown();

  // 启动 HTTP 服务（单实例锁：端口被占用即拒绝启动，避免多实例互相覆盖数据）
  function tryListen(port) {
    const server = app.listen(port, () => {
      logger.info(`琢言 · 后端服务已启动`);
      logger.info(`  地址: http://localhost:${port}`);
      logger.info(`  前端: http://localhost:${port}/index.html`);
      logger.info(`  健康: http://localhost:${port}/health`);

      // 自动打开浏览器（仅开发环境）
      if (!config.isProduction) {
        const url = `http://localhost:${port}/index.html`;
        const cp = require('child_process');
        const p = process.platform;
        try {
          if (p === 'win32') cp.execSync(`start "" "${url}"`, { timeout: 3000 });
          else if (p === 'darwin') cp.execSync(`open "${url}"`, { timeout: 3000 });
          else cp.execSync(`xdg-open "${url}"`, { timeout: 3000 });
        } catch (e) {}
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`端口 ${port} 已被占用，服务已在运行中，拒绝启动第二个实例（防止数据互相覆盖）`);
        process.exit(1);
      }
      logger.error('无法启动服务', { error: err.message });
      process.exit(1);
    });
  }

  tryListen(config.port);
}

start().catch(err => {
  logger.error('启动失败', { error: err.message, stack: err.stack });
  process.exit(1);
});
