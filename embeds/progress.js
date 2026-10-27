const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const config = require('../config');

function getProgressEmbed(stageIndex) {
    const stage = config.PROGRESS_STAGES[stageIndex];
    const fact = config.FUN_FACTS[Math.floor(Math.random() * config.FUN_FACTS.length)];
    
    const embed = new EmbedBuilder()
        .setColor(0x2D2D2D)
        .setTitle('M Rise AI Maths - Logging In...')
        .setDescription('Securely connecting to your account •••')
        .addFields({ name: stage.text, value: '\u200b' })
        .setFooter({ text: `Fun Fact:\n${fact}` });

    const spinnerPath = path.join(__dirname, '..', 'assets', 'spinner.gif');
    
    // SAFE CHECK: Only attach your custom GIF if it actually exists on the server
    if (fs.existsSync(spinnerPath)) {
        const attachment = new AttachmentBuilder(spinnerPath, { name: 'spinner.gif' });
        embed.setThumbnail('attachment://spinner.gif');
        return { embed, files: [attachment] };
    } else {
        // Fallback: Use a generic loading GIF if you haven't uploaded yours yet
        embed.setThumbnail('https://cdn.discordapp.com/emojis/833866931953057812.gif');
        return { embed, files: [] };
    }
}

module.exports = { getProgressEmbed };
