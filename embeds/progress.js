const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const config = require('../config');

function getProgressEmbed(stageIndex) {
    const stage = config.PROGRESS_STAGES[stageIndex];
    const fact = config.FUN_FACTS[Math.floor(Math.random() * config.FUN_FACTS.length)];
    
    // 1. Attach the local GIF
    const spinnerPath = path.join(__dirname, '..', 'assets', 'spinner.gif');
    const attachment = new AttachmentBuilder(spinnerPath, { name: 'spinner.gif' });

    const embed = new EmbedBuilder()
        .setColor(0x2D2D2D)
        .setTitle('M Rise AI Maths - Logging In...')
        .setDescription('Securely connecting to your account •••')
        
        // 2. This puts the animated GIF in the TOP RIGHT corner next to the title!
        .setThumbnail('attachment://spinner.gif') 
        
        .addFields({ name: stage.text, value: '\u200b' })
        .setFooter({ text: `Fun Fact:\n${fact}` });

    // We must return the file attachment so Discord can render it
    return { embed, files: [attachment] }; 
}

module.exports = { getProgressEmbed };
