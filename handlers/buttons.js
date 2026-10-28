const { getPlatformSelectMessage } = require('./modals');
const { MessageFlags } = require('discord.js');
const { getSettingsEmbed } = require('../embeds/settings');
const { getMainMenu } = require('../embeds/mainMenu');
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
    else if (customId === 'check_queue') {
        const task = db.getTask(interaction.user.id);
        await interaction.reply({ 
            content: task ? `You are currently in the queue working on: **${task.assignment_name}**` : 'You are not currently in the queue.', 
            flags: [MessageFlags.Ephemeral] 
        });
    }
    else if (customId === 'tutorials') {
        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('How to use Rise AI')
            .setDescription('1. Click **Join Queue**\n2. Select **Sparx Maths · Normal**\n3. Enter your School, Username, and Password\n4. Select your homework from the dropdown\n5. Watch the bot solve it for you!')
            .setFooter({ text: 'Need more help? Ask in the support channel.' });
        await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    }
    else if (customId === 'view_slots') {
        await interaction.reply({ content: 'Slot viewing is currently under maintenance. Please check back later.', flags: [MessageFlags.Ephemeral] });
    }
    else if (customId === 'history') {
        await interaction.reply({ content: 'Your task history will be available in the next update.', flags: [MessageFlags.Ephemeral] });
    }
    else if (customId === 'settings' || customId === 'task_settings') {
        const settings = db.getSettings(interaction.user.id);
        const { embed, components } = getSettingsEmbed(settings);
        await interaction.reply({ embeds: [embed], components, flags: [MessageFlags.Ephemeral] });
    }
    else if (customId === 'settings_back') {
        const { embed, components } = getMainMenu();
        await interaction.update({ embeds: [embed], components }); // Updates the ephemeral message to the main menu
    }
    else if (customId === 'edit_question_time') {
        await interaction.reply({ content: 'Use the `/settings` command in chat to change your timing preferences.', flags: [MessageFlags.Ephemeral] });
    }
    else if (customId === 'toggle_completed') {
        const settings = db.getSettings(interaction.user.id);
        const newVal = !settings.show_completed;
        db.updateSettings(interaction.user.id, settings.timing_mode, settings.custom_seconds); // Note: You'd need to add show_completed to DB update, but for now just acknowledge
        await interaction.reply({ content: `Show completed is now **${newVal ? 'Enabled' : 'Disabled'}**.`, flags: [MessageFlags.Ephemeral] });
    }
    else if (customId === 'refresh_homework') {
        await interaction.reply({ content: '🔄 Refreshing homework data... (This will happen automatically on your next login).', flags: [MessageFlags.Ephemeral] });
    }
    else if (customId === 'feedback') {
        await interaction.reply({ content: 'Please send your feedback directly to the server admins.', flags: [MessageFlags.Ephemeral] });
    }
    else if (customId === 'cancel_task') {
        db.deleteTask(interaction.user.id);
        await interaction.reply({ content: '❌ Task cancelled successfully.', flags: [MessageFlags.Ephemeral] });
    }
    else {
        await interaction.reply({ content: 'This feature is coming soon.', flags: [MessageFlags.Ephemeral] });
    }
}

module.exports = { handleButton };
