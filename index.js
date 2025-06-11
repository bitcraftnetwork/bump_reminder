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
const PORT = process.env.PORT || 3000;

// In-memory storage for bump tracking
let bumpData = {
    lastBumpTime: null,
    cooldownTimeout: null,
    reminderSent: false,
    lastBumpMessageId: null
};

// Configuration from environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const BUMP_CHANNEL_ID = process.env.BUMP_CHANNEL_ID;
const BUMP_ROLE_ID = process.env.BUMP_ROLE_ID;

// Cooldown duration (120 minutes in milliseconds)
const COOLDOWN_DURATION = 120 * 60 * 1000;

// Bot ready event
client.once('ready', async () => {
    console.log(`✅ Bot is online as ${client.user.tag}`);
    console.log(`📡 Monitoring channel: ${BUMP_CHANNEL_ID}`);
    console.log(`🔔 Will mention role: ${BUMP_ROLE_ID}`);
    
    // Check for recent bumps on startup
    await checkForRecentBumps();
});

// Check for recent bumps on startup
async function checkForRecentBumps() {
    try {
        const channel = client.channels.cache.get(BUMP_CHANNEL_ID);
        if (!channel) {
            console.log('❌ Could not find bump channel');
            return;
        }

        console.log('🔍 Checking for recent bump messages...');
        
        // Fetch recent messages (last 50 messages should be enough)
        const messages = await channel.messages.fetch({ limit: 50 });
        
        // Known bump bot IDs
        const knownBumpBots = [
            '302050872383242240', // Disboard
            '716390085896962058', // ServerHype
            '450100127256936458', // Bump.cc
            '1382299188095746088', // Your bump bot
        ];
        
        // Common bump bot patterns
        const bumpBotPatterns = [
            /bump done|bumped|bump successful/i,
            /server bumped/i,
            /bump complete/i,
            /successfully bumped/i,
        ];
        
        let latestBumpMessage = null;
        
        // Look for the most recent bump message
        for (const message of messages.values()) {
            if (message.author.bot && knownBumpBots.includes(message.author.id)) {
                let isBumpMessage = false;
                
                // Check message content
                if (message.content && bumpBotPatterns.some(pattern => pattern.test(message.content))) {
                    isBumpMessage = true;
                }
                
                // Check embeds
                if (message.embeds && message.embeds.length > 0) {
                    for (const embed of message.embeds) {
                        if ((embed.title && bumpBotPatterns.some(pattern => pattern.test(embed.title))) ||
                            (embed.description && bumpBotPatterns.some(pattern => pattern.test(embed.description)))) {
                            isBumpMessage = true;
                            break;
                        }
                    }
                }
                
                if (isBumpMessage) {
                    latestBumpMessage = message;
                    break; // Messages are in chronological order (newest first)
                }
            }
        }
        
        if (latestBumpMessage) {
            const bumpTime = latestBumpMessage.createdTimestamp;
            const timeElapsed = Date.now() - bumpTime;
            const timeRemaining = COOLDOWN_DURATION - timeElapsed;
            
            console.log(`📅 Found recent bump from ${latestBumpMessage.author.tag} at ${new Date(bumpTime).toISOString()}`);
            console.log(`⏱️ Time elapsed: ${Math.floor(timeElapsed / 60000)} minutes`);
            
            if (timeRemaining > 0) {
                // Still in cooldown period
                console.log(`⏰ Cooldown active: ${Math.floor(timeRemaining / 60000)} minutes remaining`);
                
                bumpData.lastBumpTime = bumpTime;
                bumpData.lastBumpMessageId = latestBumpMessage.id;
                bumpData.reminderSent = false; // Haven't sent reminder for this bump yet
                bumpData.cooldownTimeout = setTimeout(async () => {
                    await sendBumpReminder(channel);
                }, timeRemaining);
                
                // Send startup notification
                const startupEmbed = new EmbedBuilder()
                    .setColor('#FFA500')
                    .setTitle('🔄 Bot Restarted - Cooldown Resumed')
                    .setDescription('Found recent bump and resumed cooldown tracking.')
                    .addFields(
                        { name: '⏰ Next Bump Available', value: `<t:${Math.floor((bumpTime + COOLDOWN_DURATION) / 1000)}:R>`, inline: true },
                        { name: '🤖 Last Bump By', value: `${latestBumpMessage.author.tag}`, inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'Cooldown resumed from previous session' });
                
                await channel.send({ embeds: [startupEmbed] });
                
            } else {
                // Cooldown has already expired - send reminder only if not sent before
                console.log('✅ Previous bump cooldown has expired');
                
                // Check if we already sent a reminder for this bump by looking for recent reminder messages
                const recentMessages = await channel.messages.fetch({ limit: 10 });
                const hasRecentReminder = recentMessages.some(msg => 
                    msg.author.id === client.user.id && 
                    msg.embeds.some(embed => embed.title && embed.title.includes('Bump Reminder')) &&
                    (Date.now() - msg.createdTimestamp) < (COOLDOWN_DURATION + 300000) // Within 125 minutes of bump
                );
                
                if (!hasRecentReminder) {
                    await sendBumpReminder(channel);
                } else {
                    console.log('⚠️ Reminder already sent for expired cooldown, waiting for new bump');
                    bumpData.reminderSent = true;
                }
            }
        } else {
            console.log('🆕 No recent bump messages found - waiting for new bump');
        }
        
    } catch (error) {
        console.error('Error checking for recent bumps:', error);
    }
}

// Message event listener
client.on('messageCreate', async (message) => {
    // Only process messages in the designated bump channel
    if (message.channel.id !== BUMP_CHANNEL_ID) return;

    // Handle user commands (non-bot messages)
    if (!message.author.bot && message.content.startsWith('!')) {
        await handleBotCommands(message);
        return;
    }

    // Detect bump bot responses (bot messages)
    if (message.author.bot) {
        await detectBumpBotResponse(message);
        return;
    }
});

// Interaction event listener for slash commands (backup detection)
client.on('interactionCreate', async (interaction) => {
    // Only process slash commands in the designated bump channel
    if (interaction.channel.id !== BUMP_CHANNEL_ID) return;
    
    // Check if it's the /bump command (backup detection)
    if (interaction.isCommand() && interaction.commandName === 'bump') {
        await handleBumpCommand(interaction);
    }
});

// Handle /bump command (backup detection)
async function handleBumpCommand(interaction) {
    try {
        console.log(`🚀 Direct /bump command detected by ${interaction.user.tag}`);
        await handleBumpDetection(interaction.channel, interaction.user, null);
    } catch (error) {
        console.error('Error handling direct bump command:', error);
    }
}

// Send bump reminder
async function sendBumpReminder(channel) {
    try {
        // Check if reminder was already sent for this bump cycle
        if (bumpData.reminderSent) {
            console.log('⚠️ Reminder already sent for this bump cycle, skipping...');
            return;
        }
        
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
        
        // Mark reminder as sent and reset bump data
        bumpData.reminderSent = true;
        bumpData.lastBumpTime = null;
        bumpData.cooldownTimeout = null;
        bumpData.lastBumpMessageId = null;
        
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
