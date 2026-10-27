require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { getMainMenu } = require('./embeds/mainMenu');
const { handleButton } = require('./handlers/buttons');
const { handleSelect } = require('./handlers/selects');
const { handleJoinQueueSubmit } = require('./handlers/modals');
const { log } = require('./logger');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
let mainMenuMsgId = null;

client.once(Events.ClientReady, async () => {
    log('INFO', `Rise AI Online as ${client.user.tag}`);
    const channel = client.channels.cache.get(process.env.STATUS_CHANNEL_ID);
    if (channel) await postMainMenu(channel);
});

async function postMainMenu(channel) {
    if (mainMenuMsgId) {
        try {
            const old = await channel.messages.fetch(mainMenuMsgId);
            await old.delete();
            log('INFO', 'Deleted old main menu message');
        } catch (e) { log('WARN', 'Old main menu not found'); }
    }
    const { embed, components } = getMainMenu();
    const msg = await channel.send({ embeds: [embed], components });
    mainMenuMsgId = msg.id;
    log('INFO', 'Posted new main menu');
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
            await interaction.reply({ content: '❌ An error occurred.', ephemeral: true }).catch(() => {});
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
