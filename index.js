const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

const app = express();
const PORT = process.env.PORT || 3000;

let bumpData = {
    lastBumpTime: null,
    cooldownTimeout: null,
    reminderSent: false,
    lastBumpMessageId: null
};

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const BUMP_CHANNEL_ID = process.env.BUMP_CHANNEL_ID;
const BUMP_ROLE_ID = process.env.BUMP_ROLE_ID;
const COOLDOWN_DURATION = 120 * 60 * 1000;

client.once('ready', async () => {
    console.log(`✅ Bot is online as ${client.user.tag}`);
    console.log(`📡 Monitoring channel: ${BUMP_CHANNEL_ID}`);
    console.log(`🔔 Will mention role: ${BUMP_ROLE_ID}`);
    await checkForRecentBumps();
});

async function checkForRecentBumps() {
    try {
        const channel = client.channels.cache.get(BUMP_CHANNEL_ID);
        if (!channel) return console.log('❌ Could not find bump channel');

        const messages = await channel.messages.fetch({ limit: 50 });
        const knownBumpBots = [
            '302050872383242240', '716390085896962058', '450100127256936458', '1382299188095746088'
        ];
        const bumpBotPatterns = [
            /bump done|bumped|bump successful/i,
            /server bumped/i,
            /bump complete/i,
            /successfully bumped/i
        ];

        let latestBumpMessage = null;

        for (const message of messages.values()) {
            if (message.author.bot && knownBumpBots.includes(message.author.id)) {
                let isBumpMessage = false;
                if (message.content && bumpBotPatterns.some(p => p.test(message.content))) isBumpMessage = true;
                if (message.embeds.length) {
                    for (const embed of message.embeds) {
                        if ((embed.title && bumpBotPatterns.some(p => p.test(embed.title))) ||
                            (embed.description && bumpBotPatterns.some(p => p.test(embed.description)))) {
                            isBumpMessage = true;
                            break;
                        }
                    }
                }
                if (isBumpMessage) {
                    latestBumpMessage = message;
                    break;
                }
            }
        }

        if (latestBumpMessage) {
            const bumpTime = latestBumpMessage.createdTimestamp;
            const timeElapsed = Date.now() - bumpTime;
            const timeRemaining = COOLDOWN_DURATION - timeElapsed;

            if (timeRemaining > 0) {
                bumpData.lastBumpTime = bumpTime;
                bumpData.lastBumpMessageId = latestBumpMessage.id;
                bumpData.reminderSent = false;
                bumpData.cooldownTimeout = setTimeout(async () => {
                    await sendBumpReminder(channel);
                }, timeRemaining);

                const startupEmbed = new EmbedBuilder()
                    .setColor('#FFA500')
                    .setTitle('🔄 Bot Restarted - Cooldown Resumed')
                    .setDescription('Found recent bump and resumed cooldown tracking.')
                    .addFields(
                        { name: '⏰ Next Bump Available', value: `<t:${Math.floor((bumpTime + COOLDOWN_DURATION) / 1000)}:R>` },
                        { name: '🤖 Last Bump By', value: `${latestBumpMessage.author.tag}` }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'Cooldown resumed from previous session' });

                await channel.send({ embeds: [startupEmbed] });

            } else {
                const recentMessages = await channel.messages.fetch({ limit: 10 });
                const hasReminder = recentMessages.some(msg =>
                    msg.author.id === client.user.id &&
                    msg.embeds.some(embed => embed.title?.includes('Bump Reminder')) &&
                    (Date.now() - msg.createdTimestamp) < (COOLDOWN_DURATION + 300000)
                );

                if (!hasReminder) await sendBumpReminder(channel);
                else bumpData.reminderSent = true;
            }
        }
    } catch (e) { console.error('Error checking for recent bumps:', e); }
}

client.on('messageCreate', async (message) => {
    if (message.channel.id !== BUMP_CHANNEL_ID) return;
    if (!message.author.bot && message.content.startsWith('!')) return handleBotCommands(message);
    if (message.author.bot) return detectBumpBotResponse(message);
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.channel.id !== BUMP_CHANNEL_ID) return;
    if (interaction.isCommand() && interaction.commandName === 'bump') {
        await handleBumpDetection(interaction.channel, interaction.user, null);
    }
});

async function handleBumpDetection(channel, author, message) {
    bumpData.lastBumpTime = Date.now();
    bumpData.lastBumpMessageId = message?.id || null;
    bumpData.reminderSent = false;
    if (bumpData.cooldownTimeout) clearTimeout(bumpData.cooldownTimeout);
    bumpData.cooldownTimeout = setTimeout(async () => {
        await sendBumpReminder(channel);
    }, COOLDOWN_DURATION);
    console.log(`⏱️ New bump tracked at ${new Date(bumpData.lastBumpTime).toISOString()}`);
}

async function detectBumpBotResponse(message) {
    const knownBumpBots = [
        '302050872383242240', '716390085896962058', '450100127256936458', '1382299188095746088'
    ];
    const bumpBotPatterns = [
        /bump done|bumped|bump successful/i,
        /server bumped/i,
        /bump complete/i,
        /successfully bumped/i
    ];

    if (knownBumpBots.includes(message.author.id)) {
        const content = message.content || '';
        let isMatch = bumpBotPatterns.some(pattern => pattern.test(content));

        let embedText = '';
        if (message.embeds.length) {
            for (const embed of message.embeds) {
                embedText += `${embed.title || ''} ${embed.description || ''} `;
            }
        }
        isMatch = isMatch || bumpBotPatterns.some(p => p.test(embedText));

        if (isMatch) {
            console.log(`🚀 Detected bump from bot: ${message.author.tag}`);
            await handleBumpDetection(message.channel, message.author, message);
        }
    }
}

async function sendBumpReminder(channel) {
    if (bumpData.reminderSent) return;

    const reminderEmbed = new EmbedBuilder()
        .setColor('#FF6B35')
        .setTitle('🔔 Bump Reminder!')
        .setDescription('It\'s time to bump the server again!')
        .addFields(
            { name: '📝 How to Bump', value: 'Use `/bump` command to bump the server' },
            { name: '⏱️ Cooldown', value: '120 minutes from last bump' },
            { name: '📍 Channel', value: `${channel}` }
        )
        .setImage('https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif')
        .setTimestamp()
        .setFooter({ text: 'Don\'t forget to bump! 🚀' });

    await channel.send({
        content: `<@&${BUMP_ROLE_ID}> Time to bump! 🚀`,
        embeds: [reminderEmbed]
    });

    bumpData.reminderSent = true;
    bumpData.lastBumpTime = null;
    bumpData.cooldownTimeout = null;
    bumpData.lastBumpMessageId = null;
}

async function handleBotCommands(message) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    if (command === 'cooldown') return handleCooldownCommand(message);
    if (command === 'help') return handleHelpCommand(message);
}

async function handleCooldownCommand(message) {
    try {
        if (!bumpData.lastBumpTime) {
            const embed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('⚠️ No Recent Bump')
                .setDescription('No bump command has been detected yet.')
                .addFields({ name: '📝 Next Step', value: 'Use `/bump` to start the cooldown timer' })
                .setTimestamp();
            return message.reply({ embeds: [embed], ephemeral: true });
        }

        const timeElapsed = Date.now() - bumpData.lastBumpTime;
        const timeRemaining = COOLDOWN_DURATION - timeElapsed;

        if (timeRemaining <= 0) {
            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('✅ Bump Available!')
                .setDescription('The server is ready to be bumped again!')
                .addFields({ name: '📝 Action', value: 'Use `/bump` command now' })
                .setTimestamp();
            return message.reply({ embeds: [embed], ephemeral: true });
        }

        const nextBumpTime = Math.floor((bumpData.lastBumpTime + COOLDOWN_DURATION) / 1000);
        const embed = new EmbedBuilder()
            .setColor('#FF4444')
            .setTitle('⏰ Bump Cooldown Active')
            .setDescription('The server is still on cooldown.')
            .addFields(
                { name: '⏱️ Time Remaining', value: `<t:${nextBumpTime}:R>` },
                { name: '🕐 Available At', value: `<t:${nextBumpTime}:F>` }
            )
            .setTimestamp();
        return message.reply({ embeds: [embed], ephemeral: true });
    } catch (e) { console.error('Error in cooldown command:', e); }
}

async function handleHelpCommand(message) {
    try {
        const embed = new EmbedBuilder()
            .setColor('#4A90E2')
            .setTitle('🤖 Bump Bot Help')
            .setDescription('Here are the available commands and features:')
            .addFields(
                { name: '🚀 `/bump`', value: 'Bump the server (slash command)' },
                { name: '⏰ `!cooldown`', value: 'Check remaining cooldown time' },
                { name: '❓ `!help`', value: 'Show this help message' },
                { name: '🔄 **Auto Features**', value: '• Automatic bump detection\n• 120-minute cooldown tracking\n• Reminder notifications' },
                { name: '📍 **Channel**', value: `This bot only works in <#${BUMP_CHANNEL_ID}>` }
            )
            .setTimestamp()
            .setFooter({ text: 'Bump Bot v1.0' });
        await message.reply({ embeds: [embed], ephemeral: true });
    } catch (e) { console.error('Error in help command:', e); }
}

app.get('/', (req, res) => {
    res.json({ status: 'Bot is running!', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', bot: client.user ? 'connected' : 'disconnected', guilds: client.guilds.cache.size });
});

app.listen(PORT, () => {
    console.log(`🌐 Keep-alive server running on port ${PORT}`);
});

client.on('error', console.error);
process.on('unhandledRejection', console.error);

client.login(DISCORD_BOT_TOKEN).catch(console.error);
