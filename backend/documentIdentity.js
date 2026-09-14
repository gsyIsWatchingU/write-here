const { randomBytes } = require('crypto');

const DOCUMENT_PUBLIC_ID_PATTERN = /^[a-f0-9]{32}$/;

function createDocumentPublicId() {
    return randomBytes(16).toString('hex');
}

function documentIdentifierParams(identifier) {
    const publicId = String(identifier || '').trim();
    const legacyId = /^\d+$/.test(publicId) ? Number.parseInt(publicId, 10) : -1;
    return [publicId, legacyId];
}

function migrateDocumentIdentity(db) {
    db.run('ALTER TABLE docs ADD COLUMN publicId TEXT', (error) => {
        if (error && !error.message.includes('duplicate column name')) {
            console.error('迁移文档 publicId 列失败:', error.message);
        }
    });
    db.run(`
        UPDATE docs
        SET publicId = lower(hex(randomblob(16)))
        WHERE publicId IS NULL OR publicId = ''
    `);
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_public_id ON docs(publicId)');
}

module.exports = {
    DOCUMENT_PUBLIC_ID_PATTERN,
    createDocumentPublicId,
    documentIdentifierParams,
    migrateDocumentIdentity,
};
