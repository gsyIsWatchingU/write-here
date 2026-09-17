const express = require('express');
const { spawn } = require('child_process');
const { authenticateSession } = require('./problems');

const DEFAULT_CLI_PATH = 'claude';
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_MAX_CHARS = 100000;
const DEFAULT_MAX_INSTRUCTION_CHARS = 4000;
// 只做纯文本润色：禁用工具，避免 Claude 在打印模式下去读写服务器文件或执行命令。
const DEFAULT_CLI_ARGS = ['-p', '--output-format', 'text', '--disallowedTools', 'Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch'];

class AiPolishError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function aiPolishConfig(env = process.env) {
    const cliArgs = String(env.CLAUDE_CLI_ARGS || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    return {
        cliPath: String(env.CLAUDE_CLI_PATH || DEFAULT_CLI_PATH).trim() || DEFAULT_CLI_PATH,
        baseUrl: String(env.ANTHROPIC_BASE_URL || '').trim().replace(/\/+$/, ''),
        apiKey: String(env.ANTHROPIC_API_KEY || '').trim(),
        model: String(env.CLAUDE_MODEL || env.ANTHROPIC_MODEL || '').trim(),
        timeoutMs: Number(env.AI_POLISH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
        maxChars: Number(env.AI_POLISH_MAX_CHARS) || DEFAULT_MAX_CHARS,
        maxInstructionChars: Number(env.AI_POLISH_MAX_INSTRUCTION_CHARS) || DEFAULT_MAX_INSTRUCTION_CHARS,
        cliArgs: cliArgs.length > 0 ? cliArgs : DEFAULT_CLI_ARGS,
    };
}

function buildPolishPrompt({ content, instruction }) {
    return [
        '你是一名专业的中文文档润色助手。用户会提供一篇 Markdown 格式的文档和润色要求，请按要求润色整篇文档。',
        '',
        '润色要求：',
        String(instruction).trim(),
        '',
        '规则：',
        '- 完整输出润色后的整篇 Markdown 文档，不要只输出修改片段。',
        '- 保留文档原有的 Markdown 结构与格式：标题层级、列表、任务列表、表格、代码块、引用、链接和图片。',
        '- 代码块内的代码保持原样，不要改动，不要重新排版。',
        '- 不改变原文的事实、数据和结论；不擅自增删用户未要求的内容。',
        '- 保持文档原有语言（中文文档用中文润色）。',
        '- 只输出 Markdown 正文本身：不要任何解释、前言或结尾说明，不要用代码围栏包裹整个输出，不要调用任何工具。',
        '',
        '===== 文档内容开始 =====',
        String(content),
        '===== 文档内容结束 =====',
    ].join('\n');
}

// 通过 stdin 传入提示词，避免超长文档超出命令行参数长度限制。
function runClaudeCli({ prompt, config, spawnImpl = spawn, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    return new Promise((resolve, reject) => {
        const env = { ...process.env };
        if (config.baseUrl) env.ANTHROPIC_BASE_URL = config.baseUrl;
        if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey;
        if (config.model) env.ANTHROPIC_MODEL = config.model;

        let child;
        try {
            child = spawnImpl(config.cliPath, config.cliArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (error) {
            return reject(new AiPolishError(503, `无法启动 claude CLI：${error.message}`));
        }

        let stdout = '';
        let stderr = '';
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { child.kill('SIGKILL'); } catch (error) { /* 忽略 */ }
            reject(new AiPolishError(502, `AI 润色超时（超过 ${Math.round(timeoutMs / 1000)} 秒）`));
        }, timeoutMs);

        child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
        child.stderr?.on('data', (chunk) => { stderr += String(chunk); });

        child.on('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error.code === 'ENOENT') {
                reject(new AiPolishError(503, `未检测到 claude 命令行工具（${config.cliPath}），请先在服务器安装并配置 Claude CLI`));
            } else {
                reject(new AiPolishError(502, `调用 claude CLI 失败：${error.message}`));
            }
        });

        child.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (code === 0) return resolve(stdout);
            const detail = stderr.trim().split(/\r?\n/).slice(-3).join(' ') || `退出码 ${code}`;
            reject(new AiPolishError(502, `claude CLI 执行失败：${detail}`));
        });

        child.stdin?.on('error', () => { /* 进程已退出时忽略写入错误 */ });
        child.stdin?.end(prompt);
    });
}

async function polishDocument({ content, instruction, config = aiPolishConfig(), runCli = runClaudeCli }) {
    if (!config.apiKey && !config.baseUrl) {
        throw new AiPolishError(503, '服务器未配置 Claude 接入信息（缺少 ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL）');
    }
    const prompt = buildPolishPrompt({ content, instruction });
    const stdout = await runCli({ prompt, config, timeoutMs: config.timeoutMs });
    const markdown = String(stdout || '').trim();
    if (!markdown) throw new AiPolishError(502, 'Claude 未返回有效内容，请重试');
    return { markdown };
}

function createAiPolishRouter({ db, config = aiPolishConfig(), polishImpl = polishDocument }) {
    const router = express.Router();

    // 供前端判断按钮可用性；不返回任何密钥信息。
    router.get('/ai/polish/config', async (req, res) => {
        const user = await authenticateSession(db, req);
        if (!user) return res.status(401).json({ error: '登录已过期，请重新登录' });
        res.json({
            configured: Boolean(config.apiKey || config.baseUrl),
            model: config.model || null,
        });
    });

    router.post('/ai/polish', async (req, res) => {
        const user = await authenticateSession(db, req);
        if (!user) return res.status(401).json({ error: '登录已过期，请重新登录' });

        const { content, instruction } = req.body || {};
        if (typeof instruction !== 'string' || !instruction.trim()) {
            return res.status(400).json({ error: '请填写润色要求' });
        }
        if (typeof content !== 'string' || !content.trim()) {
            return res.status(400).json({ error: '文档内容为空' });
        }
        if (instruction.length > config.maxInstructionChars) {
            return res.status(400).json({ error: `润色要求过长（最多 ${config.maxInstructionChars} 字）` });
        }
        if (content.length > config.maxChars) {
            return res.status(413).json({ error: `文档内容过长（最多 ${config.maxChars} 字），请分段润色` });
        }

        try {
            const result = await polishImpl({ content, instruction, config });
            res.json(result);
        } catch (error) {
            const status = error instanceof AiPolishError ? error.status : 500;
            if (status >= 500) console.error('AI 润色失败:', error.message);
            res.status(status).json({ error: error.message || 'AI 润色失败' });
        }
    });

    return router;
}

module.exports = { AiPolishError, aiPolishConfig, buildPolishPrompt, createAiPolishRouter, polishDocument, runClaudeCli };
