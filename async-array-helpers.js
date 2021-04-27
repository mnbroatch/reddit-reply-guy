async function asyncFind(arr, cb) {
  return new Promise((resolve, reject) => {
    let x = Promise.all(
      arr.map(function () {
        const result = cb(...arguments)
        if (result) resolve(arguments[0])
      })
    )
  })
}

// Discards rejected items
async function asyncMap(arr, cb) {
  return (await Promise.allSettled(arr.map(cb)))
    .map(result => result.value)
    .filter(Boolean)
}

async function asyncMapSerial(arr, cb) {
  const responses = []
  const arrCopy = [ ...arr ]
  while (arrCopy.length) {
    responses.push(await cb(arrCopy.shift()))
  }
  return responses
}

async function asyncEvery(arr, cb) {
  return !!asyncFind(arr, cb)
}

async function asyncSome(arr, cb) {
  return !await asyncEvery(
    arr,
    async (item) => !await cb(item)
  )
}

async function asyncFilter (arr, cb) {
  return (await asyncMap(
    arr,
    async function (element) {
      if (await cb(...arguments)) {
        return element
      }
    }
  ))
  .filter(Boolean)
}

module.exports = {
  asyncFind,
  asyncEvery,
  asyncSome,
  asyncMap,
  asyncMapSerial,
  asyncFilter,
}
