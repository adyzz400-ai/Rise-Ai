const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Accept funFact as a parameter so it doesn't change
function getProgressEmbed(stageIndex, funFact) {
    const stage = config.PROGRESS_STAGES[stageIndex];
    const fact = funFact || config.FUN_FACTS[0];
    
    const embed = new EmbedBuilder()
        .setColor(0x2D2D2D)
        .setTitle('Rise AI Maths - Logging In...') // Removed 'M'
        .setDescription('Securely connecting to your account •••')
        .addFields({ name: stage.text, value: '\u200b' })
        .setFooter({ text: `Fun Fact: ${fact}` }); // Static fact

    const spinnerPath = path.join(__dirname, '..', 'assets', 'spinner.gif');
    
    if (fs.existsSync(spinnerPath)) {
        const attachment = new AttachmentBuilder(spinnerPath, { name: 'spinner.gif' });
        embed.setThumbnail('attachment://spinner.gif');
        return { embed, files: [attachment] };
    } else {
        embed.setThumbnail('https://cdn.discordapp.com/emojis/833866931953057812.gif');
        return { embed, files: [] };
    }
}

module.exports = { getProgressEmbed };
