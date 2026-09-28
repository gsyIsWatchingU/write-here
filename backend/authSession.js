function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}

async function authenticateSession(db, req) {
    const header = req.get('authorization') || '';
    const cookieHeader = req.get('cookie') || '';
    const cookies = Object.fromEntries(cookieHeader.split(';').map((part) => {
        const [name, ...rest] = part.trim().split('=');
        return [name, decodeURIComponent(rest.join('='))];
    }).filter(([name]) => name));
    const token = header.startsWith('Bearer ')
        ? header.slice(7).trim()
        : (cookies.horizon_session || '');
    if (!token) return null;
    return get(db, `
        SELECT users.id, COALESCE(users.displayName, users.username) AS username,
               users.email, users.ssoSubject, users.displayName, users.isAdmin
        FROM sessions JOIN users ON users.id = sessions.userId
        WHERE sessions.token = ? AND sessions.expiresAt > CURRENT_TIMESTAMP
    `, [token]);
}

module.exports = { authenticateSession };
