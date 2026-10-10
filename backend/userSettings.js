const express = require('express');
const { authenticateSession } = require('./authSession');

// 个人设置：昵称 + AI 模型接入（API 地址 / API Key / 模型名）。
// 昵称落在 users.displayName（全站展示名），AI 配置落在 user_settings 表。
//
// 安全说明：API Key 必须原文保存才能被「AI 润色」真正使用（后端要拿它调模型 API），
// 与 MCP Token（只做哈希比对）不同，本表不能哈希。GET /settings 永不回传原文，
// 只返回 hasApiKey 与掩码提示；生产化时应改为服务端密钥加密后落库。

const MAX_NICKNAME = 40;
const MAX_AI_URL = 500;
const MAX_AI_MODEL = 120;
const MAX_AI_KEY = 4096;

// 读取某个用户的 AI 配置；表不存在或查询失败时返回空对象（不阻断主流程）。
function loadUserAiSettings(db, userId) {
    return new Promise((resolve) => {
        if (!db || !userId) return resolve({});
        db.get(
            'SELECT aiBaseUrl, aiApiKey, aiModel, aiProtocol FROM user_settings WHERE userId = ?',
            [userId],
            (err, row) => (err ? resolve({}) : resolve(row || {}))
        );
    });
}

// 服务器环境变量配置为底，用户个人配置优先，逐字段覆盖。
function mergeUserAiConfig(serverConfig, userSettings = {}) {
    const merged = { ...serverConfig };
    if (userSettings.aiBaseUrl) {
        merged.baseUrl = String(userSettings.aiBaseUrl).trim().replace(/\/+$/, '');
    }
    if (userSettings.aiApiKey) {
        merged.apiKey = String(userSettings.aiApiKey).trim();
    }
    if (userSettings.aiModel) {
        merged.model = String(userSettings.aiModel).trim();
    }
    // 接口类型：用户显式选择优先，未配置时继承服务器默认（anthropic）
    merged.protocol = (userSettings.aiProtocol === 'openai' || userSettings.aiProtocol === 'anthropic')
        ? userSettings.aiProtocol
        : (serverConfig.protocol || 'anthropic');
    return merged;
}

function maskApiKey(key) {
    const s = String(key || '').trim();
    if (!s) return '';
    if (s.length <= 8) return `${s.slice(0, 2)}****`;
    return `${s.slice(0, 4)}****${s.slice(-2)}`;
}

function createUserSettingsRouter({ db }) {
    const router = express.Router();

    // 读取个人设置；API Key 只给掩码，不回传原文。
    router.get('/settings', async (req, res) => {
        const user = await authenticateSession(db, req).catch(() => null);
        if (!user) return res.status(401).json({ error: '登录已过期，请重新登录' });
        const settings = await loadUserAiSettings(db, user.id);
        res.json({
            nickname: user.username,
            ai: {
                baseUrl: settings.aiBaseUrl || '',
                model: settings.aiModel || '',
                protocol: settings.aiProtocol === 'openai' ? 'openai' : 'anthropic',
                hasApiKey: Boolean(settings.aiApiKey),
                apiKeyHint: maskApiKey(settings.aiApiKey),
            },
        });
    });

    // 保存个人设置：只更新请求里带了的字段（nickname / ai 均为可选）。
    // ai.apiKey 语义：空字符串 = 保持原样（前端不预填明文，防止误清空）；
    // ai.clearApiKey = true = 显式清除；非空字符串 = 替换。
    router.put('/settings', async (req, res) => {
        const user = await authenticateSession(db, req).catch(() => null);
        if (!user) return res.status(401).json({ error: '登录已过期，请重新登录' });
        const body = (req.body && typeof req.body === 'object') ? req.body : {};

        let nickname = user.username;
        if (typeof body.nickname === 'string') {
            const trimmed = body.nickname.trim().slice(0, MAX_NICKNAME);
            if (!trimmed) return res.status(400).json({ error: '昵称不能为空' });
            nickname = trimmed;
            await new Promise((resolve, reject) => {
                db.run('UPDATE users SET displayName = ? WHERE id = ?', [nickname, user.id], (err) => (
                    err ? reject(err) : resolve()
                ));
            });
        }

        const ai = (body.ai && typeof body.ai === 'object') ? body.ai : {};
        const current = await loadUserAiSettings(db, user.id);

        let aiBaseUrl = current.aiBaseUrl || '';
        if (typeof ai.baseUrl === 'string') {
            aiBaseUrl = ai.baseUrl.trim().replace(/\/+$/, '');
            if (aiBaseUrl.length > MAX_AI_URL) {
                return res.status(400).json({ error: `API 地址过长（最多 ${MAX_AI_URL} 字符）` });
            }
        }

        let aiApiKey = current.aiApiKey || '';
        if (ai.clearApiKey === true) {
            aiApiKey = '';
        } else if (typeof ai.apiKey === 'string' && ai.apiKey.trim()) {
            aiApiKey = ai.apiKey.trim().slice(0, MAX_AI_KEY);
        }

        let aiModel = current.aiModel || '';
        if (typeof ai.model === 'string') {
            aiModel = ai.model.trim();
            if (aiModel.length > MAX_AI_MODEL) {
                return res.status(400).json({ error: `模型名过长（最多 ${MAX_AI_MODEL} 字符）` });
            }
        }

        // 接口类型：anthropic（claude CLI）/ openai（OpenAI 兼容端点），非法值忽略保持原样
        let aiProtocol = current.aiProtocol === 'openai' ? 'openai' : 'anthropic';
        if (ai.protocol === 'openai' || ai.protocol === 'anthropic') {
            aiProtocol = ai.protocol;
        }

        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO user_settings (userId, aiBaseUrl, aiApiKey, aiModel, aiProtocol, updatedAt)
                 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(userId) DO UPDATE SET
                   aiBaseUrl = excluded.aiBaseUrl,
                   aiApiKey = excluded.aiApiKey,
                   aiModel = excluded.aiModel,
                   aiProtocol = excluded.aiProtocol,
                   updatedAt = CURRENT_TIMESTAMP`,
                [user.id, aiBaseUrl, aiApiKey, aiModel, aiProtocol],
                (err) => (err ? reject(err) : resolve())
            );
        });

        res.json({
            nickname,
            ai: {
                baseUrl: aiBaseUrl,
                model: aiModel,
                protocol: aiProtocol,
                hasApiKey: Boolean(aiApiKey),
                apiKeyHint: maskApiKey(aiApiKey),
            },
        });
    });

    return router;
}

module.exports = {
    createUserSettingsRouter,
    loadUserAiSettings,
    mergeUserAiConfig,
    maskApiKey,
    MAX_NICKNAME,
    MAX_AI_URL,
    MAX_AI_MODEL,
    MAX_AI_KEY,
};
