const express = require('express');
const { createHash } = require('crypto');
const { mkdirSync, existsSync, renameSync, writeFileSync, unlinkSync } = require('node:fs');
const path = require('node:path');
const { authenticateSession } = require('./problems');

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
// 像素上限：10 MB 挡不住「图片炸弹」——几 MB 的压缩图可能解码成上亿像素的位图，
// 前端解码时直接把标签页拖死。宽高由客户端读取后随请求带上来，这里只做上限校验。
const DEFAULT_MAX_PIXELS = 80_000_000;
const UPLOAD_URL_PREFIX = '/uploads/';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * 按文件头判断图片真实类型，不信任客户端给的 Content-Type。
 * @param {Buffer} buffer
 * @returns {{ ext: string, mime: string } | null}
 */
function detectImageType(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return { ext: 'png', mime: 'image/png' };
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return { ext: 'jpg', mime: 'image/jpeg' };
    }
    const ascii6 = buffer.toString('latin1', 0, 6);
    if (ascii6 === 'GIF87a' || ascii6 === 'GIF89a') {
        return { ext: 'gif', mime: 'image/gif' };
    }
    // WebP：RIFF....WEBP
    if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
        return { ext: 'webp', mime: 'image/webp' };
    }
    return null;
}

/** 内容寻址：同图重复上传落同一个文件，并按 hash 前两位分片避免单目录过万 */
function storagePathFor(sha256, ext) {
    return path.posix.join(String(sha256).slice(0, 2), String(sha256).slice(2, 4), `${sha256}.${ext}`);
}

function normalizeDimension(raw) {
    const value = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.min(value, 100000);
}

/**
 * 落盘。先写 .tmp 再 rename：直接写最终路径时，另一个请求可能正好读到半个文件。
 * @returns {{ created: boolean, absolutePath: string }}
 */
function writeImageAtomic(dir, relPath, buffer) {
    const absolutePath = path.join(dir, relPath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    if (existsSync(absolutePath)) return { created: false, absolutePath };

    const tmpPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmpPath, buffer);
    try {
        renameSync(tmpPath, absolutePath);
    } catch (error) {
        try { unlinkSync(tmpPath); } catch { /* 清理失败不影响主流程 */ }
        // 并发上传同一张图时，另一个进程可能刚 rename 完；只要最终文件在就当作成功
        if (!existsSync(absolutePath)) throw error;
    }
    return { created: true, absolutePath };
}

function migrateImages(db) {
    db.run(`
        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sha256 TEXT NOT NULL UNIQUE,
            relPath TEXT NOT NULL,
            mime TEXT NOT NULL,
            byteSize INTEGER NOT NULL,
            width INTEGER NOT NULL DEFAULT 0,
            height INTEGER NOT NULL DEFAULT 0,
            uploadedBy INTEGER,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

function createImageUploadRouter({
    db,
    uploadDir = path.join(__dirname, '../db/uploads'),
    maxBytes = DEFAULT_MAX_BYTES,
    maxPixels = DEFAULT_MAX_PIXELS,
} = {}) {
    const router = express.Router();
    mkdirSync(uploadDir, { recursive: true });

    router.post(
        '/images/upload',
        express.raw({ type: [...ACCEPTED_TYPES, 'application/octet-stream'], limit: maxBytes }),
        async (req, res) => {
            const user = await authenticateSession(db, req);
            if (!user) return res.status(401).json({ error: '登录已过期，请重新登录' });

            const buffer = Buffer.isBuffer(req.body) ? req.body : null;
            if (!buffer || buffer.length === 0) return res.status(400).json({ error: '缺少图片数据' });
            if (buffer.length > maxBytes) {
                return res.status(413).json({ error: `图片超过 ${Math.round(maxBytes / 1024 / 1024)} MB 上限` });
            }

            const type = detectImageType(buffer);
            if (!type) return res.status(400).json({ error: '只支持 PNG、JPEG、WebP 和 GIF 图片' });

            const width = normalizeDimension(req.get('x-image-width'));
            const height = normalizeDimension(req.get('x-image-height'));
            if (width && height && width * height > maxPixels) {
                return res.status(413).json({ error: '图片像素过大，请压缩后再上传' });
            }

            const sha256 = createHash('sha256').update(buffer).digest('hex');
            const relPath = storagePathFor(sha256, type.ext);

            let created = false;
            try {
                created = writeImageAtomic(uploadDir, relPath, buffer).created;
            } catch (error) {
                console.error('图片落盘失败:', error.message);
                return res.status(500).json({ error: '图片保存失败，请重试' });
            }

            try {
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT OR IGNORE INTO images (sha256, relPath, mime, byteSize, width, height, uploadedBy)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [sha256, relPath, type.mime, buffer.length, width, height, user.id],
                        (err) => (err ? reject(err) : resolve())
                    );
                });
            } catch (error) {
                // 元数据写失败不影响已落盘的文件，下次上传会补录；只记录日志
                console.error('图片元数据写入失败:', error.message);
            }

            res.json({
                url: `${UPLOAD_URL_PREFIX}${relPath.split(path.sep).join('/')}`,
                width,
                height,
                byteSize: buffer.length,
                mime: type.mime,
                sha256,
                deduped: !created,
            });
        }
    );

    // express.raw 超限会抛错进这里；默认错误处理返回 HTML，前端拿不到可读信息
    router.use((error, req, res, next) => {
        if (!error) return next();
        const status = error.status || error.statusCode || 500;
        if (status === 413 || error.type === 'entity.too.large') {
            return res.status(413).json({ error: `图片超过 ${Math.round(maxBytes / 1024 / 1024)} MB 上限` });
        }
        if (status === 400 || error.type === 'entity.parse.failed') {
            return res.status(400).json({ error: '图片数据无法解析' });
        }
        return res.status(status).json({ error: '图片上传失败' });
    });

    return router;
}

module.exports = {
    ACCEPTED_TYPES,
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_PIXELS,
    UPLOAD_URL_PREFIX,
    createImageUploadRouter,
    detectImageType,
    migrateImages,
    normalizeDimension,
    storagePathFor,
    writeImageAtomic,
};
