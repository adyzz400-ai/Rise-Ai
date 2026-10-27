const { getPlatformSelectMessage } = require('./modals');
const { MessageFlags } = require('discord.js');
const db = require('../database');
const { log } = require('../logger');

async function handleButton(interaction) {
    const { customId } = interaction;
    log('INFO', `Button clicked: ${customId} by user ${interaction.user.id}`);
    
    if (customId === 'join_queue') {
        const { embed, components } = getPlatformSelectMessage();
        await interaction.reply({ embeds: [embed], components, flags: [MessageFlags.Ephemeral] });
    } 
    else if (customId === 'join_queue_saved') {
        const accounts = db.getSavedAccounts(interaction.user.id, 'sparx_maths');
        if (accounts.length === 0) {
            await interaction.reply({ content: 'No saved accounts found. Use Join Queue first.', flags: [MessageFlags.Ephemeral] });
        } else {
            await interaction.reply({ content: 'Saved accounts feature coming soon.', flags: [MessageFlags.Ephemeral] });
        }
    }
    else if (customId === 'cancel_task') {
        db.deleteTask(interaction.user.id);
        await interaction.reply({ content: '❌ Task cancelled.', flags: [MessageFlags.Ephemeral] });
    }
    else if (customId === 'settings' || customId === 'task_settings') {
        await interaction.reply({ content: '⚙️ Settings menu opened.', flags: [MessageFlags.Ephemeral] });
    }
    else if (customId === 'check_queue') {
        const task = db.getTask(interaction.user.id);
        await interaction.reply({ 
            content: task ? `You are in the queue. Task: ${task.assignment_name}` : 'You are not in the queue.', 
            flags: [MessageFlags.Ephemeral] 
        });
    }
    else {
        await interaction.reply({ content: 'Button clicked.', flags: [MessageFlags.Ephemeral] });
    }
}

module.exports = { handleButton };
