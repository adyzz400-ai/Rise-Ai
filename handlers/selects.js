const { handlePlatformSelect } = require('./modals');
const db = require('../database');
const config = require('../config');
const { getTaskProgressEmbed } = require('../embeds/taskProgress');
const { runAutomation } = require('../sparx');
const { log } = require('../logger');

async function handleSelect(interaction) {
    if (interaction.customId === 'platform_select') {
        await handlePlatformSelect(interaction);
    }
    
    if (interaction.customId === 'select_assignment') {
        const assignmentId = interaction.values[0];
        const settings = db.getSettings(interaction.user.id);
        const waitTime = config.TIMING_MODES[settings.timing_mode]?.seconds || settings.custom_seconds || 60;
        log('INFO', `User ${interaction.user.id} selected assignment ${assignmentId} with wait time ${waitTime}s`);
        
        await interaction.reply({ content: 'You have been added to the queue', ephemeral: true });
        
        const totalTasks = 8; 
        const totalQuestionsPerTask = 9; 
        const taskData = { assignmentName: 'Homework', totalTasks, currentTask: 1, totalQuestions: totalQuestionsPerTask, currentQuestion: 1, started_at: Date.now() };
        
        const { embed, components } = getTaskProgressEmbed(taskData, 1, totalQuestionsPerTask, 1, totalTasks);
        const progressMsg = await interaction.channel.send({ embeds: [embed], components, ephemeral: true });
        
        db.saveTask(interaction.user.id, 'pkg_id', assignmentId, 'Homework', totalQuestionsPerTask, totalTasks, progressMsg.id, interaction.channel.id);
        runMultiTaskLoop(interaction.user.id, progressMsg, waitTime);
    }
}

async function runMultiTaskLoop(userId, message, waitTime) {
    const task = db.getTask(userId);
    if (!task) return;

    for (let t = 1; t <= task.total_tasks; t++) {
        db.updateTaskProgress(userId, 0, t);
        for (let q = 1; q <= task.total_questions; q++) {
            db.updateTaskProgress(userId, q, t);
            const { embed, components } = getTaskProgressEmbed(task, q, task.total_questions, t, task.total_tasks);
            await message.edit({ embeds: [embed], components });
            await new Promise(r => setTimeout(r, waitTime * 1000));
        }
    }
    log('INFO', `All tasks completed for user ${userId}`);
    db.deleteTask(userId);
    await message.edit({ content: '✅ All tasks completed successfully!', embeds: [], components: [] });
}

module.exports = { handleSelect };
