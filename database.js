const Database = require('better-sqlite3');
const db = new Database('riseai.db');
const { log } = require('./logger');

db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
        discord_id TEXT, platform TEXT, login_type TEXT, school_name TEXT, school_id TEXT, username TEXT, password TEXT, is_saved INTEGER DEFAULT 0,
        PRIMARY KEY (discord_id, platform, username)
    );
    CREATE TABLE IF NOT EXISTS settings (
        discord_id TEXT PRIMARY KEY, timing_mode TEXT DEFAULT 'cautious', custom_seconds INTEGER DEFAULT 40
    );
    CREATE TABLE IF NOT EXISTS tasks (
        discord_id TEXT PRIMARY KEY, package_id TEXT, task_id TEXT, assignment_name TEXT, total_questions INTEGER, current_question INTEGER DEFAULT 0, total_tasks INTEGER, current_task INTEGER DEFAULT 1, message_id TEXT, channel_id TEXT
    );
`);

module.exports = {
    saveAccount: (discordId, platform, loginType, schoolName, schoolId, username, password, isSaved) => {
        log('INFO', `Saving account for user ${discordId}`, { platform, schoolName });
        db.prepare(`INSERT OR REPLACE INTO accounts VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(discordId, platform, loginType, schoolName, schoolId, username, password, isSaved ? 1 : 0);
    },
    getSavedAccounts: (discordId, platform) => db.prepare(`SELECT * FROM accounts WHERE discord_id = ? AND platform = ? AND is_saved = 1`).all(discordId, platform),
    getSettings: (discordId) => db.prepare(`SELECT * FROM settings WHERE discord_id = ?`).get(discordId) || { timing_mode: 'cautious', custom_seconds: 40 },
    updateSettings: (discordId, mode, seconds) => db.prepare(`INSERT OR REPLACE INTO settings VALUES (?, ?, ?)`).run(discordId, mode, seconds),
    saveTask: (discordId, pkgId, taskId, name, totalQ, totalT, msgId, chId) => {
        log('INFO', `Saving task for user ${discordId}`, { name, totalQ, totalT });
        db.prepare(`INSERT OR REPLACE INTO tasks VALUES (?, ?, ?, ?, ?, 0, ?, 1, ?, ?)`).run(discordId, pkgId, taskId, name, totalQ, totalT, msgId, chId);
    },
    getTask: (discordId) => db.prepare(`SELECT * FROM tasks WHERE discord_id = ?`).get(discordId),
    updateTaskProgress: (discordId, currentQ, currentT) => db.prepare(`UPDATE tasks SET current_question = ?, current_task = ? WHERE discord_id = ?`).run(currentQ, currentT, discordId),
    deleteTask: (discordId) => {
        log('INFO', `Deleting task for user ${discordId}`);
        db.prepare(`DELETE FROM tasks WHERE discord_id = ?`).run(discordId);
    }
};
