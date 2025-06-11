const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
require('dotenv').config();

// Initialize Discord bot
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// Initialize Express server for Render keep-alive
const app = express();
const PORT = 3000;

// In-memory storage for bump tracking
let bumpData = {
    lastBumpTime: null,
    cooldownTimeout: null
};

// Configuration from environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const BUMP_CHANNEL_ID = process.env.BUMP_CHANNEL_ID;
const BUMP_ROLE_ID = process.env.BUMP_ROLE_ID;

// Cooldown duration (120 minutes in milliseconds)
const COOLDOWN_DURATION = 120 * 60 * 1000;

// Bot ready event
client.once('ready', () => {
    console.log(`✅ Bot is online as ${client.user.tag}`);
    console.log(`📡 Monitoring channel: ${BUMP_CHANNEL_ID}`);
    console.log(`🔔 Will mention role: ${BUMP_ROLE_ID}`);
});

// Message event listener
client.on('messageCreate', async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;
    
    // Only process messages in the designated bump channel
    if (message.channel.id !== BUMP_CHANNEL_ID) return;

    // Handle bot commands
    if (message.content.startsWith('!')) {
        await handleBotCommands(message);
        return;
    }
});

// Interaction event listener for slash commands
client.on('interactionCreate', async (interaction) => {
    // Only process slash commands in the designated bump channel
    if (interaction.channel.id !== BUMP_CHANNEL_ID) return;
    
    // Check if it's the /bump command
    if (interaction.isCommand() && interaction.commandName === 'bump') {
        await handleBumpCommand(interaction);
    }
});

// Handle /bump command
async function handleBumpCommand(interaction) {
    try {
        console.log(`🚀 /bump command detected by ${interaction.user.tag}`);
        
        // Record the bump time
        bumpData.lastBumpTime = Date.now();
        
        // Clear any existing timeout
        if (bumpData.cooldownTimeout) {
            clearTimeout(bumpData.cooldownTimeout);
        }
        
        // Set up new cooldown timer
        bumpData.cooldownTimeout = setTimeout(async () => {
            await sendBumpReminder(interaction.channel);
        }, COOLDOWN_DURATION);
        
        // Send confirmation embed
        const confirmEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Bump Detected!')
            .setDescription('Server has been bumped successfully!')
            .addFields(
                { name: '⏰ Next Bump Available', value: `<t:${Math.floor((Date.now() + COOLDOWN_DURATION) / 1000)}:R>`, inline: true },
                { name: '👤 Bumped By', value: `${interaction.user}`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Bump Cooldown Tracker' });
        
        // Send confirmation message
        await interaction.channel.send({ embeds: [confirmEmbed] });
        
    } catch (error) {
        console.error('Error handling bump command:', error);
    }
}

// Send bump reminder
async function sendBumpReminder(channel) {
    try {
        const reminderEmbed = new EmbedBuilder()
            .setColor('#FF6B35')
            .setTitle('🔔 Bump Reminder!')
            .setDescription('It\'s time to bump the server again!')
            .addFields(
                { name: '📝 How to Bump', value: 'Use `/bump` command to bump the server', inline: false },
                { name: '⏱️ Cooldown', value: '120 minutes from last bump', inline: true },
                { name: '📍 Channel', value: `${channel}`, inline: true }
            )
            .setImage('https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif') // Optional: Add a fun GIF
            .setTimestamp()
            .setFooter({ text: 'Don\'t forget to bump! 🚀' });

        await channel.send({ 
            content: `<@&${BUMP_ROLE_ID}> Time to bump! 🚀`, 
            embeds: [reminderEmbed] 
        });
        
        console.log('📢 Bump reminder sent successfully');
        
        // Reset bump data
        bumpData.lastBumpTime = null;
        bumpData.cooldownTimeout = null;
        
    } catch (error) {
        console.error('Error sending bump reminder:', error);
    }
}

// Handle bot commands
async function handleBotCommands(message) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    switch (command) {
        case 'cooldown':
            await handleCooldownCommand(message);
            break;
        case 'help':
            await handleHelpCommand(message);
            break;
    }
}

// Handle !cooldown command
async function handleCooldownCommand(message) {
    try {
        if (!bumpData.lastBumpTime) {
            const noBumpEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('⚠️ No Recent Bump')
                .setDescription('No bump command has been detected yet.')
                .addFields(
                    { name: '📝 Next Step', value: 'Use `/bump` to start the cooldown timer', inline: false }
                )
                .setTimestamp();
            
            await message.reply({ embeds: [noBumpEmbed] });
            return;
        }

        const timeElapsed = Date.now() - bumpData.lastBumpTime;
        const timeRemaining = COOLDOWN_DURATION - timeElapsed;

        if (timeRemaining <= 0) {
            const readyEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('✅ Bump Available!')
                .setDescription('The server is ready to be bumped again!')
                .addFields(
                    { name: '📝 Action', value: 'Use `/bump` command now', inline: false }
                )
                .setTimestamp();
            
            await message.reply({ embeds: [readyEmbed] });
        } else {
            const nextBumpTime = Math.floor((bumpData.lastBumpTime + COOLDOWN_DURATION) / 1000);
            
            const cooldownEmbed = new EmbedBuilder()
                .setColor('#FF4444')
                .setTitle('⏰ Bump Cooldown Active')
                .setDescription('The server is still on cooldown.')
                .addFields(
                    { name: '⏱️ Time Remaining', value: `<t:${nextBumpTime}:R>`, inline: true },
                    { name: '🕐 Available At', value: `<t:${nextBumpTime}:F>`, inline: true }
                )
                .setTimestamp();
            
            await message.reply({ embeds: [cooldownEmbed] });
        }
    } catch (error) {
        console.error('Error handling cooldown command:', error);
    }
}

// Handle !help command
async function handleHelpCommand(message) {
    try {
        const helpEmbed = new EmbedBuilder()
            .setColor('#4A90E2')
            .setTitle('🤖 Bump Bot Help')
            .setDescription('Here are the available commands and features:')
            .addFields(
                { name: '🚀 `/bump`', value: 'Bump the server (slash command)', inline: false },
                { name: '⏰ `!cooldown`', value: 'Check remaining cooldown time', inline: false },
                { name: '❓ `!help`', value: 'Show this help message', inline: false },
                { name: '🔄 **Auto Features**', value: '• Automatic bump detection\n• 120-minute cooldown tracking\n• Reminder notifications', inline: false },
                { name: '📍 **Channel**', value: `This bot only works in <#${BUMP_CHANNEL_ID}>`, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'Bump Bot v1.0' });
        
        await message.reply({ embeds: [helpEmbed] });
    } catch (error) {
        console.error('Error handling help command:', error);
    }
}

// Express server for Render keep-alive
app.get('/', (req, res) => {
    res.json({ 
        status: 'Bot is running!', 
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        bot: client.user ? 'connected' : 'disconnected',
        guilds: client.guilds.cache.size
    });
});

// Start Express server
app.listen(PORT, () => {
    console.log(`🌐 Keep-alive server running on port ${PORT}`);
});

// Error handling
client.on('error', console.error);
process.on('unhandledRejection', console.error);

// Login to Discord
client.login(DISCORD_BOT_TOKEN).catch(console.error);
