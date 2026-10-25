// queue/manager.js
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { loadState, saveState } from './store.js';

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_JOBS || '1', 10);
const RATE_LIMIT_PER_HOUR = parseInt(process.env.RATE_LIMIT_PER_HOUR || '2', 10);

export class QueueManager extends EventEmitter {
    constructor() {
        super();
        this.jobs = new Map();
        this.order = [];
        this.active = new Set();
        this.runner = null;
        this._ready = false;
    }

    async init(runner) {
        this.runner = runner;
        const saved = await loadState();
        if (saved) {
            for (const job of saved.jobs) {
                if (job.status === 'running' || job.status === 'paused') {
                    job.status = 'queued';
                    job.startedAt = null;
                }
                this.jobs.set(job.id, job);
                if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
                    this.order.push(job.id);
                }
            }
        }
        this._ready = true;
        this._sortOrder();
        this._processQueue();
    }

    _sortOrder() {
        this.order.sort((a, b) => {
            const ja = this.jobs.get(a), jb = this.jobs.get(b);
            if (!ja || !jb) return 0;
            if (jb.priority !== ja.priority) return jb.priority - ja.priority;
            return ja.enqueuedAt - jb.enqueuedAt;
        });
    }

    async _persist() {
        await saveState({
            jobs: Array.from(this.jobs.values()),
            order: this.order,
            active: Array.from(this.active),
            savedAt: Date.now()
        });
    }

    _userJobCount(userId) {
        const cutoff = Date.now() - 3600_000;
        let n = 0;
        for (const job of this.jobs.values()) {
            if (job.userId !== userId) continue;
            if (job.enqueuedAt < cutoff) continue;
            if (job.status === 'cancelled') continue;
            n++;
        }
        return n;
    }

    async addJob({ userId, pkgId, pkgName, tasks, timeConfig, priority = 0, dmChannelId }) {
        if (this._userJobCount(userId) >= RATE_LIMIT_PER_HOUR) {
            return { ok: false, error: `Rate limit: max ${RATE_LIMIT_PER_HOUR} jobs per hour.` };
        }

        for (const job of this.jobs.values()) {
            if (job.userId === userId && job.pkgId === pkgId &&
                ['queued', 'running', 'paused'].includes(job.status)) {
                return { ok: false, error: 'You already have an active job for this package.' };
            }
        }

        const supported = tasks.filter(t => t.isSupported);
        const total = supported.reduce((s, t) => s + (t.itemCount || 1), 0);
        const job = {
            id: randomUUID(),
            userId,
            pkgId,
            pkgName,
            tasks,
            timeConfig,
            priority,
            status: 'queued',
            progress: { done: 0, total, currentTask: 0, currentItem: 0 },
            enqueuedAt: Date.now(),
            startedAt: null,
            completedAt: null,
            dmChannelId: dmChannelId || null,
            error: null
        };

        this.jobs.set(job.id, job);
        this.order.push(job.id);
        this._sortOrder();
        await this._persist();
        this.emit('job:enqueued', job);
        this._processQueue();
        return { ok: true, job, position: this.getPosition(job.id) };
    }

    getPosition(jobId) {
        const idx = this.order.indexOf(jobId);
        return idx === -1 ? -1 : idx + 1;
    }

    getUserJobs(userId) {
        return Array.from(this.jobs.values()).filter(j => j.userId === userId);
    }

    getStats() {
        let queued = 0, running = 0, paused = 0, completed = 0, failed = 0;
        for (const job of this.jobs.values()) {
            if (job.status === 'queued') queued++;
            else if (job.status === 'running') running++;
            else if (job.status === 'paused') paused++;
            else if (job.status === 'completed') completed++;
            else if (job.status === 'failed') failed++;
        }
        return { queued, running, paused, completed, failed, activeSlots: this.active.size, maxSlots: MAX_CONCURRENT };
    }

    async pauseJob(jobId, userId) {
        const job = this.jobs.get(jobId);
        if (!job) return { ok: false, error: 'Job not found.' };
        if (job.userId !== userId) return { ok: false, error: 'Not your job.' };
        if (job.status !== 'running') return { ok: false, error: `Cannot pause a ${job.status} job.` };
        job.status = 'paused';
        await this._persist();
        this.emit('job:paused', job);
        return { ok: true };
    }

    async resumeJob(jobId, userId) {
        const job = this.jobs.get(jobId);
        if (!job) return { ok: false, error: 'Job not found.' };
        if (job.userId !== userId) return { ok: false, error: 'Not your job.' };
        if (job.status !== 'paused') return { ok: false, error: `Cannot resume a ${job.status} job.` };
        job.status = 'running';
        await this._persist();
        this.emit('job:resumed', job);
        return { ok: true };
    }

    async cancelJob(jobId, userId) {
        const job = this.jobs.get(jobId);
        if (!job) return { ok: false, error: 'Job not found.' };
        if (job.userId !== userId) return { ok: false, error: 'Not your job.' };
        if (['completed', 'failed', 'cancelled'].includes(job.status)) return { ok: false, error: 'Job finished.' };
        if (job.status === 'queued') {
            const idx = this.order.indexOf(jobId);
            if (idx !== -1) this.order.splice(idx, 1);
        }
        job.status = 'cancelled';
        job.completedAt = Date.now();
        this.active.delete(jobId);
        await this._persist();
        this.emit('job:cancelled', job);
        this._processQueue();
        return { ok: true };
    }

    async markCompleted(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) return;
        job.status = 'completed';
        job.completedAt = Date.now();
        this.active.delete(jobId);
        await this._persist();
        this.emit('job:completed', job);
        this._processQueue();
    }

    async markFailed(jobId, error) {
        const job = this.jobs.get(jobId);
        if (!job) return;
        job.status = 'failed';
        job.error = error?.message || String(error);
        this.active.delete(jobId);
        await this._persist();
        this.emit('job:failed', job);
        this._processQueue();
    }

    async updateProgress(jobId, { done, currentTask, currentItem }) {
        const job = this.jobs.get(jobId);
        if (!job) return;
        job.progress.done = done;
        job.progress.currentTask = currentTask;
        job.progress.currentItem = currentItem;
        this.emit('job:progress', job);
        if (done % 10 === 0) await this._persist();
    }

    async _processQueue() {
        if (!this._ready || !this.runner) return;
        if (this.active.size >= MAX_CONCURRENT) return;

        while (this.order.length > 0 && this.active.size < MAX_CONCURRENT) {
            const nextId = this.order[0];
            const job = this.jobs.get(nextId);
            if (!job || job.status !== 'queued') {
                this.order.shift();
                continue;
            }

            this.order.shift();
            job.status = 'running';
            job.startedAt = Date.now();
            this.active.add(nextId);
            await this._persist();
            this.emit('job:started', job);

            (async () => {
                try {
                    await this.runner(job);
                    if (job.status === 'running') await this.markCompleted(job.id);
                } catch (err) {
                    console.error(`[Queue] Job ${job.id} crashed:`, err);
                    await this.markFailed(job.id, err);
                }
            })();
        }
    }
}

export const queue = new QueueManager();
