// index.js
import 'dotenv/config';
import {
    Client, GatewayIntentBits, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    StringSelectMenuBuilder
} from 'discord.js';
import { getSparxSession } from './api/auth.js';
import { SparxClient } from './api/sparx.js';
import { HomeworkSolver } from './solver.js';
import { queue } from './queue/manager.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages] });
const sessions = new Map();
const timeSettings = new Map();

function queueEmbed(userId) {
    const stats = queue.getStats();
    const userJobs = queue.getUserJobs(userId).filter(j => ['queued', 'running', 'paused'].includes(j.status));
    const embed = new EmbedBuilder()
        .setTitle('Rise Ai — Queue')
        .setColor(0x5865F2)
        .addFields(
            { name: '🎯 Active Slots', value: `${stats.activeSlots}/${stats.maxSlots}`, inline: true },
            { name: '⏳ Queued', value: `${stats.queued}`, inline: true },
            { name: '⏸ Paused', value: `${stats.paused}`, inline: true },
            { name: '✅ Completed', value: `${stats.completed}`, inline: true },
            { name: '❌ Failed', value: `${stats.failed}`, inline: true }
        );

    if (userJobs.length === 0) {
        embed.setDescription('You have no active jobs.');
    } else {
        embed.setDescription(userJobs.map(j => {
            const pos = j.status === 'queued' ? ` (position ${queue.getPosition(j.id)})` : '';
            return `• **${j.pkgName}** — ${j.status}${pos}`;
        }).join('\n'));
    }
    return embed;
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Initialize the queue system with the solver
    await queue.init(async (job) => {
        const session = sessions.get(job.userId);
        if (!session) throw new Error('Session expired. Please log in again.');
        const dm = await client.users.fetch(job.userId).then(u => u.createDM());
        const solver = new HomeworkSolver(session.sparx, job, dm);
        await solver.start();
    });

    // DM Notifications
    queue.on('job:started', async job => {
        try { 
            const u = await client.users.fetch(job.userId); 
            const dm = await u.createDM(); 
            await dm.send(`▶️ Your job **${job.pkgName}** is now running.`); 
        } catch {}
    });
    
    queue.on('job:completed', async job => {
        try { 
            const u = await client.users.fetch(job.userId); 
            const dm = await u.createDM(); 
            await dm.send(`✅ Your job **${job.pkgName}** completed: ${job.progress.done}/${job.progress.total}.`); 
        } catch {}
    });
    
    queue.on('job:failed', async job => {
        try { 
            const u = await client.users.fetch(job.userId); 
            const dm = await u.createDM(); 
            await dm.send(`❌ Your job **${job.pkgName}** failed: ${job.error}`); 
        } catch {}
    });

    // Post Main Panel
    const channel = client.channels.cache.get(process.env.PANEL_CHANNEL_ID);
    if (!channel) return console.warn('Panel channel missing.');

    const messages = await channel.messages.fetch({ limit: 5 });
    if (messages.some(m => m.author.id === client.user.id && m.components.length)) return;

    const embed = new EmbedBuilder()
        .setTitle('Rise Ai — Homework Automation')
        .setDescription('Click Login to authenticate.')
        .setColor(0x5865F2);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('login').setLabel('Login').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('view_queue').setLabel('View Queue').setStyle(ButtonStyle.Secondary)
    );
    await channel.send({ embeds: [embed], components: [row] });
});

client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        if (interaction.customId === 'login') {
            const modal = new ModalBuilder().setCustomId('login_modal').setTitle('Sparx Maths Login');
            const school = new TextInputBuilder().setCustomId('school').setLabel('School name').setStyle(TextInputStyle.Short).setRequired(true);
            const user = new TextInputBuilder().setCustomId('username').setLabel('Username').setStyle(TextInputStyle.Short).setRequired(true);
            const pass = new TextInputBuilder().setCustomId('password').setLabel('Password').setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(
                new ActionRowBuilder().addComponents(school),
                new ActionRowBuilder().addComponents(user),
                new ActionRowBuilder().addComponents(pass)
            );
            return interaction.showModal(modal);
        }

        if (interaction.customId === 'view_queue') {
            const refreshRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('view_queue').setLabel('Refresh').setStyle(ButtonStyle.Secondary)
            );
            return interaction.reply({ embeds: [queueEmbed(interaction.user.id)], components: [refreshRow], ephemeral: true });
        }

        if (interaction.customId === 'time') {
            const modal = new ModalBuilder().setCustomId('time_modal').setTitle('Time Settings');
            const preset = new StringSelectMenuBuilder()
                .setCustomId('preset')
                .setPlaceholder('Pacing preset')
                .addOptions([
                    { label: 'Cautious (1h–1h30)', value: '3600_5400' },
                    { label: 'Secure (30m–1h)', value: '1800_3600' },
                    { label: 'Fast (15m–30m)', value: '900_1800' },
                    { label: 'Quick (5m–15m)', value: '300_900' }
                ]);
            const custom = new TextInputBuilder().setCustomId('custom').setLabel('Custom seconds').setStyle(TextInputStyle.Short).setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(preset), new ActionRowBuilder().addComponents(custom));
            return interaction.showModal(modal);
        }

        if (interaction.customId.startsWith('pause_') || interaction.customId.startsWith('resume_') || interaction.customId.startsWith('cancel_')) {
            const [action, jobId] = interaction.customId.split('_');
            let result;
            if (action === 'pause') result = await queue.pauseJob(jobId, interaction.user.id);
            else if (action === 'resume') result = await queue.resumeJob(jobId, interaction.user.id);
            else result = await queue.cancelJob(jobId, interaction.user.id);
            return interaction.reply({ content: result.ok ? `Job ${action}d.` : result.error, ephemeral: true });
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'login_modal') {
            const school = interaction.fields.getTextInputValue('school');
            const username = interaction.fields.getTextInputValue('username');
            const password = interaction.fields.getTextInputValue('password');

            await interaction.reply({ content: 'Starting login process...', ephemeral: true });
            const msg = await interaction.fetchReply();

            let lastUpdate = 0;
            const onProgress = async (status) => {
                const now = Date.now();
                // Throttle edits to avoid Discord API rate limits (1 per 1.5s)
                if (now - lastUpdate < 1500 && !status.includes('complete') && !status.includes('failed')) return;
                lastUpdate = now;
                await msg.edit({ content: `**Rise Ai — Login Status**\n> ${status}` }).catch(() => {});
            };

            try {
                const session = await getSparxSession(username, password, school, onProgress);
                const sparx = new SparxClient(session.token, session.cfClearance);
                sessions.set(interaction.user.id, { sparx, homeworks: session.homeworks });

                if (session.homeworks.length === 0) throw new Error('No homework found on dashboard.');

                const selectEmbed = new EmbedBuilder().setTitle('Select Homework').setColor(0x57F287);
                const selectRow = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('hw_select')
                        .setPlaceholder('Choose homework...')
                        .addOptions(session.homeworks.slice(0, 25).map(p => ({
                            label: p.name.substring(0, 100),
                            description: `Due: ${p.dueDate.substring(0, 50)} | Accuracy: ${p.accuracy.substring(0, 50)}`,
                            value: p.id
                        })))
                );
                const timeBtn = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('time').setLabel('Time Settings').setStyle(ButtonStyle.Secondary)
                );
                
                await interaction.editReply({ content: 'Authenticated!', embeds: [selectEmbed], components: [selectRow, timeBtn] });
            } catch (err) {
                // TRUNCATE ERROR: Discord rejects content > 2000 chars.
                const errorMsg = `Login failed: ${err.message}`.substring(0, 1900);
                await interaction.editReply({ content: errorMsg }).catch(() => {});
            }
        }

        if (interaction.customId === 'time_modal') {
            const preset = interaction.fields.getStringSelectValues('preset')[0];
            const custom = interaction.fields.getTextInputValue('custom');
            let min, max;
            if (custom && !isNaN(parseInt(custom))) min = max = parseInt(custom);
            else if (preset) [min, max] = preset.split('_').map(Number);
            timeSettings.set(interaction.user.id, { min, max });
            await interaction.reply({ content: `Time set: ${min}s – ${max}s.`, ephemeral: true });
        }
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'hw_select') {
            const pkgId = interaction.values[0];
            const session = sessions.get(interaction.user.id);
            if (!session) return interaction.reply({ content: 'Session expired.', ephemeral: true });

            const time = timeSettings.get(interaction.user.id) || { min: 300, max: 900 };
            const hwMeta = session.homeworks.find(h => h.id === pkgId);
            await interaction.reply({ content: 'Loading package structure...', ephemeral: true });

            try {
                const tasks = await session.sparx.getPackage(pkgId);
                const dm = await interaction.user.createDM();

                const result = await queue.addJob({
                    userId: interaction.user.id,
                    pkgId,
                    pkgName: hwMeta.name,
                    tasks,
                    timeConfig: time,
                    dmChannelId: dm.id
                });

                if (!result.ok) return interaction.editReply({ content: `❌ ${result.error}` });

                const supported = tasks.filter(t => t.isSupported);
                const total = supported.reduce((s, t) => s + (t.itemCount || 1), 0);
                const skipped = tasks.length - supported.length;

                const jobRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`pause_${result.job.id}`).setLabel('Pause').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`cancel_${result.job.id}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
                );

                const embed = new EmbedBuilder()
                    .setTitle('Job Queued')
                    .setColor(0x57F287)
                    .addFields(
                        { name: 'Job ID', value: `\`${result.job.id.slice(0, 8)}\``, inline: true },
                        { name: 'Package', value: hwMeta.name.substring(0, 100), inline: true },
                        { name: 'Active Tasks', value: `${supported.length} (${skipped} skipped)`, inline: true },
                        { name: 'Questions', value: `${total}`, inline: true },
                        { name: 'Position', value: `#${result.position}`, inline: true },
                        { name: 'ETA', value: result.position <= queue.getStats().maxSlots ? 'Starting now' : `${result.position - queue.getStats().activeSlots} jobs ahead`, inline: true }
                    );

                await interaction.editReply({ embeds: [embed], components: [jobRow] });
            } catch (e) {
                const errorMsg = `Failed to load package: ${e.message}`.substring(0, 1900);
                await interaction.editReply({ content: errorMsg });
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
