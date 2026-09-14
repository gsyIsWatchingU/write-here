const express = require('express');

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(error) {
            if (error) reject(error);
            else resolve({ changes: this.changes, lastID: this.lastID });
        });
    });
}

function migrateDocumentOrder(db) {
    return run(db, 'ALTER TABLE docs ADD COLUMN sortOrder INTEGER').catch((error) => {
        if (!error.message.includes('duplicate column name')) throw error;
    });
}

function normalizeDocumentIds(value) {
    if (!Array.isArray(value)) return null;
    const ids = value.map((id) => Number.parseInt(id, 10));
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return null;
    if (new Set(ids).size !== ids.length) return null;
    return ids;
}

function createDocumentOrderRouter({ db }) {
    const router = express.Router();

    router.put('/docs/order', async (req, res) => {
        const userId = Number.parseInt(req.body.userId, 10);
        const documentIds = normalizeDocumentIds(req.body.documentIds);
        if (!Number.isInteger(userId) || userId <= 0 || !documentIds) {
            return res.status(400).json({ error: '文档排序参数无效' });
        }

        try {
            const ownedDocuments = await all(
                db,
                "SELECT id FROM docs WHERE userId = ? AND kind = 'document'",
                [userId]
            );
            const ownedIds = new Set(ownedDocuments.map((document) => Number(document.id)));
            if (ownedIds.size !== documentIds.length || documentIds.some((id) => !ownedIds.has(id))) {
                return res.status(400).json({ error: '排序列表必须包含全部个人文档' });
            }

            await run(db, 'BEGIN IMMEDIATE');
            try {
                for (const [index, documentId] of documentIds.entries()) {
                    await run(
                        db,
                        "UPDATE docs SET sortOrder = ? WHERE id = ? AND userId = ? AND kind = 'document'",
                        [index, documentId, userId]
                    );
                }
                await run(db, 'COMMIT');
            } catch (error) {
                await run(db, 'ROLLBACK').catch(() => {});
                throw error;
            }

            res.json({ documentIds });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

module.exports = {
    createDocumentOrderRouter,
    migrateDocumentOrder,
    normalizeDocumentIds,
};
