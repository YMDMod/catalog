'use strict';
const fs = require('fs');
const path = require('path');
const { plan } = require('./lib/plan');

const { createClient } = require('./lib/github');

const CATALOG = path.join(__dirname, '..', 'catalog.json');

function client() {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: self } = process.env;
  if (!token || !self) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required');
  return createClient({ token, self });
}

async function main() {
  const github = client();
  const mainText = fs.readFileSync(CATALOG, 'utf8');
  const { actions, log } = await plan(github, JSON.parse(mainText), mainText);

  for (const line of log) console.log(line);
  for (const action of actions) {
    if (action.type === 'close') {
      await github.closePull(action.pull.number, action.body);
      console.log(`closed #${action.pull.number}`);
      continue;
    }
    await github.pushCatalog(action.branch, action.catalogText, action.title);
    if (action.type === 'open') {
      const pull = await github.createPull(action.branch, action.title, action.body);
      console.log(`opened #${pull.number}: ${action.title}`);
    } else {
      await github.updatePull(action.pull.number, action.title, action.body);
      console.log(`updated #${action.pull.number}: ${action.title}`);
    }
  }
  if (!actions.length) console.log('nothing to do');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
