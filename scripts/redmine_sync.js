#!/usr/bin/env node

const path = require('path');

const {
  fetchSessionsFromApi,
  loadConfigFromEnv,
  syncSessionsWithRedmine,
} = require('../lib/redmineSync');

function printUsageAndExit(message) {
  if (message) {
    console.error(message);
  }
  console.error(`Usage: node ${path.basename(process.argv[1])} \
  --rdp-api <Rdpstste base URL> \
  --redmine <Redmine base URL> \
  --custom-field-id <Redmine custom field ID> \
  [--api-key <API key> | --api-key-file <path>] \
  [--username-field <login|mail>]`);
  console.error('The Redmine API key can also be provided via the REDMINE_API_KEY environment variable.');
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    switch (current) {
      case '--rdp-api':
        if (!next) {
          printUsageAndExit('Missing value for --rdp-api');
        }
        args.rdpApi = next;
        i += 1;
        break;
      case '--redmine':
        if (!next) {
          printUsageAndExit('Missing value for --redmine');
        }
        args.redmine = next;
        i += 1;
        break;
      case '--custom-field-id':
        if (!next) {
          printUsageAndExit('Missing value for --custom-field-id');
        }
        args.customFieldId = Number(next);
        if (!Number.isFinite(args.customFieldId)) {
          printUsageAndExit('The custom field ID must be a number.');
        }
        i += 1;
        break;
      case '--api-key':
        if (!next) {
          printUsageAndExit('Missing value for --api-key');
        }
        args.apiKey = next;
        i += 1;
        break;
      case '--api-key-file':
        if (!next) {
          printUsageAndExit('Missing value for --api-key-file');
        }
        args.apiKeyFile = next;
        i += 1;
        break;
      case '--username-field':
        if (!next) {
          printUsageAndExit('Missing value for --username-field');
        }
        if (!['login', 'mail'].includes(next)) {
          printUsageAndExit('--username-field must be either "login" or "mail"');
        }
        args.usernameField = next;
        i += 1;
        break;
      case '--help':
      case '-h':
        printUsageAndExit();
        break;
      default:
        if (current && current.startsWith('--')) {
          printUsageAndExit(`Unknown argument: ${current}`);
        }
        break;
    }
  }

  if (!args.rdpApi) {
    printUsageAndExit('Missing required --rdp-api argument.');
  }
  if (!args.redmine) {
    printUsageAndExit('Missing required --redmine argument.');
  }
  if (!args.customFieldId) {
    printUsageAndExit('Missing required --custom-field-id argument.');
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const config = loadConfigFromEnv(
    {
      baseUrl: args.redmine,
      customFieldId: args.customFieldId,
      apiKey: args.apiKey,
      apiKeyFile: args.apiKeyFile,
      usernameField: args.usernameField,
    },
    { logger: console }
  );

  if (!config.baseUrl) {
    printUsageAndExit('Invalid Redmine base URL provided.');
  }
  if (!Number.isFinite(config.customFieldId)) {
    printUsageAndExit('Invalid Redmine custom field ID provided.');
  }
  if (!config.apiKey) {
    printUsageAndExit(
      'Redmine API key is required. Provide it via --api-key, --api-key-file, or REDMINE_API_KEY.'
    );
  }

  const sessions = await fetchSessionsFromApi(args.rdpApi);
  const result = await syncSessionsWithRedmine({ sessions, config, logger: console });

  if (result.status === 'completed') {
    console.log(
      `[RedmineSync] Completed: updated ${result.updated}, skipped ${result.skipped}, missing users ${result.missingUsers}, errors ${result.errors}`
    );
  } else if (result.reason) {
    console.log(`[RedmineSync] ${result.status}: ${result.reason}`);
  } else {
    console.log(`[RedmineSync] ${result.status}`);
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
