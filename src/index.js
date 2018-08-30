const captains = console;
const tmi = require('tmi.js');
const Discord = require('discord.js');
const server = require('./server');
const bot = require('./bot');

server.start();

const channels = process.env.ttvChannels.toString().split(',');
const clientUsername = process.env.clientUsername.toString();
const lightControlCommands = process.env.lightCommands.toString().split(',');
const specialEffectCommands = process.env.specialEffectCommands
  .toString()
  .split(',');

const options = {
  options: {
    clientId: process.env.TwitchClientId,
    debug: true
  },
  connection: {
    reconnect: true
  },
  identity: {
    username: clientUsername,
    password: process.env.clientToken
  },
  channels
};

// eslint-disable-next-line new-cap
const ttvChatClient = new tmi.client(options);
const discordHook = new Discord.WebhookClient(
  process.env.discordHookId,
  process.env.discordHookToken
);
const logger = require('./logger')(discordHook);

discordHook.send('Client is online and running...');

let moderators = [clientUsername];
let isChatClientEnabled = true;
let lightCommandUsed = '';

bot.createNewBotConversation();

// #region chat client code

ttvChatClient.connect();

function pingTtv() {
  ttvChatClient.ping();
}

ttvChatClient.on('join', (channel, username, self) => {
  const date = new Date();
  const rawMinutes = date.getMinutes();
  const rawHours = date.getHours();
  const hours = (rawHours < 10 ? '0' : '') + rawHours.toLocaleString();
  const minutes = (rawMinutes < 10 ? '0' : '') + rawMinutes.toLocaleString();

  captains.log(`[${hours}:${minutes}] ${username} has JOINED the channel`);

  if (self) {
    captains.log('This client joined the channel...');
    // Assume first channel in channels array is 'self' - owner monitoring their own channel
    setTimeout(pingTtv, 30000);
    ttvChatClient
      .mods(channels[0])
      .then(modsFromTwitch => {
        moderators = moderators.concat(modsFromTwitch);
      })
      .catch(error =>
        captains.log(`There was an error getting moderators: ${error}`)
      );
  }
});

ttvChatClient.on('part', (channel, username) => {
  const date = new Date();
  captains.log(
    `[${date.getHours()}:${date.getMinutes()}] ${username} has LEFT the channel`
  );
});

ttvChatClient.on('chat', (channel, user, message /* , self */) => {
  const userName = user['display-name'] || user.username;
  const lowerCaseMessage = message.toLowerCase();

  if (
    moderators.indexOf(userName.toLowerCase()) > -1 &&
    isLightControlCommand(message)
  ) {
    const logMessage = `Moderator (${userName}) sent a message`;
    logger('info', logMessage);

    if (
      lowerCaseMessage.includes('enable') ||
      lowerCaseMessage.includes('disable')
    ) {
      isChatClientEnabled = lowerCaseMessage.includes('enable');
      const state = isChatClientEnabled ? 'enabled' : 'disabled';
      logger(
        'info',
        `TTV Chat Listener to control the lights has been ${state}`
      );
      return;
    }
  }

  if (isChatClientEnabled) {
    parseChat(lowerCaseMessage, userName);
  } else {
    logger(
      'info',
      'Command was ignored because the TTV Chat Listener is disabled'
    );
  }
});

function parseChat(message, userName) {
  if (isLightControlCommand(message)) {
    const commandMessage = message.slice(lightCommandUsed.length);
    if (commandMessage) {
      discordHook.send(
        `Received a command from ${userName}: ${commandMessage}`
      );
      if (isSpecialEffectCommand(commandMessage)) {
        server.triggerSpecialEffect(commandMessage, userName);
      }
      server.updateOverlay(commandMessage);
      return bot
        .sendCommand(commandMessage, userName)
        .then(result => {
          logger('info', `Successfully sent the command from ${userName}`);
          return result;
        })
        .catch(error => {
          captains.log(error);
          return error;
        });
    }
    // it is a light control command, but not command message
  }

  if (isStreamElements(userName) && isSpecialEffectCommand(message)) {
    return bot.triggerEffect(message, userName);
  }

  return Promise.resolve('there was nothing to do');
}

function isStreamElements(userName) {
  return userName.toLowerCase() === 'streamelements';
}

function isSpecialEffectCommand(message) {
  return specialEffectCommands.some(command => message.includes(command));
}

function isLightControlCommand(message) {
  return lightControlCommands.some(command => {
    lightCommandUsed = message.startsWith(command.toLowerCase());
    return !!lightCommandUsed;
  });
}

// #endregion
