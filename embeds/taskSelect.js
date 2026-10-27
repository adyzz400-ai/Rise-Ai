const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder } = require('discord.js');

function getTaskSelectEmbed(username, assignments) {
    const embed = new EmbedBuilder()
        .setColor(0x2D2D2D)
        .setAuthor({ name: username })
        .addFields(
            { name: 'Question time:', value: 'Cautious (about 1 hour in total)', inline: false },
            { name: 'Platform:', value: 'M Sparx Maths', inline: false }
        );

    const select = new StringSelectMenuBuilder()
        .setCustomId('select_assignment')
        .setPlaceholder('Select an assignment')
        .addOptions(assignments.map(a => ({
            label: a.name.length > 100 ? a.name.substring(0, 97) + '...' : a.name,
            description: `${a.percentComplete}% Due ${a.dueText}`,
            value: a.id
        })));

    const r1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('task_settings').setLabel('Settings').setStyle(2).setEmoji('⚙️')
    );
    const r2 = new ActionRowBuilder().addComponents(select);
    const r3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prev').setStyle(2).setEmoji('◀️'),
        new ButtonBuilder().setCustomId('page').setLabel('1/1').setStyle(2).setDisabled(true),
        new ButtonBuilder().setCustomId('next').setStyle(2).setEmoji('▶️')
    );
    const r4 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('start_task').setLabel('Independent Learning').setStyle(1).setEmoji('📋')
    );

    return { embed, components: [r1, r2, r3, r4] };
}

module.exports = { getTaskSelectEmbed };
