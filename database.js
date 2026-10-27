const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

const dbPath = path.join(__dirname, 'riseai.json');

// Initialize database file if it doesn't exist
if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({
        accounts: [],
        settings: {},
        tasks: {}
    }, null, 2));
}

function readDb() {
    try {
        const data = fs.readFileSync(dbPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        log('ERROR', 'Failed to read database', { error: error.message });
        return { accounts: [], settings: {}, tasks: {} };
    }
}

function writeDb(data) {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (error) {
        log('ERROR', 'Failed to write database', { error: error.message });
    }
}

module.exports = {
    saveAccount: (discordId, platform, loginType, schoolName, schoolId, username, password, isSaved) => {
        log('INFO', `Saving account for user ${discordId}`, { platform, schoolName });
        const db = readDb();
        // Remove existing account for this user/platform/username to avoid duplicates
        db.accounts = db.accounts.filter(a => !(a.discord_id === discordId && a.platform === platform && a.username === username));
        db.accounts.push({ 
            discord_id: discordId, 
            platform, 
            login_type: loginType, 
            school_name: schoolName, 
            school_id: schoolId, 
            username, 
            password, 
            is_saved: isSaved ? 1 : 0 
        });
        writeDb(db);
    },
    
    getSavedAccounts: (discordId, platform) => {
        const db = readDb();
        return db.accounts.filter(a => a.discord_id === discordId && a.platform === platform && a.is_saved === 1);
    },
    
    getSettings: (discordId) => {
        const db = readDb();
        return db.settings[discordId] || { timing_mode: 'cautious', custom_seconds: 40 };
    },
    
    updateSettings: (discordId, mode, seconds) => {
        const db = readDb();
        db.settings[discordId] = { timing_mode: mode, custom_seconds: seconds };
        writeDb(db);
    },
    
    saveTask: (discordId, pkgId, taskId, name, totalQ, totalT, msgId, chId) => {
        log('INFO', `Saving task for user ${discordId}`, { name, totalQ, totalT });
        const db = readDb();
        db.tasks[discordId] = {
            package_id: pkgId, 
            task_id: taskId, 
            assignment_name: name,
            total_questions: totalQ, 
            current_question: 0, 
            total_tasks: totalT, 
            current_task: 1,
            message_id: msgId, 
            channel_id: chId
        };
        writeDb(db);
    },
    
    getTask: (discordId) => {
        const db = readDb();
        return db.tasks[discordId] || null;
    },
    
    updateTaskProgress: (discordId, currentQ, currentT) => {
        const db = readDb();
        if (db.tasks[discordId]) {
            db.tasks[discordId].current_question = currentQ;
            db.tasks[discordId].current_task = currentT;
            writeDb(db);
        }
    },
    
    deleteTask: (discordId) => {
        log('INFO', `Deleting task for user ${discordId}`);
        const db = readDb();
        delete db.tasks[discordId];
        writeDb(db);
    }
};
