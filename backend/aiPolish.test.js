const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { AiPolishError, aiPolishConfig, buildPolishPrompt, createAiPolishRouter, polishDocument, runClaudeCli } = require('./aiPolish');

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
