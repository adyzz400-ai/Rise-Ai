const fs = require('fs');
const path = require('path');
const logFile = path.join(__dirname, 'riseai.log');

function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}${data ? ' | ' + JSON.stringify(data) : ''}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(logFile, logMessage);
}

module.exports = { log };
