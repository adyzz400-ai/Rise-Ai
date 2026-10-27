const { EmbedBuilder, ActionRowBuilder, ButtonBuilder } = require('discord.js');

function getTaskProgressEmbed(task, currentQ, totalQ, currentT, totalT) {
    const embed = new EmbedBuilder()
        .setColor(0x2D2D2D)
        .setTitle('Rise AI Maths V2')
        .setDescription(`\`Solving question ${currentQ} of ${totalQ} in Task ${currentT}...\``)
        .addFields(
            { name: 'Maths Homework', value: 'Sparx Maths', inline: false },
            { name: `Tasks 1-${Math.min(5, totalT)} of ${totalT}`, value: buildTaskList(currentT, totalT, currentQ, totalQ), inline: false },
            { name: 'Time Spent:', value: '0 minutes', inline: true },
            { name: 'Progress:', value: `${currentT - 1}/${totalT} tasks complete`, inline: true }
        )
        .setFooter({ text: ' Rise AI - Maths automation ' });

    const r1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cancel_task').setLabel('Cancel').setStyle(4).setEmoji('❌')
    );

    return { embed, components: [r1] };
}

function buildTaskList(currentT, totalT, currentQ, totalQ) {
    let text = '';
    const maxShow = Math.min(5, totalT);
    
    for (let i = 1; i <= maxShow; i++) {
        let pct = 0;
        if (i < currentT) pct = 100;
        else if (i === currentT) pct = Math.round((currentQ / totalQ) * 100);
        
        const filled = Math.round(pct / 10);
        const empty = 10 - filled;
        const bar = '▓'.repeat(filled) + '░'.repeat(empty);
        
        text += `${i}. **Task ${i}**\n${bar} \`${pct}%\`\n\n`;
    }
    
    if (totalT > 5) text += `\n*...and ${totalT - 5} more tasks hidden.*`;
    return text;
}

module.exports = { getTaskProgressEmbed };
