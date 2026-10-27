const { EmbedBuilder, ActionRowBuilder, ButtonBuilder } = require('discord.js');

function getMainMenu() {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Rise AI Tutoring Platform')
        .setDescription('Your gateway to personalised homework assistance.\nUse Rise AI to work across multiple study platforms.\nPress **Join Queue** below to connect an account.')
        .addFields({ name: 'Notes', value: '• Get help with homework across supported platforms\n• Start a session or use a saved account\n• Account details are stored securely' })
        .setTimestamp();

    const r1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('join_queue').setLabel('Join Queue').setStyle(1),
        new ButtonBuilder().setCustomId('join_queue_saved').setLabel('Join Queue with Saved Accounts').setStyle(2)
    );
    const r2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('check_queue').setLabel('Check Queue').setStyle(2),
        new ButtonBuilder().setCustomId('tutorials').setLabel('Tutorials').setStyle(2)
    );
    const r3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('view_slots').setLabel('View Slots').setStyle(2),
        new ButtonBuilder().setCustomId('history').setLabel('History').setStyle(2)
    );
    const r4 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('settings').setLabel('Settings').setStyle(1)
    );
    const r5 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('feedback').setLabel('Feedback & Suggestions').setStyle(2)
    );

    return { embed, components: [r1, r2, r3, r4, r5] };
}

module.exports = { getMainMenu };
