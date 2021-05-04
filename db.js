const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const adapter = new FileSync('db/db.json')
const db = low(adapter)

db
  .defaults({
    fubarComments: [],
    authorCooldowns: [],
  })
  .write()

async function isCommentFubar ({ id }) {
  return !!await db.get('fubarComments')
    .find({ id })
    .value()
}

function getAuthorCooldown(name) {
  return db.get('authorCooldowns')
    .find({ name })
    .value()
}

async function addCommentToFubarList({ id }) {
  if (
    !await db.get('fubarComments')
      .find({ id })
      .value()
  ) {
    db.get('fubarComments')
      .push({ id, processedAt: Date.now() })
      .write()
  }
}

async function addOrUpdateAuthorCooldown(name, cooldownStart, cooldownEnd, copyCount) {
  if (
    await db.get('authorCooldowns')
      .find({ name })
      .value()
  ) {
    await db.get('authorCooldowns')
      .find({ name })
      .assign({ cooldownStart, cooldownEnd, copyCount })
      .write()
  } else {
    await db.get('authorCooldowns')
      .push({ name, cooldownStart, cooldownEnd, copyCount })
      .write()
  }
}

// maybe change all to cooldown rather than fubar for simplification
async function cleanup() {
  await db.get('authorCooldowns')
    .remove(({ cooldownEnd }) => cooldownEnd < Date.now())
    .write()

  await db.get('fubarComments')
    .remove(({ processedAt }) => processedAt < Date.now() - 1000 * 60 * 60 * 24 * 3)
    .write()
}

module.exports = {
  isCommentFubar,
  getAuthorCooldown,
  addCommentToFubarList,
  addOrUpdateAuthorCooldown,
  cleanup,
}
