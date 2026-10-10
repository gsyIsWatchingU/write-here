const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { AiPolishError, aiPolishConfig, buildPolishPrompt, createAiPolishRouter, polishDocument, runClaudeCli, runOpenAiCompatible, fetchAvailableModels } = require('./aiPolish');

function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, (error) => error ? reject(error) : resolve()));
}

async function startServer({ config, polishImpl } = {}) {
    const db = new sqlite3.Database(':memory:');
    await exec(db, `
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            displayName TEXT,
            email TEXT,
            ssoSubject TEXT,
            isAdmin INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE sessions (
            token TEXT PRIMARY KEY,
            userId INTEGER NOT NULL,
            expiresAt DATETIME NOT NULL
        );
        CREATE TABLE user_settings (
            userId INTEGER PRIMARY KEY,
            aiBaseUrl TEXT NOT NULL DEFAULT '',
            aiApiKey TEXT NOT NULL DEFAULT '',
            aiModel TEXT NOT NULL DEFAULT '',
            aiProtocol TEXT NOT NULL DEFAULT 'anthropic',
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users (id, username) VALUES (1, 'tester');
        INSERT INTO sessions (token, userId, expiresAt) VALUES ('good-token', 1, datetime('now', '+1 day'));
        INSERT INTO sessions (token, userId, expiresAt) VALUES ('old-token', 1, datetime('now', '-1 day'));
    `);

    const app = express();
    app.use(express.json({ limit: '3mb' }));
    app.use(createAiPolishRouter({ db, config, polishImpl }));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        server,
        db,
        base: `http://127.0.0.1:${server.address().port}`,
        close: async () => {
            await new Promise((resolve) => server.close(resolve));
            await new Promise((resolve) => db.close(resolve));
        },
    };
}

function configuredConfig(overrides = {}) {
    return {
        ...aiPolishConfig({}),
        apiKey: 'sk-third-party',
        baseUrl: 'https://gpu-model-api.example',
        ...overrides,
    };
}

function requestJson(base, path, { method = 'GET', body, token = 'good-token' } = {}) {
    return fetch(`${base}${path}`, {
        method,
        headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

test('aiPolishConfig 读取环境变量并保留默认值', () => {
    const defaults = aiPolishConfig({});
    assert.equal(defaults.cliPath, 'claude');
    assert.equal(defaults.baseUrl, '');
    assert.equal(defaults.apiKey, '');
    assert.equal(defaults.model, '');
    assert.equal(defaults.timeoutMs, 180000);
    assert.equal(defaults.maxChars, 100000);
    assert.equal(defaults.maxInstructionChars, 4000);
    assert.ok(Array.isArray(defaults.cliArgs) && defaults.cliArgs.length > 0);
    assert.ok(defaults.cliArgs.includes('-p'));

    const custom = aiPolishConfig({
        CLAUDE_CLI_PATH: 'claude-beta',
        ANTHROPIC_BASE_URL: 'https://gpu.example/',
        ANTHROPIC_API_KEY: 'key-1',
        CLAUDE_MODEL: 'claude-sonnet-gpu',
        AI_POLISH_TIMEOUT_MS: '60',
        AI_POLISH_MAX_CHARS: '5000',
        AI_POLISH_MAX_INSTRUCTION_CHARS: '100',
        CLAUDE_CLI_ARGS: '-p,--output-format,text',
    });
    assert.equal(custom.cliPath, 'claude-beta');
    assert.equal(custom.baseUrl, 'https://gpu.example');
    assert.equal(custom.apiKey, 'key-1');
    assert.equal(custom.model, 'claude-sonnet-gpu');
    assert.equal(custom.timeoutMs, 60);
    assert.equal(custom.maxChars, 5000);
    assert.equal(custom.maxInstructionChars, 100);
    assert.deepEqual(custom.cliArgs, ['-p', '--output-format', 'text']);
});

test('buildPolishPrompt 包含润色要求、文档内容和输出约束', () => {
    const prompt = buildPolishPrompt({ content: '# 标题\n正文', instruction: '  更专业  ' });
    assert.match(prompt, /润色要求：\n更专业/);
    assert.match(prompt, /===== 文档内容开始 =====\n# 标题\n正文/);
    assert.match(prompt, /保留文档原有的 Markdown 结构/);
    assert.match(prompt, /不要任何解释/);
});

test('polishDocument 调用 CLI 并返回 Markdown', async () => {
    const calls = [];
    const runCli = async ({ prompt, config, timeoutMs }) => {
        calls.push({ prompt, config, timeoutMs });
        return '  # 润色后的文档\n\n更专业的正文。  ';
    };
    const result = await polishDocument({
        content: '# 原文档',
        instruction: '润色',
        config: configuredConfig(),
        runCli,
    });
    assert.equal(result.markdown, '# 润色后的文档\n\n更专业的正文。');
    assert.equal(calls.length, 1);
    assert.match(calls[0].prompt, /润色要求：\n润色/);
});

test('polishDocument 未配置密钥时返回 503，空输出返回 502', async () => {
    await assert.rejects(
        () => polishDocument({ content: 'x', instruction: 'y', config: aiPolishConfig({}) }),
        (error) => {
            assert.ok(error instanceof AiPolishError);
            assert.equal(error.status, 503);
            assert.match(error.message, /未配置/);
            return true;
        }
    );

    await assert.rejects(
        () => polishDocument({
            content: 'x',
            instruction: 'y',
            config: configuredConfig(),
            runCli: async () => '   ',
        }),
        (error) => {
            assert.ok(error instanceof AiPolishError);
            assert.equal(error.status, 502);
            assert.match(error.message, /未返回有效内容/);
            return true;
        }
    );
});

test('runClaudeCli 通过 stdin 传提示词，成功后返回 stdout', async () => {
    const calls = [];
    function fakeSpawn(command, args, options) {
        calls.push({ command, args, env: options.env });
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.stdin = new EventEmitter();
        child.stdin.end = (data) => { calls[0].stdinText = data; };
        child.kill = () => { calls[0].killed = true; };
        process.nextTick(() => {
            child.stdout.emit('data', '# 润色结果');
            child.stdout.emit('data', '\n正文');
            child.emit('close', 0);
        });
        return child;
    }

    const output = await runClaudeCli({
        prompt: '润色吧',
        config: configuredConfig({ model: 'gpu-model' }),
        spawnImpl: fakeSpawn,
    });

    assert.equal(output, '# 润色结果\n正文');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'claude');
    assert.ok(calls[0].args.includes('-p'));
    assert.ok(calls[0].args.includes('--output-format'));
    assert.equal(calls[0].env.ANTHROPIC_BASE_URL, 'https://gpu-model-api.example');
    assert.equal(calls[0].env.ANTHROPIC_API_KEY, 'sk-third-party');
    assert.equal(calls[0].env.ANTHROPIC_MODEL, 'gpu-model');
    assert.equal(calls[0].stdinText, '润色吧');
});

test('runClaudeCli 处理 CLI 不存在、非零退出和超时', async () => {
    await assert.rejects(
        () => runClaudeCli({
            prompt: 'x',
            config: configuredConfig(),
            spawnImpl: () => {
                const child = new EventEmitter();
                child.stdout = new EventEmitter();
                child.stderr = new EventEmitter();
                child.stdin = { end: () => {}, on: () => {} };
                child.kill = () => {};
                process.nextTick(() => child.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })));
                return child;
            },
        }),
        (error) => {
            assert.equal(error.status, 503);
            assert.match(error.message, /未检测到 claude 命令行/);
            return true;
        }
    );

    await assert.rejects(
        () => runClaudeCli({
            prompt: 'x',
            config: configuredConfig(),
            spawnImpl: () => {
                const child = new EventEmitter();
                child.stdout = new EventEmitter();
                child.stderr = new EventEmitter();
                child.stdin = { end: () => {}, on: () => {} };
                child.kill = () => {};
                process.nextTick(() => {
                    child.stderr.emit('data', 'Error: model busy');
                    child.emit('close', 1);
                });
                return child;
            },
        }),
        (error) => {
            assert.equal(error.status, 502);
            assert.match(error.message, /model busy/);
            return true;
        }
    );

    await assert.rejects(
        () => runClaudeCli({
            prompt: 'x',
            config: configuredConfig(),
            timeoutMs: 5,
            spawnImpl: () => {
                const child = new EventEmitter();
                child.stdout = new EventEmitter();
                child.stderr = new EventEmitter();
                child.stdin = { end: () => {}, on: () => {} };
                child.kill = () => { child.emit('close', null); };
                return child;
            },
        }),
        (error) => {
            assert.equal(error.status, 502);
            assert.match(error.message, /超时/);
            return true;
        }
    );
});

test('润色接口要求登录，并校验输入', async (t) => {
    const ctx = await startServer({
        config: configuredConfig(),
        polishImpl: async () => ({ markdown: '# 润色后' }),
    });
    t.after(ctx.close);

    const anonymous = await requestJson(ctx.base, '/ai/polish', { method: 'POST', body: { content: 'x', instruction: 'y' }, token: null });
    assert.equal(anonymous.status, 401);
    assert.match((await anonymous.json()).error, /登录/);

    const expired = await requestJson(ctx.base, '/ai/polish', { method: 'POST', body: { content: 'x', instruction: 'y' }, token: 'old-token' });
    assert.equal(expired.status, 401);

    const noInstruction = await requestJson(ctx.base, '/ai/polish', { method: 'POST', body: { content: 'x', instruction: '  ' } });
    assert.equal(noInstruction.status, 400);
    assert.match((await noInstruction.json()).error, /润色要求/);

    const noContent = await requestJson(ctx.base, '/ai/polish', { method: 'POST', body: { content: '', instruction: 'y' } });
    assert.equal(noContent.status, 400);
    assert.match((await noContent.json()).error, /内容为空/);

    const longInstruction = await requestJson(ctx.base, '/ai/polish', { method: 'POST', body: { content: 'x', instruction: 'y'.repeat(4001) } });
    assert.equal(longInstruction.status, 400);

    const shortLimitCtx = await startServer({
        config: configuredConfig({ maxChars: 100 }),
        polishImpl: async () => ({ markdown: 'ok' }),
    });
    t.after(shortLimitCtx.close);
    const oversized = await requestJson(shortLimitCtx.base, '/ai/polish', { method: 'POST', body: { content: 'x'.repeat(101), instruction: 'y' } });
    assert.equal(oversized.status, 413);
});

test('润色接口成功返回、未配置 503、上游故障 502', async (t) => {
    const ctx = await startServer({
        config: configuredConfig(),
        polishImpl: async ({ content, instruction }) => {
            assert.match(content, /# 原文档/);
            assert.equal(instruction, '更专业');
            return { markdown: '# 润色后\n更专业的正文。' };
        },
    });
    t.after(ctx.close);

    const ok = await requestJson(ctx.base, '/ai/polish', { method: 'POST', body: { content: '# 原文档', instruction: '更专业' } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).markdown, '# 润色后\n更专业的正文。');

    const statusConfig = await requestJson(ctx.base, '/ai/polish/config');
    assert.equal(statusConfig.status, 200);
    const configBody = await statusConfig.json();
    assert.equal(configBody.configured, true);
    assert.ok(!('apiKey' in configBody));
});

test('润色接口未配置时返回 503，CLI 故障返回 502', async (t) => {
    const ctx = await startServer({
        config: aiPolishConfig({}),
        polishImpl: async () => { throw new AiPolishError(503, '服务器未配置 Claude 接入信息（缺少 ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL）'); },
    });
    t.after(ctx.close);

    const notConfigured = await requestJson(ctx.base, '/ai/polish', { method: 'POST', body: { content: 'x', instruction: 'y' } });
    assert.equal(notConfigured.status, 503);
    assert.match((await notConfigured.json()).error, /未配置/);

    const status = await requestJson(ctx.base, '/ai/polish/config');
    assert.equal((await status.json()).configured, false);

    const brokenCtx = await startServer({
        config: configuredConfig(),
        polishImpl: async () => { throw new AiPolishError(502, 'claude CLI 执行失败：Error: model busy'); },
    });
    t.after(brokenCtx.close);

    const failed = await requestJson(brokenCtx.base, '/ai/polish', { method: 'POST', body: { content: 'x', instruction: 'y' } });
    assert.equal(failed.status, 502);
    assert.match((await failed.json()).error, /claude CLI/);
});

test('用户个人 AI 配置优先：服务器未配置时也算已配置，并报告个人模型', async (t) => {
    const ctx = await startServer({
        config: aiPolishConfig({}),
        polishImpl: async ({ config }) => {
            // 断言个人配置已合并进调用配置
            assert.equal(config.baseUrl, 'https://user-api.example');
            assert.equal(config.apiKey, 'user-key-1');
            assert.equal(config.model, 'user-model');
            return { markdown: '# 润色后' };
        },
    });
    t.after(ctx.close);

    // 给 tester 用户写入个人 AI 配置
    await new Promise((resolve, reject) => ctx.db.run(
        `INSERT INTO user_settings (userId, aiBaseUrl, aiApiKey, aiModel) VALUES (1, 'https://user-api.example/', 'user-key-1', 'user-model')`,
        (err) => err ? reject(err) : resolve()
    ));

    const status = await requestJson(ctx.base, '/ai/polish/config');
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.configured, true);
    assert.equal(statusBody.model, 'user-model');

    const ok = await requestJson(ctx.base, '/ai/polish', { method: 'POST', body: { content: 'x', instruction: 'y' } });
    assert.equal(ok.status, 200);
});

test('用户个人配置只覆盖已填写的字段，未填的字段回退服务器环境变量', async (t) => {
    const ctx = await startServer({
        config: configuredConfig({ model: 'server-model' }),
        polishImpl: async ({ config }) => {
            assert.equal(config.baseUrl, 'https://user-api.example');
            assert.equal(config.apiKey, 'sk-third-party'); // 服务器 Key，用户未填写
            assert.equal(config.model, 'server-model');     // 服务器模型，用户未填写
            return { markdown: '# 润色后' };
        },
    });
    t.after(ctx.close);

    await new Promise((resolve, reject) => ctx.db.run(
        `INSERT INTO user_settings (userId, aiBaseUrl, aiApiKey, aiModel) VALUES (1, 'https://user-api.example/', '', '')`,
        (err) => err ? reject(err) : resolve()
    ));

    const ok = await requestJson(ctx.base, '/ai/polish', { method: 'POST', body: { content: 'x', instruction: 'y' } });
    assert.equal(ok.status, 200);
});

test('runOpenAiCompatible：OpenAI 兼容直连 /chat/completions', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ choices: [{ message: { content: '# 润色后' } }] }) };
    };
    const result = await runOpenAiCompatible({
        prompt: '请润色',
        config: { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-ds-1', model: 'deepseek-chat' },
        fetchImpl,
    });
    assert.equal(result, '# 润色后');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer sk-ds-1');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.model, 'deepseek-chat');
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.stream, false);
});

test('runOpenAiCompatible：/v1 地址拼接、非 2xx 报 502、缺模型报 503', async () => {
    let url1 = '';
    await runOpenAiCompatible({
        prompt: 'x',
        config: { baseUrl: 'https://api.deepseek.com/v1/', apiKey: 'k', model: 'deepseek-chat' },
        fetchImpl: async (url) => { url1 = url; return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }; },
    });
    assert.equal(url1, 'https://api.deepseek.com/v1/chat/completions');

    await assert.rejects(
        runOpenAiCompatible({
            prompt: 'x',
            config: { baseUrl: 'https://api.deepseek.com', apiKey: 'k', model: 'deepseek-chat' },
            fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'invalid api key' }),
        }),
        (error) => error.status === 502 && /401/.test(error.message)
    );

    await assert.rejects(
        runOpenAiCompatible({ prompt: 'x', config: { baseUrl: 'https://api.deepseek.com', apiKey: 'k', model: '' } }),
        (error) => error.status === 503 && /模型名称/.test(error.message)
    );
});

test('runOpenAiCompatible：超时触发 AbortError 报 502', async () => {
    const fetchImpl = (_url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
        });
    });
    await assert.rejects(
        runOpenAiCompatible({ prompt: 'x', config: { baseUrl: 'https://api.deepseek.com', apiKey: 'k', model: 'deepseek-chat' }, fetchImpl, timeoutMs: 50 }),
        (error) => error.status === 502 && /超时/.test(error.message)
    );
});

test('polishDocument：protocol=openai 走 OpenAI 兼容通道，默认 anthropic 走 claude CLI', async () => {
    let used = '';
    const result = await polishDocument({
        content: '# 原文档',
        instruction: '更专业',
        config: { ...configuredConfig(), protocol: 'openai' },
        runCli: async () => { used = 'cli'; return 'x'; },
        runOpenAi: async () => { used = 'openai'; return '# 润色后'; },
    });
    assert.equal(used, 'openai');
    assert.equal(result.markdown, '# 润色后');

    used = '';
    await polishDocument({
        content: 'x',
        instruction: 'y',
        config: configuredConfig(),
        runCli: async () => { used = 'cli'; return 'ok'; },
        runOpenAi: async () => { used = 'openai'; return 'x'; },
    });
    assert.equal(used, 'cli');
});

test('fetchAvailableModels：anthropic 走 /v1/models 并带 x-api-key，openai 走 /models 并带 Bearer', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, headers: options.headers });
        return { ok: true, json: async () => ({ data: [
            { id: 'claude-sonnet-4-5' },
            { id: 'claude-opus-4-1' },
            { type: 'model', id: 'claude-3-5-haiku' },
        ] }) };
    };
    const r1 = await fetchAvailableModels({
        protocol: 'anthropic', baseUrl: '', apiKey: 'sk-ant-1', fetchImpl,
    });
    assert.equal(calls[0].url, 'https://api.anthropic.com/v1/models');
    assert.equal(calls[0].headers['x-api-key'], 'sk-ant-1');
    assert.equal(calls[0].headers['anthropic-version'], '2023-06-01');
    assert.deepEqual(r1.models, ['claude-3-5-haiku', 'claude-opus-4-1', 'claude-sonnet-4-5']);

    const r2 = await fetchAvailableModels({
        protocol: 'openai', baseUrl: 'https://api.deepseek.com/', apiKey: 'sk-ds-1', fetchImpl,
    });
    assert.equal(calls[1].url, 'https://api.deepseek.com/models');
    assert.equal(calls[1].headers.Authorization, 'Bearer sk-ds-1');
    assert.equal(calls[1].headers['x-api-key'], undefined);
    assert.deepEqual(r2.models, ['claude-3-5-haiku', 'claude-opus-4-1', 'claude-sonnet-4-5']);
});

test('fetchAvailableModels：缺 Key / 缺地址报 400，上游非 2xx 报 502', async () => {
    await assert.rejects(
        () => fetchAvailableModels({ protocol: 'anthropic', baseUrl: '', apiKey: '' }),
        (e) => e.status === 400 && /API Key/.test(e.message)
    );
    await assert.rejects(
        () => fetchAvailableModels({ protocol: 'openai', baseUrl: '', apiKey: 'k' }),
        (e) => e.status === 400 && /API 地址/.test(e.message)
    );
    await assert.rejects(
        () => fetchAvailableModels({
            protocol: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'bad',
            fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }),
        }),
        (e) => e.status === 502 && /401/.test(e.message)
    );
});

test('POST /ai/models：未登录 401，带表单配置返回模型列表', async (t) => {
    const ctx = await startServer({ config: configuredConfig() });
    t.after(ctx.close);

    const anon = await requestJson(ctx.base, '/ai/models', {
        method: 'POST', body: { protocol: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'k' }, token: null,
    });
    assert.equal(anon.status, 401);

    // 用一个自定义 fetch 拦截：startServer 里的 router 用的是全局 fetchImpl，
    // 这里直接验证路由鉴权 + 参数透传即可，实际模型拉取逻辑由上面单测覆盖。
    // 由于路由内部直接调全局 fetch，这里 mock 全局 fetch 一次。
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
        if (String(url).startsWith('http://127.0.0.1')) return originalFetch(url, options);
        assert.equal(String(url), 'https://api.deepseek.com/models');
        return { ok: true, json: async () => ({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }) };
    };
    try {
        const ok = await requestJson(ctx.base, '/ai/models', {
            method: 'POST', body: { protocol: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-real-1' },
        });
        assert.equal(ok.status, 200);
        const body = await ok.json();
        assert.deepEqual(body.models, ['deepseek-chat', 'deepseek-reasoner']);
    } finally {
        global.fetch = originalFetch;
    }
});