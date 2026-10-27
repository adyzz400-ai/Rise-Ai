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
        
        // Generate Fun Fact ONCE
        const funFact = config.FUN_FACTS[Math.floor(Math.random() * config.FUN_FACTS.length)];
        
        await interaction.reply({ content: 'You have been added to the queue. Check DMs/Channel for progress.', flags: [require('discord.js').MessageFlags.Ephemeral] });
        
        const totalTasks = 1; // Default for now
        const totalQuestionsPerTask = 9; 
        
        const taskData = { 
            assignmentName: 'Homework', 
            totalTasks, 
            currentTask: 1, 
            totalQuestions: totalQuestionsPerTask, 
            currentQuestion: 1, 
            started_at: Date.now() 
        };
        
        // Send initial embed
        const { embed, components } = getTaskProgressEmbed(taskData, 1, totalQuestionsPerTask, 1, totalTasks, funFact);
        const progressMsg = await interaction.channel.send({ embeds: [embed], components });
        
        db.saveTask(interaction.user.id, 'pkg_id', assignmentId, 'Homework', totalQuestionsPerTask, totalTasks, progressMsg.id, interaction.channel.id);
        
        // Start REAL automation
        // Note: You must have the user's credentials in the DB to pass them here
        const account = db.getSavedAccounts(interaction.user.id, 'sparx_maths')[0];
        if (!account) {
            await progressMsg.edit({ content: '❌ Account details missing.', embeds: [], components: [] });
            return;
        }

        runAutomation(account, waitTime, async (currentQ, currentT, totalQ, totalT) => {
            // This callback runs every time a question is solved
            db.updateTaskProgress(interaction.user.id, currentQ, currentT);
            const { embed: newEmbed, components: newComponents } = getTaskProgressEmbed(taskData, currentQ, totalQ, currentT, totalT, funFact);
            await progressMsg.edit({ embeds: [newEmbed], components: newComponents });
        });
    }
}

module.exports = { handleSelect };
