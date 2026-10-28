const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder } = require('discord.js');
const config = require('../config');

function getSettingsEmbed(settings) {
    const timingInfo = config.TIMING_MODES[settings.timing_mode] || config.TIMING_MODES.cautious;
    
    const embed = new EmbedBuilder()
        .setColor(0x2D2D2D)
        .setTitle('⚙️ Settings')
        .setDescription('Customize your Rise AI Maths experience')
        .addFields(
            { name: '⏱️ Question Time', value: `**${timingInfo.label}**\n${timingInfo.desc}`, inline: true },
            { name: '👁️ Show Completed', value: settings.show_completed ? '**Enabled**\nList finished homework too' : '**Disabled**\nHide finished homework', inline: true }
        )
        .setFooter({ text: 'Rise AI Maths V2' });

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('settings_back').setLabel('Back to Main Menu').setStyle(2).setEmoji('↩️')
    );

    const editTimeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('edit_question_time').setLabel('Edit Question Time').setStyle(1).setEmoji('⏱️')
    );

    const toggleCompletedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('toggle_completed').setLabel(settings.show_completed ? 'Disable Completed' : 'Enable Completed').setStyle(settings.show_completed ? 4 : 3).setEmoji('👁️')
    );

    const refreshRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('refresh_homework').setLabel('Refresh Homework Data').setStyle(2).setEmoji('🔄')
    );

    return { 
        embed, 
        components: [backRow, editTimeRow, toggleCompletedRow, refreshRow] 
    };
}

module.exports = { getSettingsEmbed };
