// solver.js
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { generateProgressImage } from './utils/canvas.js';
import { solveQuestion } from './api/gemini.js';
import { queue } from './queue/manager.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function extractAnswerInfo(layoutContent) {
    let partId = null;
    let fieldId = null;
    let inputType = 'text';
    let options = null;
    let slots = [];
    let cards = [];

    function traverse(node) {
        if (!node) return;

        if (node.element === 'group' && node.type && node.type.includes('cards')) {
            node.content.forEach(c => {
                if (c.element === 'card') {
                    cards.push({ ref: c.ref, text: c.content[0]?.text || '' });
                }
            });
        }

        if (node.type && node.type.includes('answer-part')) {
            partId = node.id;
            const findFields = (child) => {
                if (!child) return;
                if (child.element === 'number-field') { fieldId = child.ref; inputType = 'number'; }
                else if (child.element === 'text-field') { fieldId = child.ref; inputType = 'text'; }
                else if (child.element === 'slot') { slots.push(child.ref); inputType = 'cards'; }
                else if (child.element === 'group' && child.type && child.type.includes('choices')) {
                    inputType = 'choice';
                    options = child.content.map(c => ({ ref: c.ref, text: c.content[0]?.text || '' }));
                }
                if (child.content) child.content.forEach(findFields);
            };
            findFields(node);
        }
        if (node.content) node.content.forEach(traverse);
    }
    traverse(layoutContent);
    return { partId, fieldId, inputType, options, slots, cards };
}

export class HomeworkSolver {
    constructor(sparxClient, job, dmChannel) {
        this.client = sparxClient;
        this.job = job;
        this.dm = dmChannel;
        this.startTime = Date.now();
    }

    async checkPause() {
        while (this.job.status === 'paused') {
            await sleep(1000);
            if (this.job.status === 'cancelled') return false;
        }
        return this.job.status !== 'cancelled';
    }

    formatTime(ms) {
        const mins = Math.floor(ms / 60000);
        const hours = Math.floor(mins / 60);
        return `${hours}h ${mins % 60}m`;
    }

    async start() {
        const supportedTasks = this.job.tasks.filter(t => t.isSupported);
        const canvasTasks = supportedTasks.map(t => ({
            name: t.name,
            progress: 0,
            done: 0,
            total: t.itemCount || 1,
            accuracy: 100
        }));

        const totalItems = canvasTasks.reduce((s, t) => s + t.total, 0);
        const xpGained = this.job.tasks._totalXp || 0;
        let done = 0;

        const initialBuf = generateProgressImage(this.job.pkgName, 'In Progress', 0, totalItems, canvasTasks, 0, '0h 0m', 'High');
        const embed = new EmbedBuilder()
            .setTitle('Rise Ai — Live Progress')
            .setColor(0x5865F2)
            .setImage('attachment://progress.png')
            .setFooter({ text: `Job ${this.job.id.slice(0, 8)}` });

        const msg = await this.dm.send({
            embeds: [embed],
            files: [new AttachmentBuilder(initialBuf, { name: 'progress.png' })]
        });

        for (let ti = 0; ti < supportedTasks.length; ti++) {
            const task = supportedTasks[ti];
            const cTask = canvasTasks[ti];

            for (let item = 1; item <= cTask.total; item++) {
                if (!(await this.checkPause())) {
                    await msg.edit({ content: 'Job cancelled.', files: [] }).catch(() => {});
                    return;
                }

                try {
                    const activity = await this.client.getActivity(this.job.pkgId, task.id, item);
                    if (!activity || !activity.layout) continue;

                    const q = activity.layout.content.find(c => c.type?.includes('question'));
                    const questionText = q?.content?.[0]?.content?.[0]?.text || '';
                    if (!questionText) continue;

                    const { partId, fieldId, inputType, options, slots, cards } = extractAnswerInfo(activity.layout.content);
                    if (!partId) continue;

                    let fieldsToSubmit = [];

                    if (inputType === 'cards') {
                        const promptText = `Question: ${questionText}\nCards: ${cards.map(c => `${c.ref}: ${c.text}`).join(', ')}\nSlots: ${slots.join(', ')}`;
                        const answerJson = await solveQuestion(promptText, cards, 'cards');
                        if (!answerJson) continue;
                        
                        try {
                            const mapping = JSON.parse(answerJson);
                            for (const slot of slots) {
                                if (mapping[slot]) {
                                    fieldsToSubmit.push({ field_id: slot, value: mapping[slot] });
                                }
                            }
                        } catch (e) {
                            console.error('Failed to parse card mapping:', answerJson);
                            continue;
                        }
                    } else {
                        if (!fieldId) continue;
                        const answer = await solveQuestion(questionText, options, inputType);
                        if (!answer) continue;

                        let finalValue = answer;
                        if (inputType === 'choice' && options) {
                            const match = options.find(o => o.text.toLowerCase().includes(answer.toLowerCase()) || answer.toLowerCase().includes(o.text.toLowerCase()));
                            if (match) finalValue = match.ref;
                        }
                        fieldsToSubmit.push({ field_id: fieldId, value: finalValue });
                    }

                    const wait = Math.floor(Math.random() * (this.job.timeConfig.max - this.job.timeConfig.min + 1) + this.job.timeConfig.min) * 1000;
                    const end = Date.now() + wait;
                    while (Date.now() < end) {
                        if (!(await this.checkPause())) {
                            await msg.edit({ content: 'Job cancelled.', files: [] }).catch(() => {});
                            return;
                        }
                        await sleep(Math.min(1000, end - Date.now()));
                    }

                    await this.client.submitAnswer(activity.activityId, partId, fieldsToSubmit);

                    done++;
                    cTask.done++;
                    cTask.progress = Math.min(100, Math.floor((cTask.done / cTask.total) * 100));

                    await queue.updateProgress(this.job.id, { done, currentTask: ti, currentItem: item });

                    if (done % 5 === 0 || item === cTask.total) {
                        const timeSpent = this.formatTime(Date.now() - this.startTime);
                        const currentXp = Math.floor((done / totalItems) * xpGained);
                        
                        const buf = generateProgressImage(this.job.pkgName, 'In Progress', done, totalItems, canvasTasks, currentXp, timeSpent, 'High');
                        await msg.edit({ files: [new AttachmentBuilder(buf, { name: 'progress.png' })] }).catch(() => {});
                    }
                } catch (err) {
                    console.error(`Task ${task.name} item ${item} failed:`, err.message);
                }
            }
        }

        canvasTasks.forEach(t => { t.progress = 100; t.done = t.total; });
        const finalBuf = generateProgressImage(this.job.pkgName, 'Completed', totalItems, totalItems, canvasTasks, xpGained, this.formatTime(Date.now() - this.startTime), 'High');
        
        await msg.edit({
            content: `✅ Homework complete. Earned **${xpGained} XP**.`,
            files: [new AttachmentBuilder(finalBuf, { name: 'progress.png' })]
        }).catch(() => {});
    }
}
