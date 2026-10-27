const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../database');
const config = require('../config');
const { getProgressEmbed } = require('../embeds/progress');
const { getTaskSelectEmbed } = require('../embeds/taskSelect');
const { fastLoginAndFetch } = require('../sparx');
const { log } = require('../logger');

const pendingLogins = new Map();

function getPlatformSelectMessage() {
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Select Platform & Login Method').setDescription('Choose how you want to login to Sparx Maths.');
    const select = new StringSelectMenuBuilder()
        .setCustomId('platform_select')
        .setPlaceholder('Select platform and login method')
        .addOptions(config.PLATFORMS.map(p => ({
            label: p.label,
            description: p.value === 'sparx_normal' ? 'Direct username/password login' : p.value === 'sparx_microsoft' ? 'Login with Microsoft/Office 365' : 'Login with Google account',
            value: p.value
        })));
    return { embed, components: [new ActionRowBuilder().addComponents(select)] };
}

function getJoinQueueModal() {
    const modal = new ModalBuilder().setCustomId('join_queue_modal').setTitle('Join Queue');
    modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('school').setLabel('Enter School (Sparx only)').setStyle(TextInputStyle.Short).setPlaceholder('Heston Community School').setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('username').setLabel('Username/Email *').setStyle(TextInputStyle.Short).setPlaceholder('johnsmith or john@example.com').setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('password').setLabel('Password *').setStyle(TextInputStyle.Short).setPlaceholder('••••••••').setRequired(true))
    );
    return modal;
}

async function handlePlatformSelect(interaction) {
    pendingLogins.set(interaction.user.id, interaction.values[0]);
    log('INFO', `User ${interaction.user.id} selected platform: ${interaction.values[0]}`);
    await interaction.showModal(getJoinQueueModal());
}

async function handleJoinQueueSubmit(interaction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    
    const schoolName = interaction.fields.getTextInputValue('school');
    const username = interaction.fields.getTextInputValue('username');
    const password = interaction.fields.getTextInputValue('password');
    const platform = pendingLogins.get(interaction.user.id) || 'sparx_normal';
    const loginType = platform.split('_')[1];

    log('INFO', `User ${interaction.user.id} submitted login modal for ${schoolName}`);
    db.saveAccount(interaction.user.id, 'sparx_maths', loginType, schoolName, null, username, password, true);

    const funFact = config.FUN_FACTS[Math.floor(Math.random() * config.FUN_FACTS.length)];

    // Show progress stages with REAL login steps
    let msg = await interaction.editReply({ content: null, embeds: [], files: [] });
    
    for (let i = 0; i < 7; i++) {
        const { embed, files } = getProgressEmbed(i, funFact);
        await msg.edit({ embeds: [embed], files: files });
        
        // Wait between stages (but the actual login happens during this time)
        if (i < 6) {
            await new Promise(r => setTimeout(r, 1500));
        }
    }

    // NOW actually perform the login with real progress callbacks
    const assignments = await fastLoginAndFetch(username, password, schoolName, async (stage) => {
        // Update the embed with real progress
        const { embed, files } = getProgressEmbed(stage, funFact);
        await msg.edit({ embeds: [embed], files: files });
    });
    
    if (!assignments) {
        log('ERROR', `Login failed for user ${interaction.user.id}`);
        await msg.edit({ content: '❌ Login failed. Check your credentials.', embeds: [], files: [] });
        return;
    }

    // Only show success AFTER login actually succeeds
    await msg.edit({ content: '✅ Account saved for next time.', embeds: [], files: [] });
    const { embed: taskEmbed, components: taskComponents } = getTaskSelectEmbed(username, assignments);
    await interaction.followUp({ embeds: [taskEmbed], components: taskComponents, flags: [MessageFlags.Ephemeral] });
    pendingLogins.delete(interaction.user.id);
}

module.exports = { getPlatformSelectMessage, getJoinQueueModal, handlePlatformSelect, handleJoinQueueSubmit };
