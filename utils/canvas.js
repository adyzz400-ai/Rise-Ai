// utils/canvas.js
// @napi-rs/canvas ^0.1.44 — pure Rust renderer, no system dependencies required.
import { createCanvas } from '@napi-rs/canvas';

export function generateProgressImage(name, status, done, total, tasks, xpGained = 0, timeSpent = 'Calculating...', accuracy = 'High') {
    const taskBlockH = 100;
    const headerH = 200;
    const footerH = 220;
    const width = 800;
    const height = headerH + (tasks.length * taskBlockH) + footerH;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Base layout and left border
    ctx.fillStyle = '#232428';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#5865F2';
    ctx.fillRect(0, 0, 8, height);

    // Header text
    ctx.fillStyle = '#5865F2';
    ctx.font = 'bold 28px Arial';
    ctx.fillText(`SenAI Maths ${name}`, 30, 50);

    ctx.fillStyle = '#DCDDDE';
    ctx.font = '20px Arial';
    ctx.fillText(`Name: ${name}`, 30, 100);
    ctx.fillText(`Status: ${status} (${done} questions)`, 30, 130);
    ctx.fillText(`Page: 1 of ${tasks.length}`, 30, 160);

    // Task bars
    let y = 220;
    tasks.forEach((t, i) => {
        ctx.fillStyle = '#DCDDDE';
        ctx.font = '20px Arial';
        ctx.fillText(`${i + 1}. ${t.name}`, 30, y);

        // Accuracy Pill
        ctx.strokeStyle = '#4F545C';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(200, y - 20, 80, 30, 6);
        ctx.stroke();
        ctx.fillText(`${t.accuracy}%`, 215, y);

        // Progress Bar Outline
        const barY = y + 30;
        ctx.strokeStyle = '#5865F2';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(30, barY, 740, 20, 10);
        ctx.stroke();

        // Progress Bar Fill
        const fill = 736 * (t.progress / 100);
        if (fill > 0) {
            ctx.fillStyle = '#5865F2';
            ctx.beginPath();
            ctx.roundRect(32, barY + 2, fill, 16, 8);
            ctx.fill();
        }
        y += taskBlockH;
    });

    // Footer stats
    ctx.fillStyle = '#DCDDDE';
    ctx.font = '20px Arial';
    ctx.fillText(`Questions Completed: ${done}/${total}`, 30, y + 30);
    ctx.fillText(`Time spent: ${timeSpent}`, 30, y + 65);
    ctx.fillText(`Question Time: 30s – 100s`, 30, y + 100);
    ctx.fillText(`Bookwork Accuracy: ${accuracy}`, 30, y + 135);
    ctx.fillText(`XP Gained: ${xpGained}`, 30, y + 170);

    return canvas.toBuffer('image/png');
}
