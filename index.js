require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { getMainMenu } = require('./embeds/mainMenu');
const { handleButton } = require('./handlers/buttons');
const { handleSelect } = require('./handlers/selects');
const { handleJoinQueueSubmit } = require('./handlers/modals');
const { log } = require('./logger');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once(Events.ClientReady, async () => {
    log('INFO', `Rise AI Online as ${client.user.tag}`);
    const channel = client.channels.cache.get(process.env.STATUS_CHANNEL_ID);
    if (channel) await postMainMenu(channel);
});

async function postMainMenu(channel) {
    try {
        // 1. Fetch the last 10 messages in the channel
        const messages = await channel.messages.fetch({ limit: 10 });
        
        // 2. Find any message sent by THIS bot with the title "Rise AI Tutoring Platform"
        const oldMessages = messages.filter(m => 
            m.author.id === client.user.id && 
            m.embeds.length > 0 && 
            m.embeds[0].title === 'Rise AI Tutoring Platform'
        );

        // 3. Delete all old main menus found
        for (const msg of oldMessages.values()) {
            await msg.delete().catch(() => {});
            log('INFO', 'Deleted old main menu message');
        }

        // 4. Post the fresh main menu
        const { embed, components } = getMainMenu();
        await channel.send({ embeds: [embed], components });
        log('INFO', 'Posted new main menu');
        
    } catch (error) {
        log('ERROR', 'Failed to post main menu', { error: error.message });
    }
}

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (interaction.isButton()) await handleButton(interaction);
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'platform_select') {
                const { handlePlatformSelect } = require('./handlers/modals');
                await handlePlatformSelect(interaction);
            } else {
                await handleSelect(interaction);
            }
        }
        if (interaction.isModalSubmit() && interaction.customId === 'join_queue_modal') {
            await handleJoinQueueSubmit(interaction);
        }
    } catch (error) {
        log('ERROR', 'Unhandled interaction error', { error: error.message, customId: interaction.customId });
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ An error occurred.', flags: [require('discord.js').MessageFlags.Ephemeral] }).catch(() => {});
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
