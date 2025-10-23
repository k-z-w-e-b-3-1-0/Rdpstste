#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function printUsage() {
  const scriptName = path.basename(process.argv[1] || 'start_server_with_webhook.js');
  console.log(
    `Usage: node ${scriptName} <slack_webhook_url> [additional server arguments]\n` +
      '\n' +
      'Starts server.js with the provided Slack webhook URL and forwards any extra arguments ' +
      'to the server process.'
  );
}

function exitWithUsage(code) {
  printUsage();
  process.exit(code);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Error: Missing Slack webhook URL.');
  exitWithUsage(1);
}

const firstArg = args[0];
if (firstArg === '--help' || firstArg === '-h') {
  exitWithUsage(0);
}

if (!firstArg || firstArg.startsWith('-')) {
  console.error(
    'Error: The first argument must be the Slack webhook URL. ' +
      'Node.js specific flags should be supplied after the URL.'
  );
  exitWithUsage(1);
}

const webhookUrl = firstArg;
const forwardedArgs = args.slice(1);
const projectRoot = path.resolve(__dirname, '..');
const serverPath = path.join(projectRoot, 'server.js');

if (!fs.existsSync(serverPath)) {
  console.error(`Error: Could not find server.js at "${serverPath}".`);
  process.exit(1);
}

const nodeArgs = [serverPath, '--webhook', webhookUrl, ...forwardedArgs];
const child = spawn(process.execPath, nodeArgs, {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  console.error('Failed to start server.js', error.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
