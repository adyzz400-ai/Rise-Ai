// queue/store.js
import fs from 'fs/promises';
import path from 'path';

const FILE_PATH = process.env.QUEUE_FILE_PATH || path.join(process.cwd(), 'queue.json');

export async function loadState() {
    try {
        const raw = await fs.readFile(FILE_PATH, 'utf-8');
        return JSON.parse(raw);
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        console.error('[Queue Store] Load error:', err.message);
        return null;
    }
}

export async function saveState(state) {
    try {
        const tmp = FILE_PATH + '.tmp';
        await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
        await fs.rename(tmp, FILE_PATH);
    } catch (err) {
        console.error('[Queue Store] Save error:', err.message);
    }
}
