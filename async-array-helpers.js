// Most of these functions (not asyncReduce) discard rejections!
// Only to be used if rare failures aren't worth retrying

async function asyncReduce(arr = [], cb, initial = arr) {
  let acc = initial
  for (let i = 0, len = arr.length; i < len; i++) {
    const item = arr[i]
    acc = await cb(acc, item, i, arr)
  }
  return acc
}

async function asyncFind(arr = [], cb) {
  for (let i = 0, len = arr.length; i < len; i++) {
    const item = arr[i]
    if (await cb(item, i)) return item
  }
  return null
}

// Discards rejected items
async function asyncMap(arr = [], cb) {
  return (await Promise.allSettled(arr.map(cb)))
    .map(result => result.value)
    .filter(Boolean)
}

async function asyncMapSerial(arr = [], cb) {
  const responses = []
  const arrCopy = [ ...arr ]
  while (arrCopy.length) {
    responses.push(await cb(arrCopy.shift()))
  }
  return responses
}

async function asyncEvery(arr = [], cb) {
  return !await asyncFind(
    arr,
    async function () { return  !await cb(...arguments) }
  )
}

async function asyncSome(arr = [], cb) {
  return !!asyncFind(arr, cb)
}

async function asyncFilter (arr = [], cb) {
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
  asyncReduce,
}
