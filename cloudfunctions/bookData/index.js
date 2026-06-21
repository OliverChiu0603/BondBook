const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const MAX_USER_RECORDS = 2000
const LIMIT_MESSAGE = `添加失败：用户数据不能超过${MAX_USER_RECORDS}条，请删除部分数据后再添加`

async function ensureCollection(collectionName) {
  try {
    await db.collection(collectionName).limit(1).get()
  } catch (e) {
    const message = e && (e.message || e.errMsg || '')
    if (!message.includes('collection not exists') && !message.includes('DATABASE_COLLECTION_NOT_EXIST')) {
      throw e
    }

    try {
      await db.createCollection(collectionName)
    } catch (createErr) {
      const createMessage = createErr && (createErr.message || createErr.errMsg || '')
      if (!createMessage.includes('already exists') && !createMessage.includes('collection exists')) {
        throw createErr
      }
    }
  }
}

async function ensureSplitCollections() {
  await ensureCollection('book_persons')
  await ensureCollection('book_records')
}

function normalizeShareCode(code) {
  return String(code || '').trim().toUpperCase()
}

function personDocId(bookId, personId) {
  return `${bookId}_${personId}`
}

function recordDocId(bookId, recordId) {
  return `${bookId}_${recordId}`
}

async function queryAll(collectionName, where) {
  const pageSize = 100
  let skip = 0
  let all = []

  while (true) {
    const res = await db.collection(collectionName).where(where || {}).skip(skip).limit(pageSize).get()
    const rows = res.data || []
    all = all.concat(rows)
    if (rows.length < pageSize) break
    skip += pageSize
  }

  return all
}

async function removeWhere(collectionName, where) {
  const rows = await queryAll(collectionName, where)
  for (const row of rows) {
    await db.collection(collectionName).doc(row._id).remove()
  }
  return rows.length
}

function toPersonDoc(bookId, person) {
  return {
    bookId,
    personId: person.id,
    name: String(person.name || '').trim(),
    linkedPersonIds: Array.isArray(person.linkedPersonIds) ? person.linkedPersonIds : [],
    createTime: Number(person.createTime) || Date.now(),
    updateTime: Number(person.updateTime) || Date.now()
  }
}

function toRecordDoc(bookId, personId, record) {
  return {
    bookId,
    personId,
    recordId: record.id,
    event: String(record.event || '').trim(),
    date: record.date || '',
    type: record.type === 'in' ? 'in' : 'out',
    amount: Number(record.amount) || 0,
    note: record.note || '',
    createTime: Number(record.createTime) || Date.now(),
    updateTime: Number(record.updateTime) || 0
  }
}

async function getBook(event) {
  if (event.bookId) {
    const res = await db.collection('books').doc(event.bookId).get()
    return res.data
  }

  const shareCode = normalizeShareCode(event.shareCode)
  if (!shareCode) return null
  const res = await db.collection('books').where({ shareCode }).limit(1).get()
  return (res.data || [])[0] || null
}

function assertCanWrite(book, openid) {
  if (!book) throw new Error('账本不存在')
  const approvedUsers = book.approvedUsers || []
  const deletedUsers = book.deletedUsers || []
  const canWrite = openid === book.ownerOpenid || (approvedUsers.includes(openid) && !deletedUsers.includes(openid))
  if (!canWrite) throw new Error('无权限写入此账本')
}

async function migrateStep(book) {
  if (book.storageMode === 'split' || book.personsMigrated) {
    return { done: true }
  }

  const bookId = book._id
  const persons = Array.isArray(book.persons) ? book.persons : []
  const state = book.migrationState || {}
  let personIndex = Number(state.personIndex) || 0
  let recordIndex = Number(state.recordIndex) || 0
  let writes = 0
  const maxWrites = 5

  if (!state.started) {
    await removeWhere('book_persons', { bookId })
    await removeWhere('book_records', { bookId })
  }

  while (personIndex < persons.length && writes < maxWrites) {
    const person = persons[personIndex]
    if (!person || !person.id || !person.name) {
      personIndex++
      recordIndex = 0
      continue
    }

    if (recordIndex === 0) {
      await db.collection('book_persons').doc(personDocId(bookId, person.id)).set({
        data: toPersonDoc(bookId, person)
      })
      writes++
      if (writes >= maxWrites) break
    }

    const records = Array.isArray(person.records) ? person.records : []
    while (recordIndex < records.length && writes < maxWrites) {
      const record = records[recordIndex]
      recordIndex++
      if (!record || !record.id) continue
      await db.collection('book_records').doc(recordDocId(bookId, record.id)).set({
        data: toRecordDoc(bookId, person.id, record)
      })
      writes++
    }

    if (recordIndex >= records.length) {
      personIndex++
      recordIndex = 0
    }
  }

  const done = personIndex >= persons.length
  await db.collection('books').doc(bookId).update({
    data: done
      ? {
          persons: [],
          storageMode: 'split',
          personsMigrated: true,
          migrationState: db.command.remove(),
          updateTime: Date.now()
        }
      : {
          migrationState: {
            started: true,
            personIndex,
            recordIndex,
            updateTime: Date.now()
          },
          updateTime: Date.now()
        }
  })

  return { done, personIndex, totalPersons: persons.length, writes }
}

async function assemblePersons(bookId) {
  const [personDocs, recordDocs] = await Promise.all([
    queryAll('book_persons', { bookId }),
    queryAll('book_records', { bookId })
  ])
  const recordsByPerson = new Map()

  recordDocs.forEach(doc => {
    const records = recordsByPerson.get(doc.personId) || []
    records.push({
      id: doc.recordId,
      event: doc.event,
      date: doc.date,
      type: doc.type,
      amount: doc.amount,
      note: doc.note || '',
      createTime: doc.createTime,
      updateTime: doc.updateTime
    })
    recordsByPerson.set(doc.personId, records)
  })

  return personDocs.map(doc => ({
    id: doc.personId,
    name: doc.name,
    linkedPersonIds: doc.linkedPersonIds || [],
    records: recordsByPerson.get(doc.personId) || [],
    createTime: doc.createTime,
    updateTime: doc.updateTime
  }))
}

async function getPersonSummaries(bookId) {
  const personDocs = await queryAll('book_persons', { bookId })
  return personDocs.map(doc => ({
    id: doc.personId,
    name: doc.name,
    linkedPersonIds: doc.linkedPersonIds || [],
    createTime: doc.createTime,
    updateTime: doc.updateTime
  }))
}

async function getRecordCount(bookId) {
  const res = await db.collection('book_records').where({ bookId }).count()
  return res.total || 0
}

async function assertCanAddRecords(bookId, count) {
  if (!count) return
  const current = await getRecordCount(bookId)
  if (current + count > MAX_USER_RECORDS) {
    throw new Error(LIMIT_MESSAGE)
  }
}

async function touchBook(bookId) {
  await db.collection('books').doc(bookId).update({
    data: { updateTime: Date.now() }
  })
}

async function updatePerson(personId, data) {
  await db.collection('book_persons').doc(personId).update({ data })
}

async function addPerson(bookId, event) {
  const { person, record } = event
  if (!person || !person.id || !person.name) throw new Error('人员数据缺失')
  await assertCanAddRecords(bookId, record && record.id ? 1 : 0)
  await db.collection('book_persons').doc(personDocId(bookId, person.id)).set({
    data: toPersonDoc(bookId, person)
  })
  if (record && record.id) {
    await db.collection('book_records').doc(recordDocId(bookId, record.id)).set({
      data: toRecordDoc(bookId, person.id, record)
    })
  }
  await touchBook(bookId)
}

async function addRecord(bookId, event) {
  const { personId, record } = event
  if (!personId || !record || !record.id) throw new Error('记录数据缺失')
  await db.collection('book_persons').doc(personDocId(bookId, personId)).get()
  await assertCanAddRecords(bookId, 1)
  await db.collection('book_records').doc(recordDocId(bookId, record.id)).set({
    data: toRecordDoc(bookId, personId, record)
  })
  await updatePerson(personDocId(bookId, personId), { updateTime: Date.now() })
  await touchBook(bookId)
}

async function updateRecord(bookId, event) {
  const { personId, recordId, data } = event
  if (!personId || !recordId || !data) throw new Error('记录数据缺失')
  await db.collection('book_records').doc(recordDocId(bookId, recordId)).update({
    data: { ...data, updateTime: Date.now() }
  })
  await updatePerson(personDocId(bookId, personId), { updateTime: Date.now() })
  await touchBook(bookId)
}

async function setPersonBindings(bookId, event) {
  const persons = await getPersonSummaries(bookId)
  const now = Date.now()
  const ownerIdx = persons.findIndex(p => p.id === event.personId)
  if (ownerIdx === -1) throw new Error('人员不存在')
  const originalLinksById = new Map(persons.map(person => [
    person.id,
    [...(person.linkedPersonIds || [])]
  ]))

  const validIds = new Set(persons.map(p => p.id))
  const targetIds = [...new Set((event.linkedPersonIds || [])
    .filter(id => id && id !== event.personId && validIds.has(id)))]
  const owner = persons[ownerIdx]
  const oldFamilyIds = [...new Set([event.personId, ...(owner.linkedPersonIds || [])])]
  const newFamilyIds = [...new Set([event.personId, ...targetIds])]
  const newFamilySet = new Set(newFamilyIds)
  const removedIds = oldFamilyIds.filter(id => !newFamilySet.has(id))

  owner.linkedPersonIds = targetIds
  owner.updateTime = now

  newFamilyIds.forEach(memberId => {
    const idx = persons.findIndex(p => p.id === memberId)
    if (idx === -1) return
    const expectedSet = new Set(newFamilyIds.filter(id => id !== memberId))
    const currentSet = new Set(persons[idx].linkedPersonIds || [])
    expectedSet.forEach(id => currentSet.add(id))
    const nextLinks = [...currentSet]
    const oldLinks = persons[idx].linkedPersonIds || []
    if (nextLinks.length !== oldLinks.length || nextLinks.some(id => !oldLinks.includes(id))) {
      persons[idx].linkedPersonIds = nextLinks
      persons[idx].updateTime = now
    }
  })

  removedIds.forEach(removedId => {
    const removedIdx = persons.findIndex(p => p.id === removedId)
    if (removedIdx !== -1) {
      const oldLinks = persons[removedIdx].linkedPersonIds || []
      const filtered = oldLinks.filter(id => !newFamilySet.has(id))
      if (filtered.length !== oldLinks.length) {
        persons[removedIdx].linkedPersonIds = filtered
        persons[removedIdx].updateTime = now
      }
    }

    newFamilyIds.forEach(memberId => {
      const idx = persons.findIndex(p => p.id === memberId)
      if (idx === -1) return
      const oldLinks = persons[idx].linkedPersonIds || []
      const filtered = oldLinks.filter(id => id !== removedId)
      if (filtered.length !== oldLinks.length) {
        persons[idx].linkedPersonIds = filtered
        persons[idx].updateTime = now
      }
    })
  })

  const changedPersons = persons.filter(person => {
    const oldLinks = originalLinksById.get(person.id) || []
    const nextLinks = person.linkedPersonIds || []
    return person.updateTime === now ||
      oldLinks.length !== nextLinks.length ||
      nextLinks.some(id => !oldLinks.includes(id))
  })

  for (const person of changedPersons) {
    await updatePerson(personDocId(bookId, person.id), {
      linkedPersonIds: person.linkedPersonIds || [],
      updateTime: person.updateTime || now
    })
  }
  if (changedPersons.length) await touchBook(bookId)
}

async function deleteRecord(bookId, event) {
  const { personId, recordId } = event
  await db.collection('book_records').doc(recordDocId(bookId, recordId)).remove()
  const remaining = await db.collection('book_records').where({ bookId, personId }).limit(1).get()
  if ((remaining.data || []).length === 0) {
    await db.collection('book_persons').doc(personDocId(bookId, personId)).remove()
  } else {
    await updatePerson(personDocId(bookId, personId), { updateTime: Date.now() })
  }
  await touchBook(bookId)
}

async function deletePerson(bookId, event) {
  const { personId } = event
  await db.collection('book_persons').doc(personDocId(bookId, personId)).remove()
  await removeWhere('book_records', { bookId, personId })

  const persons = await queryAll('book_persons', { bookId })
  for (const person of persons) {
    const oldLinks = person.linkedPersonIds || []
    if (!oldLinks.includes(personId)) continue
    await updatePerson(person._id, {
      linkedPersonIds: oldLinks.filter(id => id !== personId),
      updateTime: Date.now()
    })
  }
  await touchBook(bookId)
}

async function batchSetDateForEvent(bookId, event) {
  const records = await queryAll('book_records', { bookId, event: event.eventName })
  const now = Date.now()
  const changedPersons = new Set()
  for (const record of records) {
    await db.collection('book_records').doc(record._id).update({
      data: { date: event.date, updateTime: now }
    })
    changedPersons.add(record.personId)
  }
  for (const personId of changedPersons) {
    await updatePerson(personDocId(bookId, personId), { updateTime: now })
  }
  if (records.length) await touchBook(bookId)
  return records.length > 0
}

async function clearBook(bookId) {
  await removeWhere('book_persons', { bookId })
  await removeWhere('book_records', { bookId })
  await db.collection('books').doc(bookId).update({
    data: {
      persons: [],
      storageMode: 'split',
      personsMigrated: true,
      updateTime: Date.now()
    }
  })
}

exports.main = async (event, context) => {
  try {
    await ensureSplitCollections()
    const wxContext = cloud.getWXContext()
    const book = await getBook(event)
    assertCanWrite(book, wxContext.OPENID)
    const migration = await migrateStep(book)
    if (!migration.done && event.action !== 'migrateStep') {
      return { success: true, needMigration: true, migration }
    }

    const bookId = book._id
    switch (event.action) {
      case 'migrateStep':
        return { success: true, needMigration: !migration.done, migration }
      case 'getPersons':
        return { success: true, persons: await assemblePersons(bookId) }
      case 'addPerson':
        await addPerson(bookId, event)
        break
      case 'addRecord':
        await addRecord(bookId, event)
        break
      case 'updateRecord':
        await updateRecord(bookId, event)
        break
      case 'updatePersonName':
        await updatePerson(personDocId(bookId, event.personId), {
          name: String(event.name || '').trim(),
          updateTime: Date.now()
        })
        await touchBook(bookId)
        break
      case 'setPersonBindings':
        await setPersonBindings(bookId, event)
        break
      case 'deleteRecord':
        await deleteRecord(bookId, event)
        break
      case 'deletePerson':
        await deletePerson(bookId, event)
        break
      case 'batchSetDateForEvent': {
        const anyChanged = await batchSetDateForEvent(bookId, event)
        return { success: true, anyChanged }
      }
      case 'clear':
        await clearBook(bookId)
        break
      default:
        throw new Error('未知操作')
    }

    return { success: true }
  } catch (e) {
    console.error('bookData failed:', e)
    return { success: false, message: e.message || '账本数据保存失败' }
  }
}
