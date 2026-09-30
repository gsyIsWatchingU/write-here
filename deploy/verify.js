const WebSocket = require('../backend/node_modules/ws');
const sqlite3 = require('../backend/node_modules/sqlite3').verbose();
const path = require('path');

const port = Number(process.env.PORT) || 3210;
const httpBase = (process.env.BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');
const wsBase = httpBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');

async function checkHttp(path) {
  const response = await fetch(`${httpBase}${path}`, {
    headers: { Accept: path === '/health' ? 'application/json' : 'text/html' },
  });
  if (!response.ok) throw new Error(`${path} 返回 ${response.status}`);
  console.log(`HTTP ${path}: ${response.status}`);
}

function checkWebSocket(path) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsBase}${path}`);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`${path} 连接超时`));
    }, 5000);

    socket.once('open', () => {
      clearTimeout(timer);
      console.log(`WebSocket ${path}: connected`);
      socket.close();
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function checkDatabase() {
  const databasePath = path.join(__dirname, '../db/docs.db');
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, (openError) => {
      if (openError) return reject(openError);
      database.all(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        (tableError, tables) => {
          if (tableError) return reject(tableError);
          if (!tables.length) return reject(new Error('数据库中没有业务表'));
          console.log(`SQLite: ${tables.length} 个业务表`);
          database.close(resolve);
        },
      );
    });
  });
}

// 通知 WebSocket 的探针 userId 必须是合法正整数：后端在 upgrade 阶段会把查询参数
// Number() 后校验 Number.isInteger && > 0，传 'healthcheck' 这类字符串会被直接
// socket.destroy()，握手表现为 socket hang up（经隧道是 502）。这里用不存在的哨兵
// id，避免探针占用真实用户的 userConnections 集合。
const NOTIFY_PROBE_USER_ID = 999999;

async function main() {
  await checkHttp('/health');
  await checkHttp('/');
  await checkHttp('/login');
  await checkWebSocket('/ws/verify-room');
  await checkWebSocket(`/notifications?userId=${NOTIFY_PROBE_USER_ID}`);
  await checkDatabase();
  console.log('WriteHere 部署验证通过');
}

main().catch((error) => {
  console.error(`部署验证失败：${error.message}`);
  process.exitCode = 1;
});
